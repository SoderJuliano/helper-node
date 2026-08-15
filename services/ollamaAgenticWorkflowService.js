const BackendService = require('./backendService');
const helperTools = require('./helperTools');
const registry = require('./helperTools/registry');
const configService = require('./configService');

class OllamaAgenticWorkflowService {
    constructor() {
        this.activeSessions = new Set();
    }

    async run(userText, baseOpts, eventSender) {
        const sessionId = Date.now().toString();
        this.activeSessions.add(sessionId);
        const { baseInstruction } = baseOpts;
        const workspaceEnabled = configService.getWorkspaceAccessEnabled();
        const aiSessionId = `agentic-ollama-${sessionId}`;

        try {
            // === PHASE 0: MAIN CLASSIFICATION ===
            if (this.isAborted(sessionId)) throw new Error('Request cancelled');
            await this.updatePhase(eventSender, 'classification', 'Classificação: Analisando intenção...', sessionId);

            const classification = await BackendService.responder(
                `Classifique em UMA palavra: "READ_ONLY", "QUERY" ou "WRITE".
- READ_ONLY: pergunta conceitual que a IA responde com conhecimento próprio (ex: "o que é async/await?")
- QUERY: pergunta que precisa consultar o sistema/projeto pra responder (ex: "tem arquivos não comitados?", "quantos arquivos tem?", "o que tem no package.json?", "qual branch estou?")
- WRITE: criar, editar, deletar arquivo ou rodar comando que modifica algo (ex: "faz um commit", "edita o backendService", "cria um README")
Pergunta: "${userText}"
Resposta (UMA palavra):`,
                { sessionId: `${aiSessionId}-c` }
            );

            if (this.isAborted(sessionId)) throw new Error('Request cancelled');
            const classWord = classification.trim().toUpperCase().split(/\s/)[0];
            const isWrite = classWord === 'WRITE';
            const isQuery = classWord === 'QUERY';
            console.log(`[OllamaAgentic][${sessionId}] Intent: ${classWord}`);

            // === READ_ONLY MODE ===
            if (!isWrite && !isQuery) {
                if (this.isAborted(sessionId)) throw new Error('Request cancelled');
                await this.updatePhase(eventSender, 'answer', 'Respondendo...', sessionId);
                const answer = await BackendService.responder(
                    `${baseInstruction}\n\nResponda: "${userText}"`,
                    { sessionId: aiSessionId }
                );
                await this.updatePhase(eventSender, 'completed', 'Pronto!', sessionId);
                return answer;
            }

            // === QUERY MODE — pergunta que precisa de tools de leitura/shell ===
            if (isQuery) {
                if (this.isAborted(sessionId)) throw new Error('Request cancelled');
                await this.updatePhase(eventSender, 'discovery', 'Descoberta: Consultando dados do projeto...', sessionId);
                const toolsRO = registry.listReadOnly().concat(
                    registry.list().filter(t => ['runCommand', 'runShellAdvanced'].includes(t.name))
                );
                const answer = await BackendService.responder(userText, {
                    tools: toolsRO,
                    onToolCall: (n, a) => this.handleToolCall(n, a, sessionId, false),
                    sessionId: aiSessionId,
                    instruction: baseInstruction,
                    maxToolCalls: 10,
                });
                await this.updatePhase(eventSender, 'completed', 'Pronto!', sessionId);
                return answer;
            }

            // === PHASE 0.5: SUB-CLASSIFICATION ===
            if (this.isAborted(sessionId)) throw new Error('Request cancelled');
            await this.updatePhase(eventSender, 'subclassification', 'Sub-classificação: Identificando tipo de alteração...', sessionId);
            const editType = await this.classifyEditType(userText, sessionId);
            console.log(`[OllamaAgentic][${sessionId}] EditType: ${editType}`);

            // SHELL: não precisa de 4 fases — executa os comandos direto
            if (editType === 'SHELL') {
                if (this.isAborted(sessionId)) throw new Error('Request cancelled');
                await this.updatePhase(eventSender, 'implementation', 'Implementação: Executando comandos...', sessionId);
                const shellTools = registry.listReadOnly().concat(
                    registry.list().filter(t => ['runCommand', 'runShellAdvanced'].includes(t.name))
                );
                const result = await BackendService.responder(userText, {
                    tools: shellTools,
                    onToolCall: (n, a) => this.handleToolCall(n, a, sessionId, true),
                    sessionId: aiSessionId,
                    instruction: baseInstruction,
                    maxToolCalls: 15,
                });
                await this.updatePhase(eventSender, 'completed', 'Concluído!', sessionId);
                return result;
            }

            // === WRITE MODE: 4 PHASES WITH TOOL FILTERING ===
            return await this.executeWriteWorkflow(userText, baseInstruction, sessionId, aiSessionId, eventSender, editType);

        } catch (error) {
            await this.updatePhase(eventSender, 'error', error.message, sessionId);
            throw error;
        } finally {
            this.activeSessions.delete(sessionId);
        }
    }

    async classifyEditType(userText, sessionId) {
        const prompt = `Classifique o tipo de edição em UMA palavra: CREATE, EDIT, DELETE, APPEND ou SHELL.

Guia:
- CREATE: criar arquivo/pasta novo
- EDIT: modificar conteúdo existente (linha, função, trecho)
- DELETE: remover arquivo/pasta
- APPEND: adicionar ao final de arquivo
- SHELL: rodar comando de terminal (git commit, git add, npm, build, testes, etc.)

Pergunta: "${userText}"
Resposta (UMA palavra):`;

        try {
            const result = await BackendService.responder(prompt, {
                sessionId: `${sessionId}-subclass`,
            });
            const type = result.trim().toUpperCase().split(/\s/)[0].replace(/[^A-Z]/g, '');
            return ['CREATE', 'EDIT', 'DELETE', 'APPEND', 'SHELL'].includes(type) ? type : 'EDIT';
        } catch (e) {
            console.warn(`[classifyEditType] Erro, default='EDIT':`, e.message);
            return 'EDIT';
        }
    }

    getToolsByEditType(editType) {
        const toolsRO = registry.listReadOnly();
        const allTools = registry.list();
        
        switch (editType) {
            case 'CREATE':
                return toolsRO.concat(allTools.filter(t => ['writeFile', 'appendToFile', 'runCommand', 'runShellAdvanced'].includes(t.name)));
            case 'EDIT':
                return toolsRO.concat(allTools.filter(t => ['patchFile', 'appendToFile', 'runCommand', 'runShellAdvanced'].includes(t.name)));
            case 'DELETE':
                return toolsRO.concat(allTools.filter(t => ['deleteFile', 'runCommand', 'runShellAdvanced'].includes(t.name)));
            case 'APPEND':
                return toolsRO.concat(allTools.filter(t => ['appendToFile', 'runCommand', 'runShellAdvanced'].includes(t.name)));
            case 'SHELL':
                return toolsRO.concat(allTools.filter(t => ['runCommand', 'runShellAdvanced'].includes(t.name)));
            default:
                return allTools;
        }
    }

    async executeWriteWorkflow(userText, baseInstruction, sessionId, aiSessionId, eventSender, editType = 'EDIT') {
        const toolsRO = registry.listReadOnly();
        const toolsFiltered = this.getToolsByEditType(editType);

        // Phase 1: Discovery
        if (this.isAborted(sessionId)) throw new Error('Request cancelled');
        await this.updatePhase(eventSender, 'discovery', 'Descoberta: Explorando arquivos relevantes...', sessionId);
        await BackendService.responder(userText, {
            tools: toolsRO,
            onToolCall: (n, a) => this.handleToolCall(n, a, sessionId, false),
            sessionId: aiSessionId,
            instruction: '═══ FASE 1: DESCOBERTA ═══\nExplore o projeto.'
        });

        // Phase 2: Planning
        if (this.isAborted(sessionId)) throw new Error('Request cancelled');
        await this.updatePhase(eventSender, 'planning', 'Planejamento: Estruturando o plano de mudança...', sessionId);
        await BackendService.responder('Gere o plano.', {
            tools: toolsRO,
            onToolCall: (n, a) => this.handleToolCall(n, a, sessionId, false),
            sessionId: aiSessionId,
            instruction: '═══ FASE 2: PLANEJAMENTO ═══\nQuais arquivos? Qual abordagem?'
        });

        // Phase 3: Implementation
        if (this.isAborted(sessionId)) throw new Error('Request cancelled');
        await this.updatePhase(eventSender, 'implementation', 'Implementação: Aplicando alterações...', sessionId);
        await BackendService.responder('Implemente.', {
            tools: toolsFiltered,
            onToolCall: (n, a) => this.handleToolCall(n, a, sessionId, true),
            sessionId: aiSessionId,
            instruction: `═══ FASE 3: IMPLEMENTAÇÃO ═══\nExecute as ações (tipo: ${editType}).`,
            maxToolCalls: 50
        });

        // Phase 4: Review / Verification
        if (this.isAborted(sessionId)) throw new Error('Request cancelled');
        await this.updatePhase(eventSender, 'verification', 'Verificação: Revisando código e testes...', sessionId);
        const result = await BackendService.responder('Revise e finalize.', {
            tools: toolsFiltered,
            onToolCall: (n, a) => this.handleToolCall(n, a, sessionId, true),
            sessionId: aiSessionId,
            instruction: `═══ FASE 4: REVISÃO ═══\nQuais foram as alterações? (tipo: ${editType})`,
            maxToolCalls: 30
        });

        await this.updatePhase(eventSender, 'completed', 'Concluído!', sessionId);
        return result;
    }

    async handleToolCall(name, args, sessionId, force = false) {
        if (this.isAborted(sessionId)) throw new Error('Request cancelled');
        return await helperTools.executeTool(name, args, {
            source: "agentic-ollama",
            force
        });
    }

    async updatePhase(eventSender, phase, status, sessionId) {
        console.log(`[OllamaAgentic][${sessionId}] ${phase}`);
        eventSender.send('agentic-phase-update', { phase, status, sessionId });
    }

    stop(sessionId) {
        this.activeSessions.delete(sessionId);
        try { BackendService.abortCurrentRequest(); } catch (_) {}
    }

    // O botão flutuante "Parar IA" não carrega sessionId — sem isto ele deixava
    // o turno agêntico em andamento continuar.
    stopAll() {
        if (this.activeSessions.size === 0) return;
        this.activeSessions.clear();
        try { BackendService.abortCurrentRequest(); } catch (_) {}
    }

    isAborted(sessionId) {
        return !this.activeSessions.has(sessionId);
    }
}

module.exports = new OllamaAgenticWorkflowService();
