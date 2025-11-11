const { exec } = require('child_process');

class GeminiService {
    // async responder(texto) {
    //     if (!texto) throw new Error('Não entendi');
    //     try {
    //         const prompt = `Como responder essa questão em com até 65 palavras: ${texto}`;
    //         console.log(prompt);
    //         const command = `gemini -d "${prompt}"`;

    //         return new Promise((resolve, reject) => {
    //             exec(command, (error, stdout, stderr) => {
    //                 if (error) {
    //                     console.error('Erro ao chamar Gemini:', stderr);
    //                     reject(new Error('Falha ao processar a resposta do Gemini'));
    //                 } else {
    //                     console.log('Gemini response:', stdout);
    //                     const formattedResposta = this.formatToHTML(stdout);
    //                     resolve(formattedResposta);
    //                 }
    //             });
    //         });
    //     } catch (error) {
    //         console.error('Erro ao chamar Gemini:', error.message);
    //         throw new Error('Falha ao processar a resposta do Gemini');
    //     }
    // }

    // async responder(texto) {
    //     if (!texto) throw new Error('Não entendi');
    //     try {
    //         const prompt = `Como responder essa questão em com até 65 palavras: ${texto}`;
    //         console.log(prompt);
    //         const command = `gemini -d "${prompt}"`;

    //         return new Promise((resolve, reject) => {
    //             exec(command, (error, stdout, stderr) => {
    //                 if (error) {
    //                     console.error('Erro ao chamar Gemini:', stderr);
    //                     reject(new Error('Falha ao processar a resposta do Gemini'));
    //                 } else {
    //                     console.log('Raw Gemini response:', stdout);
    //                     const formattedResposta = this.formatToHTML(stdout);
    //                     resolve(formattedResposta);
    //                 }
    //             });
    //         });
    //     } catch (error) {
    //         console.error('Erro ao chamar Gemini:', error.message);
    //         throw new Error('Falha ao processar a resposta do Gemini');
    //     }
    // }

    async responder(texto) {
        if (!texto) throw new Error('Não entendi');
        try {
            const prompt = `Como responder essa questão em com até 65 palavras. Use markdown para blocos de código: ${texto}`;
            console.log(prompt);
            const command = `gemini -d "${prompt}"`;

            return new Promise((resolve, reject) => {
                exec(command, (error, stdout, stderr) => {
                    if (error) {
                        console.error('Erro ao chamar Gemini:', stderr);
                        reject(new Error('Falha ao processar a resposta do Gemini'));
                    } else {
                        console.log('Raw Gemini response:', stdout);
                        const formattedResposta = this.formatToHTML(stdout);
                        resolve(formattedResposta);
                    }
                });
            });
        } catch (error) {
            console.error('Erro ao chamar Gemini:', error.message);
            throw new Error('Falha ao processar a resposta do Gemini');
        }
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

        // Capturar código inline
        formatted = formatted.replace(/`([^`]+)`/g, '<code>$1</code>');

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
