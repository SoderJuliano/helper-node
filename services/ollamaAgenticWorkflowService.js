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
            await this.updatePhase(eventSender, 'classification', 'Analisando intenção...', sessionId);

            const classification = await BackendService.responder(
                `Classifique como "READ_ONLY" (pergunta) ou "WRITE" (criar/editar).\nPergunta: "${userText}"\nResposta (UMA palavra):`,
                { sessionId: `${aiSessionId}-c` }
            );

            const isWrite = classification.trim().toUpperCase().includes('WRITE');
            console.log(`[OllamaAgentic][${sessionId}] Intent: ${isWrite ? 'WRITE' : 'READ_ONLY'}`);

            // === READ_ONLY MODE ===
            if (!isWrite) {
                await this.updatePhase(eventSender, 'answer', 'Respondendo...', sessionId);
                const answer = await BackendService.responder(
                    `${baseInstruction}\n\nResponda: "${userText}"`,
                    { sessionId: aiSessionId }
                );
                await this.updatePhase(eventSender, 'completed', 'Pronto!', sessionId);
                return answer;
            }

            // === PHASE 0.5: SUB-CLASSIFICATION (via llama3 — decision simple) ===
            const editType = await this.classifyEditType(userText, sessionId);
            console.log(`[OllamaAgentic][${sessionId}] EditType: ${editType}`);

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
        const prompt = `Classifique o tipo de edição em UMA palavra: CREATE, EDIT, DELETE, ou APPEND.

Guia:
- CREATE: novo arquivo/pasta
- EDIT: modificar conteúdo existente (linha, função, trecho)
- DELETE: remover arquivo/pasta
- APPEND: adicionar ao final

Pergunta: "${userText}"
Resposta:`;

        try {
            // Usa llama3 (rápido, decisões simples) via BackendService
            const result = await BackendService.responder(prompt, { 
                sessionId: `${sessionId}-subclass`,
                model: 'llama3' // Force modelo simples
            });
            const type = result.trim().toUpperCase();
            return ['CREATE', 'EDIT', 'DELETE', 'APPEND'].includes(type) ? type : 'EDIT';
        } catch (e) {
            console.warn(`[classifyEditType] Erro, default='EDIT':`, e.message);
            return 'EDIT';
        }
    }

    getToolsByEditType(editType) {
        // Filtra tools baseado no tipo de edição
        const toolsRO = registry.listReadOnly();
        const allTools = registry.list();
        
        const toolMap = new Map(allTools.map(t => [t.name, t]));
        
        switch (editType) {
            case 'CREATE':
                // CREATE: writeFile, appendToFile, createDir
                return toolsRO.concat(allTools.filter(t => ['writeFile', 'appendToFile'].includes(t.name)));
            case 'EDIT':
                // EDIT: patchFile, searchInFiles, readFile (no writeFile completo!)
                return toolsRO.concat(allTools.filter(t => ['patchFile', 'appendToFile'].includes(t.name)));
            case 'DELETE':
                // DELETE: deleteFile + read tools
                return toolsRO.concat(allTools.filter(t => ['deleteFile'].includes(t.name)));
            case 'APPEND':
                // APPEND: appendToFile + read tools
                return toolsRO.concat(allTools.filter(t => ['appendToFile'].includes(t.name)));
            default:
                // Fallback: tudo
                return allTools;
        }
    }

    async executeWriteWorkflow(userText, baseInstruction, sessionId, aiSessionId, eventSender, editType = 'EDIT') {
        const toolsRO = registry.listReadOnly();
        const toolsFiltered = this.getToolsByEditType(editType);

        // Phase 1: Discovery
        await this.updatePhase(eventSender, 'discovery', 'Descobrindo...', sessionId);
        await BackendService.responder(userText, {
            tools: toolsRO,
            onToolCall: (n, a) => this.handleToolCall(n, a, sessionId, false),
            sessionId: aiSessionId,
            instruction: '═══ FASE 1: DESCOBERTA ═══\nExplore o projeto.'
        });

        // Phase 2: Planning
        await this.updatePhase(eventSender, 'planning', 'Planejando...', sessionId);
        await BackendService.responder('Gere o plano.', {
            tools: toolsRO,
            onToolCall: (n, a) => this.handleToolCall(n, a, sessionId, false),
            sessionId: aiSessionId,
            instruction: '═══ FASE 2: PLANEJAMENTO ═══\nQuais arquivos? Qual abordagem?'
        });

        // Phase 3: Implementation (com tools filtradas)
        await this.updatePhase(eventSender, 'implementation', 'Implementando...', sessionId);
        await BackendService.responder('Implemente.', {
            tools: toolsFiltered,
            onToolCall: (n, a) => this.handleToolCall(n, a, sessionId, true),
            sessionId: aiSessionId,
            instruction: `═══ FASE 3: IMPLEMENTAÇÃO ═══\nExecute as ações (tipo: ${editType}).`,
            maxToolCalls: 50
        });

        // Phase 4: Review (com tools filtradas)
        await this.updatePhase(eventSender, 'review', 'Revisando...', sessionId);
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
        if (this.isAborted(sessionId)) throw new Error('Cancelado.');
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
    }

    isAborted(sessionId) {
        return !this.activeSessions.has(sessionId);
    }
}

module.exports = new OllamaAgenticWorkflowService();
