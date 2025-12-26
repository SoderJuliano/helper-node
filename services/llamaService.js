const axios = require('axios');
const configService = require('./configService');

class LlamaService {
    constructor() {
        this.sessions = {};
    }

    async responder(texto) {
        if (!texto) throw new Error('Não entendi');
        try {
            const sessionId = 'default'; // Using a single session for now
            const now = Date.now();
            const twoHours = 2 * 60 * 60 * 1000;

            // Clear session if inactive for more than 2 hours
            if (this.sessions[sessionId] && (now - this.sessions[sessionId].lastActivity > twoHours)) {
                delete this.sessions[sessionId];
                console.log('Llama session expired and was cleared.');
            }

            // Create a new session if it doesn't exist
            if (!this.sessions[sessionId]) {
                console.log('Creating new Llama session.');
                const promptInstruction = configService.getPromptInstruction();
                this.sessions[sessionId] = {
                    messages: [
                        { role: 'system', content: promptInstruction || 'You are a helpful assistant.' }
                    ],
                    lastActivity: now
                };
            }

            // Add user's prompt to the session history
            this.sessions[sessionId].messages.push({ role: 'user', content: texto });
            this.sessions[sessionId].lastActivity = now;

            // Keep only last 3 questions and answers (6 messages + system message = 7 total)
            // System message (index 0) + last 6 messages (3 Q&A pairs)
            if (this.sessions[sessionId].messages.length > 7) {
                const systemMessage = this.sessions[sessionId].messages[0];
                const recentMessages = this.sessions[sessionId].messages.slice(-6);
                this.sessions[sessionId].messages = [systemMessage, ...recentMessages];
                console.log('Llama session trimmed to last 3 Q&A pairs');
            }

            // Format conversation for Llama (which doesn't use roles, just a single prompt)
            let conversationContext = '';
            for (let i = 1; i < this.sessions[sessionId].messages.length; i++) {
                const msg = this.sessions[sessionId].messages[i];
                if (msg.role === 'user') {
                    conversationContext += `Human: ${msg.content}\n`;
                } else if (msg.role === 'assistant') {
                    conversationContext += `Assistant: ${msg.content}\n`;
                }
            }

            const promptInstruction = configService.getPromptInstruction();
            const prompt = `${promptInstruction}\n\nConversation context:\n${conversationContext}\nPlease respond to the latest human message.`;
            
            console.log('Llama prompt with context:', prompt);
            
            const response = await axios.post('http://localhost:11434/api/generate', {
                model: 'llama3',
                prompt: prompt,
                stream: false
            }, {
                headers: {
                    'Content-Type': 'application/json'
                },
                timeout: 20000
            });

            const resposta = response.data.response;
            console.log('LLaMA response:', response.data);
            
            // Add assistant's response to the session history
            this.sessions[sessionId].messages.push({ role: 'assistant', content: resposta });
            
            const formattedResposta = this.formatToHTML(resposta);
            return formattedResposta;
        } catch (error) {
            console.error('Erro ao chamar LLaMA:', error.message);
            // Remove the last user message if the API call fails to avoid cluttering the history
            if (this.sessions.default && this.sessions.default.messages.length > 0) {
                const lastMessage = this.sessions.default.messages[this.sessions.default.messages.length - 1];
                if (lastMessage.role === 'user') {
                    this.sessions.default.messages.pop();
                }
            }
            throw new Error('Falha ao processar a resposta do LLaMA');
        }
    }

    formatToHTML(text) {
        if (!text) return '';

        const escapeHTML = (str) => {
            return str.replace(/&/g, '&').replace(/</g, '<').replace(/>/g, '>');
        };

        let formatted = text;
        const codeBlocks = [];

        // Capturar blocos de código multiline (```)
        formatted = formatted.replace(/```(\w+)?\n([\s\S]*?)\n```/g, (match, lang, code) => {
            const codeId = `code-block-${codeBlocks.length}`; // Define unique codeId
            const placeholder = `__CODE_BLOCK_${codeBlocks.length}__`;
            // Push single <pre> with copy button and code
            codeBlocks.push(
                `<pre><button class="copy-button" data-code-id="${codeId}">[Copy]</button><code id="${codeId}" class="language-${lang || 'text'}">${escapeHTML(code)}</code></pre>`
            );
            return placeholder;
        });

        // Capturar código inline (`codigo`)
        formatted = formatted.replace(/`([^`]+)`/g, (match, code) => {
            return `<code style="background-color: rgba(0,0,0,0.3); padding: 2px 6px; border-radius: 3px; font-family: 'Courier New', monospace;">${escapeHTML(code)}</code>`;
        });

        const lines = formatted.split('\n');
        const formattedLines = [];

        for (let line of lines) {
            if (line.match(/__CODE_BLOCK_\d+__/)) {
                formattedLines.push(line);
                continue;
            }

            line = line.replace(/\*\*(.*?)\*\*|__(.*?)__/g, '<strong>$1$2</strong>');
            line = line.replace(/(?<!\*)\*(.*?)\*(?!\*)|_(.*?)_/g, '<em>$1$2</em>');
            if (line.match(/^\s*[-*]\s+(.+)/)) {
                line = line.replace(/^\s*[-*]\s+(.+)/, '<li>$1</li>');
            } else if (line.trim()) {
                line = `<p>${line}</p>`;
            }

            formattedLines.push(line);
        }

        formatted = formattedLines.filter(line => line.trim()).join('<br>');

        if (formatted.includes('<li>')) {
            formatted = formatted.replace(/(<li>.*?(?:<br>|$))/g, '$1')
                .replace(/(<li>.*?(?:<br>|$)(?:<li>.*?(?:<br>|$))*)/g, '<ul>$1</ul>');
            formatted = formatted.replace(/<ul><br>|<br><\/ul>/g, '');
        }

        codeBlocks.forEach((block, index) => {
            formatted = formatted.replace(`__CODE_BLOCK_${index}__`, block);
        });

        formatted = formatted.replace(/(<br>)+$/, '').replace(/^(<br>)+/, '');
        return formatted;
    }
}

module.exports = new LlamaService();