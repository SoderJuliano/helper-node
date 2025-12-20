const { exec } = require('child_process');
const configService = require('./configService');

class GeminiService {
    constructor() {
        this.currentProcess = null;
    }

    async responder(texto) {
        if (!texto) throw new Error('Não entendi');
        
        // Cancela o processo anterior se houver
        if (this.currentProcess) {
            this.currentProcess.kill('SIGTERM');
            this.currentProcess = null;
        }
        
        try {
            const promptInstruction = configService.getPromptInstruction();
            const prompt = `${promptInstruction}${texto}`;
            console.log(prompt);
            const command = `gemini -d "${prompt}"`;

            return new Promise((resolve, reject) => {
                this.currentProcess = exec(command, (error, stdout, stderr) => {
                    this.currentProcess = null;
                    
                    if (error) {
                        if (error.signal === 'SIGTERM') {
                            reject(new Error('Request cancelled'));
                        } else {
                            console.error('Erro ao chamar Gemini:', stderr);
                            reject(new Error('Falha ao processar a resposta do Gemini'));
                        }
                    } else {
                        console.log('Raw Gemini response:', stdout);
                        const formattedResposta = this.formatToHTML(stdout);
                        resolve(formattedResposta);
                    }
                });
            });
        } catch (error) {
            this.currentProcess = null;
            console.error('Erro ao chamar Gemini:', error.message);
            throw new Error('Falha ao processar a resposta do Gemini');
        }
    }
    
    cancelCurrentRequest() {
        if (this.currentProcess) {
            this.currentProcess.kill('SIGTERM');
            this.currentProcess = null;
            return true;
        }
        return false;
    }

    // formatToHTML(text) {
    //     if (!text) return '';

    //     const escapeHTML = (str) => {
    //         return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    //     };

    //     let formatted = text;
    //     const codeBlocks = [];

    //     // Capturar blocos de código
    //     formatted = formatted.replace(/```(\w+)?\n([\s\S]*?)\n```/g, (match, lang, code) => {
    //         const codeId = `code-block-${codeBlocks.length}`;
    //         const placeholder = `__CODE_BLOCK_${codeBlocks.length}__`;
    //         // Push single <pre> with copy button and code
    //         codeBlocks.push(
    //             `<pre><button class="copy-button" data-code-id="${codeId}">[Copy]</button><code id="${codeId}" class="language-${lang || 'text'}">${escapeHTML(code)}</code></pre>`
    //         );
    //         return placeholder;
    //     });

    //     const lines = formatted.split('\n');
    //     const formattedLines = [];

    //     for (let line of lines) {
    //         if (line.match(/__CODE_BLOCK_\d+__/)) {
    //             formattedLines.push(line);
    //             continue;
    //         }

    //         line = line.replace(/\*\*(.*?)\*\*|__(.*?)__/g, '<strong>$1$2</strong>');
    //         line = line.replace(/(?<!\*)\*(.*?)\*(?!\*)|_(.*?)_/g, '<em>$1$2</em>');
    //         if (line.match(/^\s*[-*]\s+(.+)/)) {
    //             line = line.replace(/^\s*[-*]\s+(.+)/, '<li>$1</li>');
    //         } else if (line.trim()) {
    //             line = `<p>${line}</p>`;
    //         }

    //         formattedLines.push(line);
    //     }

    //     formatted = formattedLines.filter(line => line.trim()).join('<br>');

    //     if (formatted.includes('<li>')) {
    //         formatted = formatted.replace(/(<li>.*?(?:<br>|$))/g, '$1')
    //             .replace(/(<li>.*?(?:<br>|$)(?:<li>.*?(?:<br>|$))*)/g, '<ul>$1</ul>');
    //         formatted = formatted.replace(/<ul><br>|<br><\/ul>/g, '');
    //     }

    //     codeBlocks.forEach((block, index) => {
    //         formatted = formatted.replace(`__CODE_BLOCK_${index}__`, block);
    //     });

    //     formatted = formatted.replace(/(<br>)+$/, '').replace(/^(<br>)+/, '');
    //     return formatted;
    // }

    // formatToHTML(text) {
    //     if (!text) return '';

    //     const escapeHTML = (str) => {
    //         return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    //     };

    //     let formatted = text;
    //     const codeBlocks = [];

    //     // Capturar blocos de código
    //     formatted = formatted.replace(/```(\w+)?\n([\s\S]*?)\n```/g, (match, lang, code) => {
    //         const codeId = `code-block-${codeBlocks.length}`;
    //         const placeholder = `__CODE_BLOCK_${codeBlocks.length}__`;
    //         // Push single <pre> with copy button and code
    //         codeBlocks.push(
    //             `<pre><button class="copy-button" data-code-id="${codeId}">[Copy]</button><code id="${codeId}" class="language-${lang || 'text'}">${escapeHTML(code)}</code></pre>`
    //         );
    //         return placeholder;
    //     });

    //     // Capturar código inline
    //     formatted = formatted.replace(/`([^`]+)`/g, '<code>$1</code>');

    //     const lines = formatted.split('\n');
    //     const formattedLines = [];

    //     for (let line of lines) {
    //         if (line.match(/__CODE_BLOCK_\d+__/)) {
    //             formattedLines.push(line);
    //             continue;
    //         }

    //         line = line.replace(/\*\*(.*?)\*\*|__(.*?)__/g, '<strong>$1$2</strong>');
    //         line = line.replace(/(?<!\*)\*(.*?)\*(?!\*)|_(.*?)_/g, '<em>$1$2</em>');
    //         if (line.match(/^\s*[-*]\s+(.+)/)) {
    //             line = line.replace(/^\s*[-*]\s+(.+)/, '<li>$1</li>');
    //         } else if (line.trim()) {
    //             line = `<p>${line}</p>`;
    //         }

    //         formattedLines.push(line);
    //     }

    //     formatted = formattedLines.filter(line => line.trim()).join('<br>');

    //     if (formatted.includes('<li>')) {
    //         formatted = formatted.replace(/(<li>.*?(?:<br>|$))/g, '$1')
    //             .replace(/(<li>.*?(?:<br>|$)(?:<li>.*?(?:<br>|$))*)/g, '<ul>$1</ul>');
    //         formatted = formatted.replace(/<ul><br>|<br><\/ul>/g, '');
    //     }

    //     codeBlocks.forEach((block, index) => {
    //         formatted = formatted.replace(`__CODE_BLOCK_${index}__`, block);
    //     });

    //     formatted = formatted.replace(/(<br>)+$/, '').replace(/^(<br>)+/, '');
    //     return formatted;
    // }

    // formatToHTML(text) {
    //     if (!text) return '';

    //     const escapeHTML = (str) => {
    //         return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    //     };

    //     let formatted = text;
    //     const codeBlocks = [];

    //     // Capturar blocos de código
    //     formatted = formatted.replace(/```(\w+)?\n([\s\S]*?)\n```/g, (match, lang, code) => {
    //         const codeId = `code-block-${codeBlocks.length}`;
    //         const placeholder = `__CODE_BLOCK_${codeBlocks.length}__`;
    //         // Push single <pre> with copy button and code
    //         codeBlocks.push(
    //             `<pre><button class="copy-button" data-code-id="${codeId}">🗐</button><code id="${codeId}" class="language-${lang || 'text'}">${escapeHTML(code)}</code></pre>`
    //         );
    //         return placeholder;
    //     });

    //     // Capturar código inline
    //     formatted = formatted.replace(/`([^`]+)`/g, '<code>$1</code>');

    //     const lines = formatted.split('\n');
    //     const formattedLines = [];

    //     for (let line of lines) {
    //         if (line.match(/__CODE_BLOCK_\d+__/)) {
    //             formattedLines.push(line);
    //             continue;
    //         }

    //         line = line.replace(/\*\*(.*?)\*\*|__(.*?)__/g, '<strong>$1$2</strong>');
    //         line = line.replace(/(?<!\*)\*(.*?)\*(?!\*)|_(.*?)_/g, '<em>$1$2</em>');
    //         if (line.match(/^\s*[-*]\s+(.+)/)) {
    //             line = line.replace(/^\s*[-*]\s+(.+)/, '<li>$1</li>');
    //         } else if (line.trim()) {
    //             line = `<p>${line}</p>`;
    //         }

    //         formattedLines.push(line);
    //     }

    //     formatted = formattedLines.filter(line => line.trim()).join('<br>');

    //     if (formatted.includes('<li>')) {
    //         formatted = formatted.replace(/(<li>.*?(?:<br>|$))/g, '$1')
    //             .replace(/(<li>.*?(?:<br>|$)(?:<li>.*?(?:<br>|$))*)/g, '<ul>$1</ul>');
    //         formatted = formatted.replace(/<ul><br>|<br><\/ul>/g, '');
    //     }

    //     codeBlocks.forEach((block, index) => {
    //         formatted = formatted.replace(`__CODE_BLOCK_${index}__`, block);
    //     });

    //     formatted = formatted.replace(/(<br>)+$/, '').replace(/^(<br>)+/, '');
    //     return formatted;
    // }

    formatToHTML(text) {
        if (!text) return '';

        const escapeHTML = (str) => {
            return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        };

        let formatted = text;
        const codeBlocks = [];

        // Capturar blocos de código
        formatted = formatted.replace(/```(\w+)?\n([\s\S]*?)\n```/g, (match, lang, code) => {
            const codeId = `code-block-${codeBlocks.length}`;
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

module.exports = new GeminiService();
