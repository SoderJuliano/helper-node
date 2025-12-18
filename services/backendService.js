const axios = require("axios");
const configService = require("./configService");
const { getIp } = require("./configService");
const https = require('https');
const http = require('http');

// Configurar agentes HTTP/HTTPS com keepAlive para evitar socket hang up
const httpAgent = new http.Agent({
  keepAlive: true,
  keepAliveMsecs: 60000,
  maxSockets: 50,
  maxFreeSockets: 10,
  timeout: 180000
});

const httpsAgent = new https.Agent({
  keepAlive: true,
  keepAliveMsecs: 60000,
  maxSockets: 50,
  maxFreeSockets: 10,
  timeout: 180000
});

// Variável para armazenar a URL da API
let apiUrl = "";

// Função para buscar a URL da API do serviço externo
async function getLastEnvUrl() {
  try {
    const response = await axios.get(
      "https://abra-api.top/notifications/retrieve?key=ngrockurl"
    );
    const data = response.data;

    if (Array.isArray(data) && data.length > 0) {
      const lastNotification = data[data.length - 1];
      if (lastNotification && lastNotification.content) {
        apiUrl = lastNotification.content;
        console.log(`Updated API URL to: ${apiUrl}`);
      } else {
        console.error("No valid content found in the last notification.");
      }
    } else {
      console.error(
        "No data received or empty array from notification service."
      );
    }
  } catch (error) {
    console.error("Error fetching API URL:", error);
    // Fallback or error handling
    apiUrl = ""; // Reset or use a default
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
        Authorization: "Bearer Y3VzdG9tY3ZvbmxpbmU=",
        "Content-Type": "application/json",
        "ngrok-skip-browser-warning": "true",
      };
      const response = await axios.get(`${url}/ping`, {
        headers,
        timeout: 5000,
        httpAgent,
        httpsAgent
      });
      return response.status === 200;
    } catch (error) {
      console.error("Ping failed:", error.message);
      return false;
    }
  }

  async responder(texto) {
    if (!texto) throw new Error("Não entendi");

    // Se a URL não foi pega ainda, tenta novamente
    if (!apiUrl) {
      console.log("API URL not found, fetching again...");
      await getLastEnvUrl();
    }

    // Se ainda não tiver a URL, lança um erro
    if (!apiUrl) {
      throw new Error("Could not retrieve backend URL.");
    }

    const ip = await configService.getIp();
    // PEGAR LINGUAGEM SALVA
    const lang = configService.getLanguage();

    // MAPEAR PARA O BACKEND
    const langMap = {
      'pt-br': 'PORTUGUESE',
      'us-en': 'ENGLISH'
    };
    const mappedLang = langMap[lang] || 'PORTUGUESE';

    try {
      const endpoint = `${apiUrl}/llama3`;
      const promptInstruction = configService.getPromptInstruction();
      const body = {
        newPrompt: `${promptInstruction}${texto}`,
        ip: ip,
        email: "julianosoder.js@gmail.com",
        agent: false,
        language: mappedLang,
      };
      const headers = {
        Authorization: "Bearer Y3VzdG9tY3ZvbmxpbmU=",
        "Content-Type": "application/json",
        "ngrok-skip-browser-warning": "true",
      };

      const response = await axios.post(endpoint, body, { 
        headers,
        timeout: 180000, // 180 segundos para dar tempo do LLM processar
        httpAgent,
        httpsAgent
      });

      console.log(
        "Backend response data:",
        JSON.stringify(response.data, null, 2)
      );

      if (!response.data) {
        throw new Error("Empty response from backend");
      }

      // Assumindo que a resposta do seu backend tem o mesmo formato do Ollama ou retorna o texto diretamente
      const resposta = response.data.response || response.data;

      return resposta;
    } catch (error) {
      console.error("Erro ao chamar o backend:", error.message);

      // Se for um erro de HTTP (como 422, 404, etc.), a resposta do servidor está em error.response
      if (error.response) {
        console.error("--- DETALHES DO ERRO DO BACKEND ---");
        console.error("Status:", error.response.status);
        console.error("Data:", JSON.stringify(error.response.data, null, 2));
        console.error("------------------------------------");
      }

      // Se for timeout ou socket hang up, não limpa a URL (o backend está funcionando, só demorou)
      if (error.code === "ECONNABORTED" || error.message.includes("socket hang up")) {
        console.log("Request timeout or connection closed - backend is processing but took too long");
        throw new Error(
          `Backend está processando mas a resposta demorou. Tente aumentar o timeout.`
        );
      }

      // Se der erro de rede, pode ser que a URL mudou. Limpamos para buscar de novo na próxima vez.
      if (error.code === "ECONNREFUSED" || error.response?.status === 404) {
        console.log("Backend URL might be outdated. Clearing it.");
        apiUrl = "";
      }
      throw new Error(
        `Falha ao processar a resposta do backend. Status: ${
          error.response?.status || "N/A"
        }`
      );
    }
  }

  async responderStream(texto, onChunk, onComplete, onError) {
    if (!texto) throw new Error("Não entendi");

    // Se a URL não foi pega ainda, tenta novamente
    if (!apiUrl) {
      console.log("API URL not found, fetching again...");
      await getLastEnvUrl();
    }

    // Se ainda não tiver a URL, lança um erro
    if (!apiUrl) {
      throw new Error("Could not retrieve backend URL.");
    }

    const ip = await configService.getIp();
    const lang = configService.getLanguage();

    const langMap = {
      'pt-br': 'PORTUGUESE',
      'us-en': 'ENGLISH'
    };
    const mappedLang = langMap[lang] || 'PORTUGUESE';

    try {
      const endpoint = `${apiUrl}/llama3-stream`;
      const promptInstruction = configService.getPromptInstruction();
      const body = {
        newPrompt: `${promptInstruction}${texto}`,
        ip: ip,
        email: "julianosoder.js@gmail.com",
        agent: false,
        language: mappedLang,
      };

      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer Y3VzdG9tY3ZvbmxpbmU=',
          'Content-Type': 'application/json',
          'ngrok-skip-browser-warning': 'true',
        },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        
        if (done) {
          if (onComplete) onComplete();
          break;
        }

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        
        // Guarda a última linha incompleta
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6).trim();
            
            // Ignora marcadores de fim
            if (data === '[DONE]' || data.toLowerCase() === 'done') {
              if (onComplete) onComplete();
              return;
            }

            try {
              const parsed = JSON.parse(data);
              let token = parsed.response || parsed.message || data;
              
              if (typeof token === 'string' && token) {
                console.log('Token recebido do backend:', JSON.stringify(token));
                
                // Backend já adiciona espaços, só passa direto
                if (onChunk) onChunk(token);
              }
            } catch (e) {
              // Se não for JSON, trata como texto direto
              let token = data;
              
              if (typeof token === 'string' && token.toLowerCase() !== 'done' && token) {
                console.log('Token recebido (raw):', JSON.stringify(token));
                if (onChunk) onChunk(token);
              }
            }
          }
        }
      }
    } catch (error) {
      console.error("Erro ao chamar o backend stream:", error.message);
      if (onError) onError(error);
      throw error;
    }
  }

}

module.exports = new BackendService();
