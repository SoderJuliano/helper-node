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

// === Roteamento de modelo Ollama (so backendService — nao toca OpenAI) ===
// Decide qual endpoint do proxy Java usar com base no conteudo da mensagem.
// Codigo/matematica/raciocinio tecnico -> qwen25 (14b, melhor reasoning).
// Resto -> llama3 (8b, default geral e conversa).
// NOTA: llamatiny (1b) foi removido do roteamento — muito burro pra
// conversar, parafraseia o pr\u00f3prio prompt. Mantemos o endpoint disponivel
// pro backend Java mas n\u00e3o roteamos nada pra ele aqui.
function pickOllamaEndpoint(texto) {
  const t = (texto || '').trim();
  if (!t) return '/llama3';

  // Sinais de codigo/matematica/raciocinio tecnico → qwen25
  // (operadores, sintaxe de linguagem, palavras-chave de tarefa pesada)
  const heavyRegex = /[=+\-*/%^<>]{1,3}|\b(function|class|def|var|let|const|import|return|if|else|while|for|switch)\b|[{};()[\]]|\b(calcule?|resolva|compute|derive|integre|fatore|prove|demonstre|implementa|implementar|c[oó]digo|fun[cç][aã]o|algoritmo|complexidade|otimiza|debug|stack trace|exception|exec[uú]ta|comando|shell|bash|sql|query|regex|json|yaml|xml)\b|\d+\s*[\+\-\*\/x×÷=]\s*\d+|`[^`]+`|```/i;
  if (heavyRegex.test(t)) return '/qwen25';

  return '/llama3';
}

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
      // === Roteamento de modelo Ollama ===
      // O backend Java expoe varios endpoints com modelos diferentes:
      //   /llamatiny  → llama3.2:1b ou similar (super rapido, conversa casual)
      //   /llama3     → llama3 8b (geral, default)
      //   /qwen25     → qwen2.5:14b (raciocinio tecnico, codigo, matematica)
      //   /gemma3     → gemma3 (alternativa)
      // Heuristica: casual curto -> llamatiny, tecnico/code/math -> qwen25, resto -> llama3.
      const modelEndpoint = pickOllamaEndpoint(texto);
      const endpoint = `${apiUrl}${modelEndpoint}`;
      console.log(`[backend] roteado para ${modelEndpoint} (${texto.slice(0, 40).replace(/\n/g, ' ')}...)`);
      const promptInstruction = configService.getPromptInstruction();
      
      // Build prompt with conversation context.
      // llamatiny (1b) NAO consegue ignorar marcadores tipo "Conversation context:"
      // — vira papagaio do template. Pra ele mandamos so a mensagem do user com
      // histórico simplificado. Pros maiores mantemos o template antigo que o
      // backend Java reconhece e processa.
      let promptWithContext;
      if (modelEndpoint === '/llamatiny') {
        // Histórico simplificado: ultimas 2-3 trocas, sem labels Human:/Assistant:.
        const lastMsgs = conversationContext
          ? conversationContext.split(/\n/).filter(Boolean).slice(-4).join('\n')
          : texto;
        promptWithContext = `${promptInstruction}\n\n${lastMsgs}`;
      } else {
        // Backend Java faz parsing em "Conversation context:" e "Please respond..."
        // — nao mudar sem alinhar com o servidor.
        promptWithContext = conversationContext 
          ? `${promptInstruction}\n\nConversation context:\n${conversationContext}\nPlease respond to the latest human message.`
          : `${promptInstruction}${texto}`;
      }

      // Backend Java espera ChatRequest(String prompt, String language).
      // Campos extras (ip, email, agent, newPrompt) sao ignorados pelo Jackson,
      // mas mandar so o necessario fica mais limpo.
      const body = {
        prompt: promptWithContext,
        language: mappedLang,
      };
      const headers = {
        Authorization: "Bearer Y3VzdG9tY3ZvbmxpbmU=",
        "Content-Type": "application/json",
        "ngrok-skip-browser-warning": "true",
      };

      console.log('Backend prompt with context:', promptWithContext);

      // Tenta no endpoint roteado; se 404 (modelo nao existe no proxy),
      // cai automaticamente pra /llama3 que sempre existe.
      let response;
      try {
        response = await axios.post(endpoint, body, { 
          headers,
          timeout: 180000,
          httpAgent,
          httpsAgent
        });
      } catch (errFirst) {
        const is404 = errFirst.response && errFirst.response.status === 404;
        if (is404 && modelEndpoint !== '/llama3') {
          console.warn(`[backend] ${modelEndpoint} indisponivel (404), caindo pra /llama3`);
          response = await axios.post(`${apiUrl}/llama3`, body, {
            headers,
            timeout: 180000,
            httpAgent,
            httpsAgent
          });
        } else {
          throw errFirst;
        }
      }

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
    // Validação mais robusta
    if (!texto || typeof texto !== 'string' || texto.trim().length === 0) {
      console.error('Texto inválido para streaming:', texto);
      onError(new Error("Texto inválido ou vazio"));
      return;
    }

    // Se a URL não foi pega ainda, tenta novamente
    if (!apiUrl) {
      console.log("API URL not found, fetching again...");
      await this.getLastEnvUrl();
    }

    // Se ainda não tiver a URL, lança um erro
    if (!apiUrl) {
      onError(new Error("Could not retrieve backend URL."));
      return;
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
      // Roteamento: mesma logica do responder() — escolhe modelo e usa
      // a versao -stream do endpoint (ex.: /qwen25-stream, /llamatiny-stream).
      const baseEndpoint = pickOllamaEndpoint(texto);
      const endpoint = `${apiUrl}${baseEndpoint}-stream`;
      console.log(`[backend-stream] roteado para ${baseEndpoint}-stream`);
      const promptInstruction = configService.getPromptInstruction();
      
      // Build prompt with conversation context (mesma logica de responder()).
      let promptWithContext;
      if (baseEndpoint === '/llamatiny') {
        const lastMsgs = conversationContext
          ? conversationContext.split(/\n/).filter(Boolean).slice(-4).join('\n')
          : texto;
        promptWithContext = `${promptInstruction}\n\n${lastMsgs}`;
      } else {
        promptWithContext = conversationContext 
          ? `${promptInstruction}\n\nConversation context:\n${conversationContext}\nPlease respond to the latest human message.`
          : `${promptInstruction}${texto}`;
      }

      const body = {
        prompt: promptWithContext,
        language: mappedLang,
      };

      console.log('Backend stream prompt with context:', promptWithContext);

      const fetchOpts = {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer Y3VzdG9tY3ZvbmxpbmU=',
          'Content-Type': 'application/json',
          'ngrok-skip-browser-warning': 'true',
        },
        body: JSON.stringify(body),
      };

      let response = await fetch(endpoint, fetchOpts);
      // Fallback automatico pra /llama3-stream se o endpoint roteado nao existe
      if (response.status === 404 && baseEndpoint !== '/llama3') {
        console.warn(`[backend-stream] ${baseEndpoint}-stream indisponivel (404), caindo pra /llama3-stream`);
        response = await fetch(`${apiUrl}/llama3-stream`, fetchOpts);
      }

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
