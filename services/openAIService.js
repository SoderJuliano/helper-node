const { ipcMain } = require('electron');
const axios = require('axios');

class OpenAIService {
    constructor() {
        this.sessions = {};
    }

    initialize() {
        // This service is now initialized in main.js, but the request handling is done via direct calls,
        // not via ipc events to the service itself. This initialize method is kept for consistency.
    }

    async makeOpenAIRequest(prompt, token, instruction, model, imageBase64, opts = {}) {
        // opts.stateless = true  →  não usa nem grava histórico de sessão.
        //   Use pra capturas de tela / paste image: cada uma é independente,
        //   não faz sentido carregar a imagem anterior junto. Economiza tokens
        //   e evita confundir o modelo com contexto irrelevante.
        const stateless = !!opts.stateless;
        const sessionId = 'default'; // Using a single session for now
        const now = Date.now();
        const twoHours = 2 * 60 * 60 * 1000;

        // Clear session if inactive for more than 2 hours
        if (this.sessions[sessionId] && (now - this.sessions[sessionId].lastActivity > twoHours)) {
            delete this.sessions[sessionId];
            console.log('OpenAI session expired and was cleared.');
        }

        // Create a new session if it doesn't exist
        if (!this.sessions[sessionId]) {
            console.log('Creating new OpenAI session.');
            this.sessions[sessionId] = {
                messages: [{ role: 'system', content: instruction || 'You are a helpful assistant.' }],
                lastActivity: now
            };
        }

        // Build user message — multimodal if image fornecida
        let userMessage;
        if (imageBase64) {
            // Detecta prefixo data: já presente; senão assume PNG
            const dataUrl = imageBase64.startsWith('data:')
                ? imageBase64
                : `data:image/png;base64,${imageBase64}`;
            userMessage = {
                role: 'user',
                content: [
                    { type: 'text', text: prompt || 'Analise a imagem e responda diretamente.' },
                    { type: 'image_url', image_url: { url: dataUrl, detail: 'high' } },
                ],
            };
        } else {
            userMessage = { role: 'user', content: prompt };
        }

        // Stateless: monta messages do zero, sem persistir nada.
        const messages = stateless
            ? [
                { role: 'system', content: instruction || 'You are a helpful assistant.' },
                userMessage,
              ]
            : (this.sessions[sessionId].messages.push(userMessage),
               this.sessions[sessionId].lastActivity = now,
               this.sessions[sessionId].messages);

        const requestPayload = {
            model: model || 'gpt-4.1-nano',
            messages: messages,
        };

        // helperTools: se o caller passou tools[] (schema OpenAI), entra em loop de tool-calling
        const tools = Array.isArray(opts.tools) && opts.tools.length ? opts.tools : null;
        const onToolCall = typeof opts.onToolCall === 'function' ? opts.onToolCall : null;
        const maxToolCalls = Number.isInteger(opts.maxToolCalls) ? opts.maxToolCalls : 5;
        if (tools && onToolCall) {
            requestPayload.tools = tools;
            requestPayload.tool_choice = 'auto';
        }

        // Log enxuto: só metadata útil. Sem despejar system prompt nem base64.
        const msgCount = requestPayload.messages.length;
        const lastUser = requestPayload.messages[requestPayload.messages.length - 1];
        let userPreview = '';
        if (lastUser && Array.isArray(lastUser.content)) {
            const txt = lastUser.content.find(c => c.type === 'text');
            const img = lastUser.content.find(c => c.type === 'image_url');
            const imgKB = img ? Math.round((img.image_url.url.length * 3) / 4 / 1024) : 0;
            userPreview = `[text: ${(txt && txt.text || '').slice(0, 60)}…] [image: ${imgKB} KB]`;
        } else if (lastUser) {
            userPreview = `[text: ${(lastUser.content || '').toString().slice(0, 60)}…]`;
        }
        const toolsTag = tools ? ` tools=${tools.length}` : '';
        console.log(`📤 OpenAI → model=${requestPayload.model} msgs=${msgCount}${toolsTag} ${userPreview}`);

        const postOnce = async () => axios.post(
            'https://api.openai.com/v1/chat/completions',
            requestPayload,
            { headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' } }
        );

        try {
            // Caminho simples (sem tools): comportamento original preservado
            if (!tools || !onToolCall) {
                const response = await postOnce();
                console.log('Received response from OpenAI API.');
                const assistantResponse = response.data.choices[0].message.content;
                if (!stateless) {
                    this.sessions[sessionId].messages.push({ role: 'assistant', content: assistantResponse });
                }
                return assistantResponse;
            }

            // ── Loop de tool-calling ───────────────────────────────────────
            let iterations = 0;
            while (iterations <= maxToolCalls) {
                const response = await postOnce();
                const choice = response.data.choices[0];
                const msg = choice.message;

                // Sem mais tool calls → resposta final
                if (!msg.tool_calls || msg.tool_calls.length === 0) {
                    const finalText = msg.content || '';
                    if (!stateless) {
                        this.sessions[sessionId].messages.push({ role: 'assistant', content: finalText });
                    }
                    console.log(`🛠️  tool-calling concluído após ${iterations} iteraç${iterations === 1 ? 'ão' : 'ões'}`);
                    return finalText;
                }

                if (iterations === maxToolCalls) {
                    console.warn(`⚠️  maxToolCalls=${maxToolCalls} atingido; abortando loop e devolvendo fallback`);
                    const fallback = msg.content || '(Limite de chamadas de ferramentas atingido sem resposta final.)';
                    if (!stateless) {
                        this.sessions[sessionId].messages.push({ role: 'assistant', content: fallback });
                    }
                    return fallback;
                }

                // Empurra a assistant message com tool_calls no histórico desta requisição
                requestPayload.messages.push({
                    role: 'assistant',
                    content: msg.content || null,
                    tool_calls: msg.tool_calls,
                });

                // Executa cada tool e devolve o resultado
                for (const tc of msg.tool_calls) {
                    const name = tc.function && tc.function.name;
                    let args = {};
                    try {
                        args = tc.function && tc.function.arguments
                            ? JSON.parse(tc.function.arguments)
                            : {};
                    } catch (e) {
                        args = { __parseError: String(e && e.message), raw: tc.function && tc.function.arguments };
                    }
                    console.log(`🛠️  tool_call → ${name}(${JSON.stringify(args).slice(0, 120)})`);
                    let result;
                    try {
                        result = await onToolCall(name, args, { toolCallId: tc.id });
                    } catch (e) {
                        result = { error: String(e && e.message || e) };
                    }
                    let serialized;
                    try {
                        serialized = typeof result === 'string' ? result : JSON.stringify(result);
                    } catch {
                        serialized = String(result);
                    }
                    // Limita a 16KB pra não estourar contexto
                    if (serialized.length > 16 * 1024) {
                        serialized = serialized.slice(0, 16 * 1024) + '\n…[truncated]';
                    }
                    requestPayload.messages.push({
                        role: 'tool',
                        tool_call_id: tc.id,
                        content: serialized,
                    });
                }

                iterations++;
            }

            // Não deve cair aqui
            return '(loop tool-calling encerrado inesperadamente.)';
        } catch (error) {
            console.error('Error calling OpenAI API:', error.response ? error.response.data : error.message);
            if (!stateless) {
                // Remove o último user pra não poluir o histórico
                this.sessions[sessionId].messages.pop();
            }
            throw new Error('Failed to get a response from OpenAI.');
        }
    }
}

module.exports = new OpenAIService();
