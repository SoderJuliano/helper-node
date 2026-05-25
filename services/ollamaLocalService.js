// services/ollamaLocalService.js
// Cliente HTTP do Ollama rodando LOCALMENTE no PC do user (porta 11434).
// Sem fallback automático: se Ollama não estiver instalado/rodando ou se o
// modelo escolhido não estiver baixado, devolvemos erro AMIGÁVEL com o
// comando que o user precisa rodar.
//
// ATENÇÃO: helperTools NÃO funciona com ollama local nesta versão (decisão
// do usuário). Foco aqui é simplicidade — chat puro, sem tool calling.

const axios = require('axios');
const configService = require('./configService');

const DEFAULT_HOST = 'http://localhost:11434';
const REQUEST_TIMEOUT_MS = 120000; // 2 min — modelos locais podem ser lentos no primeiro token

class OllamaLocalService {
    constructor() {
        this.sessions = {};
    }

    _host() {
        const h = configService.getOllamaLocalHost && configService.getOllamaLocalHost();
        return (h || DEFAULT_HOST).replace(/\/$/, '');
    }

    _model() {
        return (configService.getOllamaLocalModel && configService.getOllamaLocalModel())
            || 'qwen2.5-coder:7b';
    }

    // Verifica se Ollama está acessível na porta padrão. Não baixa nada.
    async ping() {
        try {
            const r = await axios.get(`${this._host()}/api/tags`, { timeout: 3000 });
            return Array.isArray(r.data && r.data.models);
        } catch (_) {
            return false;
        }
    }

    // Lista modelos baixados localmente. Útil pra diagnosticar erro de modelo ausente.
    async listInstalledModels() {
        try {
            const r = await axios.get(`${this._host()}/api/tags`, { timeout: 3000 });
            return (r.data && r.data.models || []).map(m => m.name || m.model).filter(Boolean);
        } catch (_) {
            return null; // null = não conseguiu conectar
        }
    }

    _classifyError(err, model) {
        const code = err && err.code;
        const status = err && err.response && err.response.status;
        const body = err && err.response && err.response.data;
        // Conexão recusada → Ollama não está rodando (ou não instalado)
        if (code === 'ECONNREFUSED' || code === 'ENOTFOUND' || code === 'EHOSTUNREACH') {
            return [
                '⚠️ **Ollama Local não está rodando.**',
                '',
                'Verifique se você instalou e iniciou o Ollama:',
                '',
                '```bash',
                '# Instalar (Linux):',
                'curl -fsSL https://ollama.com/install.sh | sh',
                '',
                '# Iniciar serviço:',
                'ollama serve',
                '',
                '# Ou em outro terminal, baixar o modelo selecionado:',
                `ollama pull ${model}`,
                '```',
                '',
                'Mais detalhes em: https://ollama.com/download',
                '',
                'Depois, volte e tente novamente. Se preferir, troque o provider em **Configurações** pra ChatGPT.',
            ].join('\n');
        }
        // 404 do /api/chat com mensagem "model not found"
        const msg = (body && (body.error || body.message)) || '';
        if (status === 404 || /not found|no such model|pull/i.test(String(msg))) {
            return [
                `⚠️ **Modelo \`${model}\` não está baixado localmente.**`,
                '',
                'Rode no terminal:',
                '',
                '```bash',
                `ollama pull ${model}`,
                '```',
                '',
                'O download pode demorar alguns minutos (4–9 GB dependendo do modelo).',
                'Você pode acompanhar o progresso no terminal.',
            ].join('\n');
        }
        // Timeout
        if (code === 'ECONNABORTED' || /timeout/i.test(String(err && err.message))) {
            return [
                `⚠️ **Ollama Local demorou demais pra responder (${REQUEST_TIMEOUT_MS / 1000}s).**`,
                '',
                'Possíveis causas:',
                `- Modelo \`${model}\` muito pesado pra sua GPU/CPU`,
                '- Primeira execução (Ollama está carregando o modelo na RAM)',
                '',
                'Tente um modelo menor nas Configurações ou aguarde e refaça a pergunta.',
            ].join('\n');
        }
        // Erro genérico
        return [
            '⚠️ **Erro ao chamar Ollama Local.**',
            '',
            `Detalhe: ${(err && err.message) || 'desconhecido'}${msg ? ` — ${msg}` : ''}`,
            '',
            'Verifique se `ollama serve` está rodando e tente novamente.',
        ].join('\n');
    }

    async responder(texto) {
        if (!texto) throw new Error('Não entendi');
        const model = this._model();
        const host = this._host();
        const sessionId = 'default';
        const now = Date.now();
        const twoHours = 2 * 60 * 60 * 1000;

        if (this.sessions[sessionId] && (now - this.sessions[sessionId].lastActivity > twoHours)) {
            delete this.sessions[sessionId];
            console.log('[ollamaLocal] sessão expirou');
        }

        if (!this.sessions[sessionId]) {
            const promptInstruction = configService.getPromptInstruction();
            this.sessions[sessionId] = {
                messages: [
                    { role: 'system', content: promptInstruction || 'You are a helpful assistant.' },
                ],
                lastActivity: now,
            };
        }

        this.sessions[sessionId].messages.push({ role: 'user', content: texto });
        this.sessions[sessionId].lastActivity = now;

        // Trim: system + últimas 6 mensagens (3 Q&A)
        if (this.sessions[sessionId].messages.length > 7) {
            const sys = this.sessions[sessionId].messages[0];
            this.sessions[sessionId].messages = [sys, ...this.sessions[sessionId].messages.slice(-6)];
        }

        try {
            console.log(`[ollamaLocal] → ${model} @ ${host} (msgs=${this.sessions[sessionId].messages.length})`);
            const r = await axios.post(
                `${host}/api/chat`,
                {
                    model,
                    messages: this.sessions[sessionId].messages,
                    stream: false,
                    options: {
                        temperature: 0.7,
                        num_ctx: 8192,
                    },
                },
                { timeout: REQUEST_TIMEOUT_MS, headers: { 'Content-Type': 'application/json' } }
            );
            const content = (r.data && r.data.message && r.data.message.content) || '';
            if (!content) {
                throw new Error('Resposta vazia do Ollama');
            }
            this.sessions[sessionId].messages.push({ role: 'assistant', content });
            return content;
        } catch (err) {
            // Remove user message pra não poluir histórico em erro
            this.sessions[sessionId].messages.pop();
            const friendly = this._classifyError(err, model);
            console.error('[ollamaLocal] erro:', err && err.message);
            // Devolve a mensagem amigável como se fosse a resposta — UI mostra
            // formatado em markdown. Não throw, pra não cair no fluxo de erro
            // genérico que só diz "Failed to process IA response".
            return friendly;
        }
    }

    resetSession() {
        delete this.sessions['default'];
    }
}

module.exports = new OllamaLocalService();
