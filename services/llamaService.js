const axios = require('axios');

class LlamaService {
    async responder(texto) {
        if (!texto) throw new Error('Não entendi');
        try {
            const prompt = `Como responder essa questão em com até 60 palavras: ${texto}`;
            console.log(prompt);
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
            const formattedResposta = this.formatToHTML(resposta);
            return formattedResposta;
        } catch (error) {
            console.error('Erro ao chamar LLaMA:', error.message);
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

        // Capturar blocos de código
        formatted = formatted.replace(/```(\w+)?\n([\s\S]*?)\n```/g, (match, lang, code) => {
            const codeId = `code-block-${codeBlocks.length}`; // Define unique codeId
            const placeholder = `__CODE_BLOCK_${codeBlocks.length}__`;
            // Push single <pre> with copy button and code
            codeBlocks.push(
                `<pre><button class="copy-button" data-code-id="${codeId}">[Copy]</button><code id="${codeId}" class="language-${lang || 'text'}">${escapeHTML(code)}</code></pre>`
            );
            return placeholder;
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