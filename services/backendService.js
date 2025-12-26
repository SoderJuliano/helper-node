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

class BackendService {
  constructor() {
    this.sessions = {};
  }

  // Helper method to manage session context
  manageSessionContext(sessionId, userMessage) {
    const now = Date.now();
    const twoHours = 2 * 60 * 60 * 1000;

    // Clear session if inactive for more than 2 hours
    if (this.sessions[sessionId] && (now - this.sessions[sessionId].lastActivity > twoHours)) {
      delete this.sessions[sessionId];
      console.log('Backend session expired and was cleared.');
    }

    // Create a new session if it doesn't exist
    if (!this.sessions[sessionId]) {
      console.log('Creating new Backend session.');
      const promptInstruction = configService.getPromptInstruction();
      this.sessions[sessionId] = {
        messages: [
          { role: 'system', content: promptInstruction || 'You are a helpful assistant.' }
        ],
        lastActivity: now
      };
    }

    // Add user's prompt to the session history
    this.sessions[sessionId].messages.push({ role: 'user', content: userMessage });
    this.sessions[sessionId].lastActivity = now;

    // Keep only last 3 questions and answers (6 messages + system message = 7 total)
    if (this.sessions[sessionId].messages.length > 7) {
      const systemMessage = this.sessions[sessionId].messages[0];
      const recentMessages = this.sessions[sessionId].messages.slice(-6);
      this.sessions[sessionId].messages = [systemMessage, ...recentMessages];
      console.log('Backend session trimmed to last 3 Q&A pairs');
    }

    // Build conversation context for backend
    let conversationContext = '';
    for (let i = 1; i < this.sessions[sessionId].messages.length; i++) {
      const msg = this.sessions[sessionId].messages[i];
      if (msg.role === 'user') {
        conversationContext += `Human: ${msg.content}\n`;
      } else if (msg.role === 'assistant') {
        conversationContext += `Assistant: ${msg.content}\n`;
      }
    }

    return conversationContext;
  }

  addAssistantResponse(sessionId, response) {
    if (this.sessions[sessionId]) {
      this.sessions[sessionId].messages.push({ role: 'assistant', content: response });
    }
  }

  removeLastUserMessage(sessionId) {
    if (this.sessions[sessionId] && this.sessions[sessionId].messages.length > 0) {
      const lastMessage = this.sessions[sessionId].messages[this.sessions[sessionId].messages.length - 1];
      if (lastMessage.role === 'user') {
        this.sessions[sessionId].messages.pop();
      }
    }
  }

  async getLastEnvUrl() {
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

  async getApiUrl() {
    if (!apiUrl) {
      await this.getLastEnvUrl();
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
      await this.getLastEnvUrl();
    }

    // Se ainda não tiver a URL, lança um erro
    if (!apiUrl) {
      throw new Error("Could not retrieve backend URL.");
    }

    const sessionId = 'default'; // Using a single session for now
    
    // Manage session context (adds user message and builds context)
    const conversationContext = this.manageSessionContext(sessionId, texto);

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
      
      // Build prompt with conversation context
      const promptWithContext = conversationContext 
        ? `${promptInstruction}\n\nConversation context:\n${conversationContext}\nPlease respond to the latest human message.`
        : `${promptInstruction}${texto}`;

      const body = {
        newPrompt: promptWithContext,
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

      console.log('Backend prompt with context:', promptWithContext);

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

      // Add assistant response to session history
      this.addAssistantResponse(sessionId, resposta);

      return resposta;
    } catch (error) {
      console.error("Erro ao chamar o backend:", error.message);

      // Remove the last user message if the API call fails to avoid cluttering the history
      this.removeLastUserMessage('default');

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
      await this.getLastEnvUrl();
    }

    // Se ainda não tiver a URL, lança um erro
    if (!apiUrl) {
      throw new Error("Could not retrieve backend URL.");
    }

    const sessionId = 'default'; // Using a single session for now
    
    // Manage session context (adds user message and builds context)
    const conversationContext = this.manageSessionContext(sessionId, texto);

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
      
      // Build prompt with conversation context
      const promptWithContext = conversationContext 
        ? `${promptInstruction}\n\nConversation context:\n${conversationContext}\nPlease respond to the latest human message.`
        : `${promptInstruction}${texto}`;

      const body = {
        newPrompt: promptWithContext,
        ip: ip,
        email: "julianosoder.js@gmail.com",
        agent: false,
        language: mappedLang,
      };

      console.log('Backend stream prompt with context:', promptWithContext);

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
      let fullResponse = ''; // Track complete response for session

      while (true) {
        const { done, value } = await reader.read();
        
        if (done) {
          // Add complete response to session history
          if (fullResponse) {
            this.addAssistantResponse(sessionId, fullResponse);
          }
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
              // Add complete response to session history
              if (fullResponse) {
                this.addAssistantResponse(sessionId, fullResponse);
              }
              if (onComplete) onComplete();
              return;
            }

            try {
              const parsed = JSON.parse(data);
              let token = parsed.response || parsed.message || data;
              
              if (typeof token === 'string' && token) {
                console.log('Token recebido do backend:', JSON.stringify(token));
                
                // Track full response
                fullResponse += token;
                
                // Backend já adiciona espaços, só passa direto
                if (onChunk) onChunk(token);
              }
            } catch (e) {
              // Se não for JSON, trata como texto direto
              let token = data;
              
              if (typeof token === 'string' && token.toLowerCase() !== 'done' && token) {
                console.log('Token recebido (raw):', JSON.stringify(token));
                
                // Track full response
                fullResponse += token;
                
                if (onChunk) onChunk(token);
              }
            }
          }
        }
      }
    } catch (error) {
      console.error("Erro ao chamar o backend stream:", error.message);
      
      // Remove the last user message if the API call fails
      this.removeLastUserMessage(sessionId);
      
      if (onError) onError(error);
      throw error;
    }
  }

}

module.exports = new BackendService();
