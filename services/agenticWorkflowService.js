const { ipcMain } = require('electron');
const OpenAIService = require('./openAIService');
const helperTools = require('./helperTools');
const registry = require('./helperTools/registry');
const schema = require('./helperTools/schema');
const configService = require('./configService');

// Resumo legível de uma ação pra mostrar o "thinking" inline na conversa.
function _summarizeTool(name, a = {}) {
    const base = (p) => String(p || '').split('/').filter(Boolean).slice(-1)[0] || String(p || '');
    switch (name) {
        case 'readFile': case 'readFileChunk': return `Lendo ${base(a.path)}`;
        case 'fileInfo': return `Inspecionando ${base(a.path)}`;
        case 'findFiles': return `Procurando ${a.glob || a.pattern || 'arquivos'}`;
        case 'listDir': case 'readDir': return `Listando ${base(a.path) || 'diretório'}`;
        case 'writeFile': return `Escrevendo ${base(a.path)}`;
        case 'appendToFile': return `Anexando em ${base(a.path)}`;
        case 'patchFile': return `Editando ${base(a.path)}`;
        case 'deleteFile': return `Removendo ${base(a.path)}`;
        case 'runCommand': case 'runTerminal': return `Rodando: ${String(a.command || a.cmd || '').slice(0, 70)}`;
        case 'grep': case 'searchInFiles': return `Buscando "${String(a.query || a.pattern || '').slice(0, 50)}"`;
        default: return name;
    }
}

class AgenticWorkflowService {
    constructor() {
        this.activeSessions = new Set();
        this.abortControllers = new Map();
        this.senderBySession = new Map();
    }

    /**
     * Runs the multi-phase agentic workflow.
     * @param {string} userText - The user's request.
     * @param {object} baseOpts - Base options (token, model, baseInstruction, etc.)
     * @param {object} eventSender - The IPC event sender to communicate with UI.
     */
    async run(userText, baseOpts, eventSender) {
        const sessionId = Date.now().toString();
        this.activeSessions.add(sessionId);
        this.senderBySession.set(sessionId, eventSender);

        const { token, model, baseInstruction } = baseOpts;
        const debugMode = configService.getDebugModeStatus();
        const workspaceEnabled = configService.getWorkspaceAccessEnabled();
        const aiSessionId = `agentic-${sessionId}`;

        try {
            // --- Phase 1: Discovery & Architecture ---
            if (this.isAborted(sessionId)) return;
            await this.updatePhase(eventSender, 'discovery', 'Explorando o projeto para entender a arquitetura...', sessionId);
            
            const discoveryTools = registry.listReadOnly();
            
            let projectStructureText = "";
            try {
                const workspace = require('./workspace');
                const activeDirs = workspace.list() || [];
                const dir = activeDirs.find(a => a.type === 'dir');
                if (dir && dir.path) {
                    const root = dir.path;
                    const { execSync } = require("child_process");
                    const cmd =
                      `find "${root}" \\( -name '.git' -o -name 'node_modules' -o -name 'target' ` +
                      `-o -name 'build' -o -name '.idea' -o -name '__pycache__' -o -name '.venv' ` +
                      `-o -name 'dist' \\) -prune -o \\( -type f -o -type d \\) -printf '%P\\n' ` +
                      `2>/dev/null | sort | head -150`;
                    const out = execSync(cmd, { encoding: "utf8" }).trim();
                    if (out) {
                        projectStructureText = `\n\n═══ ESTRUTURA DO PROJETO ANEXADO (arquivos relevantes) ═══\n${out}\n\n`;
                    }
                }
            } catch (e) {
                console.warn("[agenticWorkflow] falha ao extrair estrutura do projeto:", e.message);
            }

            const scopeInstruction = workspaceEnabled 
                ? [
                    "═══ REGRAS DE ESCOPO (Workspace Ativo) ═══",
                    "1. Você deve agir APENAS nos arquivos e pastas do projeto que o usuário anexou.",
                    "2. O contexto do workspace enviado na primeira mensagem contém a ÚNICA pasta válida para trabalho.",
                    "3. Se o usuário anexou uma pasta, seu mundo é APENAS essa pasta.",
                    "",
                  ].join("\n")
                : [
                    "═══ REGRAS DE ESCOPO (Modo Sistema) ═══",
                    "1. Você tem permissão para atuar em arquivos do sistema conforme solicitado.",
                    "2. SEMPRE verifique a existência de arquivos antes de agir.",
                    "",
                  ].join("\n");

            const discoveryInstruction = [
                baseInstruction,
                scopeInstruction + projectStructureText,
                "═══ FASE 1: DESCOBERTA E ARQUITETURA ═══",
                "Seu objetivo é explorar o ambiente para entender a estrutura atual.",
                "Identifique padrões, tecnologias e dependências relevantes para o pedido do usuário.",
                "Nesta fase, você só tem acesso a ferramentas de LEITURA.",
                "Ao final desta fase, produza um resumo técnico do que foi detectado.",
                "NÃO tente escrever ou modificar arquivos ainda.",
            ].join("\n\n");

            const discoveryResult = await OpenAIService.makeOpenAIRequest(
                userText,
                token,
                discoveryInstruction,
                model,
                null,
                { 
                    tools: schema.toOpenAITools(discoveryTools),
                    onToolCall: (name, args) => this.handleToolCall(name, args, sessionId),
                    stateless: false,
                    sessionId: aiSessionId,
                    maxToolCalls: 50
                }
            );

            if (debugMode) {
                await this.sendDebugInfo(eventSender, 'discovery_result', discoveryResult, sessionId);
            }

            // --- Phase 2: Planning ---
            if (this.isAborted(sessionId)) return;
            await this.updatePhase(eventSender, 'planning', 'Montando plano de implementação...', sessionId);

            const planningInstruction = [
                "═══ FASE 2: PLANEJAMENTO TÉCNICO ═══",
                "Com base na descoberta anterior, crie um plano detalhado de ação.",
                "Liste quais arquivos/recursos você vai criar ou alterar.",
                "Explique a abordagem técnica escolhida.",
                "Nesta fase, você ainda só tem acesso a ferramentas de LEITURA se precisar de mais detalhes.",
                "Ao final, apresente o plano completo ao usuário.",
                "NÃO execute ações de escrita ainda.",
            ].join("\n\n");

            const planningResult = await OpenAIService.makeOpenAIRequest(
                "Gere o plano de ação detalhado.",
                token,
                planningInstruction,
                model,
                null,
                {
                    tools: schema.toOpenAITools(discoveryTools),
                    onToolCall: (name, args) => this.handleToolCall(name, args, sessionId),
                    stateless: false,
                    sessionId: aiSessionId,
                    maxToolCalls: 50
                }
            );

            if (debugMode) {
                await this.sendDebugInfo(eventSender, 'planning_result', planningResult, sessionId);
            }

            // --- Phase 3: Implementation ---
            if (this.isAborted(sessionId)) return;
            await this.updatePhase(eventSender, 'implementation', 'Executando implementação guiada...', sessionId);

            const implementationInstruction = [
                "═══ FASE 3: EXECUÇÃO ═══",
                workspaceEnabled ? "IMPORTANTE: Trabalhe APENAS dentro da pasta do projeto anexada." : "Execute as ações conforme o plano no sistema.",
                "Agora você deve realizar as tarefas planejadas.",
                "Use todas as ferramentas disponíveis (leitura, escrita, comandos).",
                "Proceda com uma ação por vez, garantindo a integridade do sistema.",
                "Nesta fase, SEJA DIRETO e execute as ações.",
            ].join("\n\n");

            // We use the full set of tools here
            const fullTools = registry.list();
            const implementationResult = await OpenAIService.makeOpenAIRequest(
                "Inicie a implementação conforme o plano.",
                token,
                implementationInstruction,
                model,
                null,
                {
                    tools: schema.toOpenAITools(fullTools),
                    onToolCall: (name, args) => this.handleToolCall(name, args, sessionId),
                    stateless: false, 
                    sessionId: aiSessionId,
                    maxToolCalls: 50
                }
            );

            // --- Phase 4: Review ---
            if (this.isAborted(sessionId)) return;
            await this.updatePhase(eventSender, 'review', 'Revisando as alterações e finalizando...', sessionId);

            const reviewInstruction = [
                "═══ FASE 4: REVISÃO, VERIFICAÇÃO E CONCLUSÃO ═══",
                "Você acabou de realizar as alterações planejadas.",
                "Revise se seguiu os padrões detectados na Fase 1.",
                "Se encontrar erros, CORRIJA-OS agora usando as ferramentas.",
                "",
                "ETAPA DE COMPILAÇÃO E VERIFICAÇÃO DE SINTAXE (OBRIGATÓRIO):",
                "1. Identifique se o projeto possui scripts de build, linter ou testes (ex: npm run build, tsc, npm run lint, etc.) inspecionando package.json ou configurações.",
                "2. Se o projeto tiver comandos de build, compilação ou linting, execute-os usando runCommand ou runShellAdvanced para verificar se suas alterações causaram algum erro de sintaxe, TypeScript ou quebra de build.",
                "3. IMPORTANTE sobre testes e scripts de placeholder: Se o script de teste for apenas um placeholder (ex: contém 'no test specified' ou 'exit 1' genérico) ou se o projeto não estiver realmente configurado com uma suíte de testes ativa (jest, mocha, vitest, etc.), ignore falhas do comando de teste. Projetos pessoais e protótipos frequentemente não possuem testes. Só exija sucesso se o comando rodar um teste real configurado. ",
                "4. Se a compilação ou linter real falhar, você DEVE analisar as mensagens de erro retornadas pelo terminal, usar as ferramentas para corrigir os arquivos e compilar/testar novamente em um loop contínuo até que tudo passe sem erros.",
                "5. Se não houver comandos de build/compilação definidos, faça uma verificação de sintaxe manual (leitura rápida) nos arquivos modificados.",
                "",
                "IMPORTANTE PARA O RESUMO FINAL:",
                "1. Confirme de forma explícita quais arquivos foram modificados ou criados com sucesso.",
                "2. Se você usou writeFile/patchFile, diga ao usuário que você já realizou as edições nos arquivos (não mande o usuário criá-los).",
                "3. Indique os comandos que o usuário pode rodar para testar a implementação.",
                "Ao final, dê um resumo curto e direto.",
            ].join("\n\n");

            const finalResult = await OpenAIService.makeOpenAIRequest(
                "Revise as alterações e finalize.",
                token,
                reviewInstruction,
                model,
                null,
                {
                    tools: schema.toOpenAITools(fullTools),
                    onToolCall: (name, args) => this.handleToolCall(name, args, sessionId),
                    sessionId: aiSessionId,
                    maxToolCalls: 50
                }
            );

            await this.updatePhase(eventSender, 'completed', 'Tarefa concluída com sucesso!', sessionId);
            return finalResult;

        } catch (error) {
            console.error(`[AgenticWorkflow] Error in session ${sessionId}:`, error);
            await this.updatePhase(eventSender, 'error', `Erro no fluxo: ${error.message}`, sessionId);
            throw error;
        } finally {
            this.activeSessions.delete(sessionId);
            this.senderBySession.delete(sessionId);
        }
    }

    async handleToolCall(name, args, sessionId) {
        if (this.isAborted(sessionId)) {
            throw new Error('Processo interrompido pelo usuário.');
        }
        // Mostra a ação inline na conversa (mesmo evento do chat normal).
        const sender = this.senderBySession.get(sessionId);
        const callId = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
        if (sender) {
            try { sender.send('ai-tool-activity', { id: callId, name, label: _summarizeTool(name, args), phase: 'start' }); } catch (_) {}
        }
        const res = await helperTools.executeTool(name, args, {
            source: "agentic-workflow-tool-call",
            force: true, // Bypass manual confirmation in agentic mode
        });
        if (sender) {
            try { sender.send('ai-tool-activity', { id: callId, name, phase: 'done', ok: res && res.ok !== false }); } catch (_) {}
        }
        return res;
    }

    async updatePhase(eventSender, phase, status, sessionId) {
        console.log(`[AgenticWorkflow][${sessionId}] Phase: ${phase} - ${status}`);
        eventSender.send('agentic-phase-update', { phase, status, sessionId });
    }

    async sendDebugInfo(eventSender, type, data, sessionId) {
        eventSender.send('agentic-debug-info', { type, data, sessionId });
    }

    stop(sessionId) {
        console.log(`[AgenticWorkflow] Stopping session ${sessionId}`);
        this.activeSessions.delete(sessionId);
    }

    isAborted(sessionId) {
        return !this.activeSessions.has(sessionId);
    }
}

module.exports = new AgenticWorkflowService();
