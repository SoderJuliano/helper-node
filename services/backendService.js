const axios = require('axios');
const configService = require('./configService');
const {getIp} = require("./configService");

// Variável para armazenar a URL da API
let apiUrl = '';

// Função para buscar a URL da API do serviço externo
async function getLastEnvUrl() {
  try {
    const response = await axios.get('https://abra-api.top/notifications/retrieve?key=ngrockurl');
    const data = response.data;

    if (Array.isArray(data) && data.length > 0) {
      const lastNotification = data[data.length - 1];
      if (lastNotification && lastNotification.content) {
        apiUrl = lastNotification.content;
        console.log(`Updated API URL to: ${apiUrl}`);
      } else {
        console.error('No valid content found in the last notification.');
      }
    } else {
      console.error('No data received or empty array from notification service.');
    }
  } catch (error) {
    console.error('Error fetching API URL:', error);
    // Fallback or error handling
    apiUrl = ''; // Reset or use a default
  }
}

class BackendService {
    constructor() {
        // Pega a URL da API ao iniciar o serviço, mas não espera
        getLastEnvUrl(); 
    }

    async getApiUrl() {
        if (!apiUrl) {
            await getLastEnvUrl();
        }
        return apiUrl;
    }

    async ping() {
        const url = await this.getApiUrl();
        if (!url) {
            return false;
        }

        try {
            const headers = {
                'Authorization': 'Bearer Y3VzdG9tY3ZvbmxpbmU=',
                'Content-Type': 'application/json',
                'ngrok-skip-browser-warning': 'true',
            };
            const response = await axios.get(`${url}/ping`, { headers, timeout: 5000 });
            return response.status === 200;
        } catch (error) {
            console.error('Ping failed:', error.message);
            return false;
        }
    }

    async responder(texto) {
        if (!texto) throw new Error('Não entendi');

        // Se a URL não foi pega ainda, tenta novamente
        if (!apiUrl) {
            console.log('API URL not found, fetching again...');
            await getLastEnvUrl();
        }

        // Se ainda não tiver a URL, lança um erro
        if (!apiUrl) {
            throw new Error('Could not retrieve backend URL.');
        }

        const ip = await configService.getIp();

        try {
            const endpoint = `${apiUrl}/llama3`;
            const promptInstruction = configService.getPromptInstruction();
            const body = {
                newPrompt: `${promptInstruction}${texto}`,
                ip: ip,
                email: 'julianosoder1989@gmail.com', // Valor estático como exemplo
                agent: false,
                language: 'PORTUGUESE'
            };
            const headers = {
                'Authorization': 'Bearer Y3VzdG9tY3ZvbmxpbmU=',
                'Content-Type': 'application/json',
                'ngrok-skip-browser-warning': 'true',
            };

            const response = await axios.post(endpoint, body, { headers });

            console.log('Backend response data:', JSON.stringify(response.data, null, 2));

            if (!response.data) {
                throw new Error('Empty response from backend');
            }

            // Assumindo que a resposta do seu backend tem o mesmo formato do Ollama ou retorna o texto diretamente
            const resposta = response.data.response || response.data;

            const formattedResposta = this.formatToHTML(resposta);
            return formattedResposta;
        } catch (error) {
            console.error('Erro ao chamar o backend:', error.message);

            // Se for um erro de HTTP (como 422, 404, etc.), a resposta do servidor está em error.response
            if (error.response) {
                console.error('--- DETALHES DO ERRO DO BACKEND ---');
                console.error('Status:', error.response.status);
                console.error('Data:', JSON.stringify(error.response.data, null, 2));
                console.error('------------------------------------');
            }

            // Se der erro de rede, pode ser que a URL mudou. Limpamos para buscar de novo na próxima vez.
            if (error.code === 'ECONNREFUSED' || error.response?.status === 404) {
                console.log('Backend URL might be outdated. Clearing it.');
                apiUrl = '';
            }
            throw new Error(`Falha ao processar a resposta do backend. Status: ${error.response?.status || 'N/A'}`);
        }
    }

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

module.exports = new BackendService();
