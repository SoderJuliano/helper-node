const { ipcMain } = require('electron');
const OpenAIService = require('./openAIService');
const helperTools = require('./helperTools');
const registry = require('./helperTools/registry');
const schema = require('./helperTools/schema');
const configService = require('./configService');

class AgenticWorkflowService {
    constructor() {
        this.activeSessions = new Set();
        this.abortControllers = new Map();
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
        
        const { token, model, baseInstruction } = baseOpts;
        const debugMode = configService.getDebugModeStatus();
        const workspaceEnabled = configService.getWorkspaceAccessEnabled();
        const aiSessionId = `agentic-${sessionId}`;

        try {
            // --- Phase 1: Discovery & Architecture ---
            if (this.isAborted(sessionId)) return;
            await this.updatePhase(eventSender, 'discovery', 'Explorando o projeto para entender a arquitetura...', sessionId);
            
            const discoveryTools = registry.listReadOnly();
            
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
                scopeInstruction,
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
                    maxToolCalls: 30
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
                    maxToolCalls: 30
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
                    maxToolCalls: 30
                }
            );

            // --- Phase 4: Review ---
            if (this.isAborted(sessionId)) return;
            await this.updatePhase(eventSender, 'review', 'Revisando as alterações e finalizando...', sessionId);

            const reviewInstruction = [
                "═══ FASE 4: REVISÃO E CONCLUSÃO ═══",
                "Você acabou de realizar as alterações planejadas.",
                "Revise se seguiu os padrões detectados na Fase 1.",
                "Se encontrar erros, CORRIJA-OS agora usando as ferramentas.",
                "",
                "IMPORTANTE PARA O RESUMO FINAL:",
                "1. Confirme explicitamente quais arquivos foram CRIADOS ou MODIFICADOS com sucesso.",
                "2. Se você usou writeFile/patchFile, NÃO diga ao usuário para 'criar os arquivos'; diga que você já os criou.",
                "3. Dê as instruções de como o usuário pode TESTAR o que você já implementou.",
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
                    maxToolCalls: 30
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
        }
    }

    async handleToolCall(name, args, sessionId) {
        if (this.isAborted(sessionId)) {
            throw new Error('Processo interrompido pelo usuário.');
        }
        return await helperTools.executeTool(name, args, {
            source: "agentic-workflow-tool-call",
            force: true, // Bypass manual confirmation in agentic mode
        });
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
