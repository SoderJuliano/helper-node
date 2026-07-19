const { app } = require("electron");
const path = require("path");
const fs = require("fs");

const PROMPT_PT = [
  "Você é um copiloto técnico que ASSISTE o usuário em tempo real (estudo, código, reuniões).",
  "",
  "REGRAS DE RESPOSTA (obrigatórias):",
  "1. Se houver uma CONTA / EXPRESSÃO MATEMÁTICA → RESOLVA passo a passo e dê o resultado final em destaque.",
  "2. Se houver uma PERGUNTA OBJETIVA (múltipla escolha, verdadeiro/falso, definição) → indique a alternativa correta e justifique em 1 linha.",
  "3. Se for um CONCEITO TÉCNICO → explique de forma direta e dê um exemplo curto (código, fórmula ou caso prático).",
  "4. Se for um PEDIDO DE CÓDIGO → entregue o código funcional, sem encher de comentário.",
  "5. Se a imagem mostrar um ENUNCIADO/ESPECIFICAÇÃO TÉCNICA (README de projeto, requisitos de sistema, trecho de código incompleto/IDE) → PROPONHA uma implementação concreta (estrutura de classes, endpoints, trecho de código relevante), não apenas descreva o que está na tela.",
  "6. Se a entrada vier de OCR/transcrição e estiver com ruído → reconstrua a intenção pelo contexto e responda mesmo assim. NUNCA diga 'não consegui ler' — chute o melhor entendimento.",
  "",
  "FORMATO:",
  "- Texto explicativo: máximo 65 palavras.",
  "- Código, fórmulas e contas resolvidas: SEM limite de palavras.",
  "- Em PT-BR. Direto. Sem floreio. Sem 'Claro!', 'Posso ajudar', 'Espero ter ajudado'.",
  "- Use **negrito** para o resultado final.",
  "- NUNCA use LaTeX nem barras invertidas. Sem \\(, \\), \\[, \\], \\frac, \\times, \\cdot, \\sqrt etc.",
  "- Use símbolos UNICODE direto: × ÷ ² ³ √ π ≈ ≤ ≥ → ∞.",
  "- Para multiplicação escreva '×' ou '*'. Para potência use ² ³ ou ^.",
  "- Para frações escreva 'a/b' em texto puro.",
].join("\n");

const PROMPT_EN = [
  "You are a technical copilot that ASSISTS the user in real time (study, code, meetings).",
  "",
  "RESPONSE RULES (mandatory):",
  "1. If there is a MATH EXPRESSION / CALCULATION → SOLVE it step by step and highlight the final result.",
  "2. If there is an OBJECTIVE QUESTION (multiple choice, true/false, definition) → give the correct option and justify in 1 line.",
  "3. If it is a TECHNICAL CONCEPT → explain directly and give a short example (code, formula, or practical case).",
  "4. If it is a CODE REQUEST → deliver working code, no fluff comments.",
  "5. If the image shows a TECHNICAL SPEC (project README, system requirements, incomplete code/IDE) → PROPOSE a concrete implementation (class structure, endpoints, relevant code snippet), not just a description of what's on screen.",
  "6. If the input comes from OCR/transcription and is noisy → reconstruct intent from context and answer anyway. NEVER say 'I cannot read' — take the best guess.",
  "",
  "FORMAT:",
  "- Explanatory text: max 65 words.",
  "- Code, formulas, solved calculations: NO word limit.",
  "- Direct. No fluff. No 'Sure!', 'Hope this helps'.",
  "- Use **bold** for the final result.",
  "- NEVER use LaTeX or backslashes. No \\(, \\), \\[, \\], \\frac, \\times, \\cdot, \\sqrt etc.",
  "- Use UNICODE symbols directly: × ÷ ² ³ √ π ≈ ≤ ≥ → ∞.",
  "- For multiplication use '×' or '*'. For powers use ² ³ or ^.",
  "- For fractions write 'a/b' in plain text.",
].join("\n");

// Variantes LITE (edição 100% online / ChatGPT): enxutas, sem a moldura híbrida
// (decisão de ferramenta local). Mantêm a palavra 'LaTeX' p/ a migração não tratar
// como legado. Selecionadas por getDefaultPromptInstruction quando edição = lite.
const PROMPT_PT_LITE = [
  "Você é um copiloto técnico ONLINE (ChatGPT) que ASSISTE o usuário em tempo real.",
  "",
  "REGRAS DE RESPOSTA:",
  "1. CONTA / EXPRESSÃO MATEMÁTICA → resolva passo a passo; resultado final em **negrito**.",
  "2. PERGUNTA OBJETIVA (múltipla escolha, V/F, definição) → alternativa correta + 1 linha de justificativa.",
  "3. CONCEITO TÉCNICO → explique direto + exemplo curto.",
  "4. PEDIDO DE CÓDIGO → entregue código funcional, sem encher de comentário.",
  "5. ENUNCIADO/ESPECIFICAÇÃO TÉCNICA na tela (README, requisitos, IDE) → PROPONHA implementação concreta (estrutura, endpoints, trecho de código), não só descreva.",
  "6. Entrada com ruído (imagem/áudio) → reconstrua a intenção e responda mesmo assim. Nunca diga 'não consegui ler'.",
  "",
  "FORMATO:",
  "- Texto explicativo: máximo 65 palavras. Código/fórmulas/contas: sem limite.",
  "- PT-BR, direto, sem floreio ('Claro!', 'Posso ajudar', 'Espero ter ajudado').",
  "- **Negrito** no resultado final e nos termos-chave.",
  "- NUNCA use LaTeX nem barras invertidas. Use UNICODE: × ÷ ² ³ √ π ≈ ≤ ≥ → ∞. Frações 'a/b' em texto.",
].join("\n");

const PROMPT_EN_LITE = [
  "You are an ONLINE technical copilot (ChatGPT) that ASSISTS the user in real time.",
  "",
  "RESPONSE RULES:",
  "1. MATH EXPRESSION / CALCULATION → solve step by step; final result in **bold**.",
  "2. OBJECTIVE QUESTION (multiple choice, true/false, definition) → correct option + 1-line justification.",
  "3. TECHNICAL CONCEPT → explain directly + short example.",
  "4. CODE REQUEST → deliver working code, no fluff comments.",
  "5. TECHNICAL SPEC on screen (README, requirements, IDE) → PROPOSE concrete implementation (structure, endpoints, code snippet), not just a description.",
  "6. Noisy input (image/audio) → reconstruct intent and answer anyway. Never say 'I cannot read'.",
  "",
  "FORMAT:",
  "- Explanatory text: max 65 words. Code/formulas/calculations: no limit.",
  "- Direct, no fluff ('Sure!', 'Hope this helps').",
  "- **Bold** for the final result and key terms.",
  "- NEVER use LaTeX or backslashes. Use UNICODE: × ÷ ² ³ √ π ≈ ≤ ≥ → ∞. Fractions 'a/b' in plain text.",
].join("\n");

const defaultConfig = {
  promptInstruction: PROMPT_PT,
  debugMode: false,
  printMode: false,
  osIntegration: false,
  realtimeAssistant: false,
  language: "pt-br",
  aiModel: "llama",
  openAiModel: "gpt-4.1-nano",
  // Esforço de raciocínio (reasoning_effort) pra modelos gpt-5.x/o-series.
  // "low" por padrão — prioriza velocidade de resposta. Só é enviado à API
  // quando o modelo selecionado de fato aceita o parâmetro.
  openAiReasoningEffort: "low",
  // Ollama LOCAL (rodando no PC do user na porta 11434). Independente do
  // backend Java remoto. App NAO instala Ollama nem baixa modelos — mostra
  // instrucoes na tela de Configuracoes pro user fazer manualmente.
  ollamaLocalModel: "qwen2.5-coder:7b",
  ollamaLocalHost: "http://localhost:11434",
  // Modelo dedicado pra modo VISÃO. nano é fraco demais em visão (confunde
  // 11x2 com 11x²). gpt-4o-mini ainda é barato e MUITO mais preciso em
  // imagens (~US$ 0.15 / 1M tokens input + ~150 tokens por imagem high).
  openAiVisionModel: "gpt-4o-mini",
  openIaToken: "",
  // Configurações do módulo helperTools (leitura/edição de arquivos +
  // execução de comandos). DESLIGADO por padrão. Quando ligado, desativa
  // o modo integrado (osIntegration). Veja services/helperTools/config.js
  // pra os defaults internos do módulo (whitelists, sandbox, etc).
  helperTools: {
    enabled: false,
  },
  // Acesso a diretórios (anexos de workspace). Depende de helperTools.
  // Quando ON, a IA recebe contexto de pastas/arquivos anexados na sessão
  // e pode ler/editar/apagar arquivos dentro deles (com confirmação).
  workspaceAccess: {
    enabled: false,
  },
  // Gemini CLI provider — modelo escolhido pelo usuário dentro da lista do CLI.
  geminiCliModel: "gemini-2.5-flash",
  // Claude Code CLI provider.
  claudeCliModel: "claude-sonnet-4-6",
  // API Key do backend remoto. Necessário para endpoints pesados (ex: qwen3.6-17b).
  // Endpoints leves (llama3, qwen25) usam o Bearer token fixo hardcoded.
  backendApiKey: "",
  // Assistente de Tradução (entrevistas). Captura áudio, detecta fim de fala,
  // transcreve via gpt-4o-mini-transcribe e retorna tradução + sugestão de
  // resposta em PT-BR ou idioma escolhido.
  translationAssistant: {
    enabled: false,
    userName: "",
    userBackground: "",
    targetLanguage: "pt-br",
    testMode: false,
    // Microfone escolhido pelo usuário (nome do source pactl). Vazio = automático.
    micDevice: "",
  },
  // Base de conhecimento atualizável (mini-RAG). O texto fica em arquivo separado
  // (<userData>/knowledge/), aqui só os flags. Compartilhada por Assistente + Tradutor.
  knowledgeBase: {
    enabled: true,
    aiRewrite: true, // IA reorganiza o texto antes de salvar (default ON)
  },
  // Banco de respostas (RAG de conversas): guarda perguntas do entrevistador + as
  // SUAS respostas que pontuaram bem (nota >= minScore, avaliada em background), e
  // reaproveita como dica quando uma pergunta quase igual aparece. Arquivo separado
  // (<userData>/knowledge/answers.json). Compartilhado por Assistente + Tradutor.
  answerBank: {
    enabled: true,
    minScore: 4, // só salva respostas com nota >= 4 (de 5)
  },
};

let configPath;

function getConfigPath() {
  if (!configPath) {
    const userDataPath = app.getPath("userData");
    configPath = path.join(userDataPath, "config.json");
  }
  return configPath;
}

function getDefaultPromptInstruction(lang) {
  let lite = false;
  try { lite = require("./edition").isLite(); } catch (_) {}
  if (lite) return lang === "pt-br" ? PROMPT_PT_LITE : PROMPT_EN_LITE;
  return lang === "pt-br" ? PROMPT_PT : PROMPT_EN;
}

function loadConfig() {
  try {
    const configFilePath = getConfigPath();
    if (fs.existsSync(configFilePath)) {
      const fileContent = fs.readFileSync(configFilePath, 'utf-8');
      const loadedConfig = JSON.parse(fileContent);

      const lang = loadedConfig.language || defaultConfig.language;

      // Lista de prompts default antigos que devem ser auto-migrados para o novo
      const LEGACY_DEFAULTS = [
        "Você é uma assistente que responde com até 65 palavras.",
        "You are a helpful assistant who responds in up to 65 words.",
      ];
      const isLegacy =
        !loadedConfig.promptInstruction ||
        loadedConfig.promptInstruction.trim() === '' ||
        LEGACY_DEFAULTS.includes(loadedConfig.promptInstruction.trim()) ||
        // Prompt antigo (sem a regra anti-LaTeX adicionada nesta versão).
        // Detecta pela ausência da palavra-chave única.
        !loadedConfig.promptInstruction.includes('LaTeX') ||
        // Prompt antigo (sem a regra de "especificação técnica → proponha
        // implementação" adicionada nesta versão). Detecta pela ausência da
        // palavra-chave única em qualquer um dos dois idiomas.
        (!loadedConfig.promptInstruction.includes('PROPONHA') && !loadedConfig.promptInstruction.includes('PROPOSE'));
      if (isLegacy) {
        loadedConfig.promptInstruction = getDefaultPromptInstruction(lang);
      }

      return { ...defaultConfig, ...loadedConfig };
    }
  } catch (error) {
    console.error('Erro ao carregar o arquivo de configuração:', error);
  }
  return defaultConfig;
}

function saveConfig(config) {
  try {
    const configFilePath = getConfigPath();
    const configDir = path.dirname(configFilePath);
    if (!fs.existsSync(configDir)) {
      fs.mkdirSync(configDir, { recursive: true });
    }
    fs.writeFileSync(configFilePath, JSON.stringify(config, null, 2), "utf-8");
  } catch (error) {
    console.error("Erro ao salvar o arquivo de configuração:", error);
  }
}

let currentConfig = null;

function getPromptInstruction() {
  if (!currentConfig) {
    currentConfig = loadConfig();
  }
  const instruction = currentConfig.promptInstruction;
  if (
    instruction &&
    typeof instruction === "string" &&
    instruction.trim() !== ""
  ) {
    return instruction;
  }
  return defaultConfig.promptInstruction;
}

function setPromptInstruction(instruction) {
  if (!currentConfig) {
    currentConfig = loadConfig();
  }
  currentConfig.promptInstruction = instruction;
  saveConfig(currentConfig);
  currentConfig = null;
}

function getDebugModeStatus() {
  if (!currentConfig) {
    currentConfig = loadConfig();
  }
  return currentConfig.debugMode;
}

function setDebugModeStatus(status) {
  if (!currentConfig) {
    currentConfig = loadConfig();
  }
  currentConfig.debugMode = status;
  saveConfig(currentConfig);
  currentConfig = null;
}

function getPrintModeStatus() {
  if (!currentConfig) {
    currentConfig = loadConfig();
  }
  return currentConfig.printMode;
}

function setPrintModeStatus(status) {
  if (!currentConfig) {
    currentConfig = loadConfig();
  }
  currentConfig.printMode = status;
  saveConfig(currentConfig);
  currentConfig = null;
}

function getLanguage() {
  if (!currentConfig) {
    currentConfig = loadConfig();
  }
  return currentConfig.language;
}

function setLanguage(language) {
  if (!currentConfig) {
    currentConfig = loadConfig();
  }

  const oldLang = currentConfig.language;
  currentConfig.language = language;

  const oldDefault = getDefaultPromptInstruction(oldLang);
  if (currentConfig.promptInstruction === oldDefault) {
    currentConfig.promptInstruction = getDefaultPromptInstruction(language);
  }

  saveConfig(currentConfig);
  currentConfig = null;
}

function initialize() {
  currentConfig = loadConfig();
}

function getIp() {
  return fetch("https://api.ipify.org?format=json")
    .then((response) => response.json())
    .then((data) => {
      console.log("O IP do usuário é:", data.ip);
      return data.ip;
    })
    .catch((error) => {
      console.error("Erro ao obter o IP:", error);
      return null;
    });
}

function getAiModel() {
  if (!currentConfig) {
    currentConfig = loadConfig();
  }
  return currentConfig.aiModel || defaultConfig.aiModel;
}

function setAiModel(aiModel) {
  if (!currentConfig) {
    currentConfig = loadConfig();
  }
  currentConfig.aiModel = aiModel;
  // CLIs externos e Ollama com backend: desliga helperTools (o CLI gerencia suas próprias ferramentas ou o backend não tem suporte),
  // mas mantém workspaceAccess para CLIs (ele controla o painel de projeto/diretório que usam como cwd e contexto de repositório).
  if (aiModel === 'geminiCli' || aiModel === 'claudeCli' || aiModel === 'llama' || aiModel === 'llama-stream') {
    if (currentConfig.helperTools && currentConfig.helperTools.enabled) {
      currentConfig.helperTools.enabled = false;
      console.log(`[config] ${aiModel} selecionado → helperTools desligado automaticamente`);
    }
    if (aiModel === 'llama' || aiModel === 'llama-stream') {
      if (currentConfig.workspaceAccess && currentConfig.workspaceAccess.enabled) {
        currentConfig.workspaceAccess.enabled = false;
      }
    }
    saveConfig(currentConfig);
    currentConfig = null;
    return;
  }
  saveConfig(currentConfig);
  currentConfig = null;
}

function getOpenAiModel() {
  if (!currentConfig) {
    currentConfig = loadConfig();
  }
  return currentConfig.openAiModel || defaultConfig.openAiModel;
}

function setOpenAiModel(model) {
  if (!currentConfig) {
    currentConfig = loadConfig();
  }
  currentConfig.openAiModel = model;
  saveConfig(currentConfig);
  currentConfig = null;
}

function getOpenAiReasoningEffort() {
  if (!currentConfig) {
    currentConfig = loadConfig();
  }
  return currentConfig.openAiReasoningEffort || defaultConfig.openAiReasoningEffort;
}

function setOpenAiReasoningEffort(effort) {
  if (!currentConfig) {
    currentConfig = loadConfig();
  }
  currentConfig.openAiReasoningEffort = effort;
  saveConfig(currentConfig);
  currentConfig = null;
}

function getOpenAiVisionModel() {
  if (!currentConfig) {
    currentConfig = loadConfig();
  }
  return currentConfig.openAiVisionModel || defaultConfig.openAiVisionModel;
}

function setOpenAiVisionModel(model) {
  if (!currentConfig) {
    currentConfig = loadConfig();
  }
  currentConfig.openAiVisionModel = model;
  saveConfig(currentConfig);
  currentConfig = null;
}

function getClaudeCliModel() {
  if (!currentConfig) currentConfig = loadConfig();
  return currentConfig.claudeCliModel || defaultConfig.claudeCliModel;
}

function setClaudeCliModel(model) {
  if (!currentConfig) currentConfig = loadConfig();
  currentConfig.claudeCliModel = model || defaultConfig.claudeCliModel;
  saveConfig(currentConfig);
  currentConfig = null;
}

function getGeminiCliModel() {
  if (!currentConfig) currentConfig = loadConfig();
  return currentConfig.geminiCliModel || defaultConfig.geminiCliModel;
}

function setGeminiCliModel(model) {
  if (!currentConfig) currentConfig = loadConfig();
  currentConfig.geminiCliModel = model || defaultConfig.geminiCliModel;
  saveConfig(currentConfig);
  currentConfig = null;
}

function getOllamaLocalModel() {
  if (!currentConfig) currentConfig = loadConfig();
  return currentConfig.ollamaLocalModel || defaultConfig.ollamaLocalModel;
}

function setOllamaLocalModel(model) {
  if (!currentConfig) currentConfig = loadConfig();
  const oldModel = currentConfig.ollamaLocalModel;
  const newModel = model || defaultConfig.ollamaLocalModel;
  currentConfig.ollamaLocalModel = newModel;
  saveConfig(currentConfig);
  
  if (oldModel !== newModel) {
    try {
      const ollamaLocalService = require('./ollamaLocalService');
      ollamaLocalService.preloadModel(oldModel, newModel).catch(err => {
        console.error("Erro ao fazer o preload do OllamaLocal:", err);
      });
    } catch (e) {
      console.error(e);
    }
  }
  
  currentConfig = null;
}

function getOllamaLocalHost() {
  if (!currentConfig) currentConfig = loadConfig();
  return currentConfig.ollamaLocalHost || defaultConfig.ollamaLocalHost;
}

function setOllamaLocalHost(host) {
  if (!currentConfig) currentConfig = loadConfig();
  currentConfig.ollamaLocalHost = host || defaultConfig.ollamaLocalHost;
  saveConfig(currentConfig);
  currentConfig = null;
}

function getAudioCaptureMode() {
  if (!currentConfig) currentConfig = loadConfig();
  // 'monitor' (default, sistema) | 'mic' (microfone) | 'both' (mix experimental)
  return currentConfig.audioCaptureMode || 'monitor';
}

function setAudioCaptureMode(mode) {
  if (!currentConfig) currentConfig = loadConfig();
  if (!['monitor', 'mic', 'both'].includes(mode)) mode = 'monitor';
  currentConfig.audioCaptureMode = mode;
  saveConfig(currentConfig);
  currentConfig = null;
}

function getOpenIaToken() {
    if (!currentConfig) {
        currentConfig = loadConfig();
    }
    return currentConfig.openIaToken || "";
}

function setOpenIaToken(token) {
    if (!currentConfig) {
        currentConfig = loadConfig();
    }
    currentConfig.openIaToken = token;
    saveConfig(currentConfig);
    currentConfig = null;
}

function getOsIntegrationStatus() {
  if (!currentConfig) {
    currentConfig = loadConfig();
  }
  return currentConfig.osIntegration || false;
}

function setOsIntegrationStatus(status) {
  if (!currentConfig) {
    currentConfig = loadConfig();
  }
  currentConfig.osIntegration = status;
  saveConfig(currentConfig);
  currentConfig = null;
}

function getRealtimeAssistantStatus() {
  if (!currentConfig) {
    currentConfig = loadConfig();
  }
  return currentConfig.realtimeAssistant || false;
}

function setRealtimeAssistantStatus(status) {
  if (!currentConfig) {
    currentConfig = loadConfig();
  }
  currentConfig.realtimeAssistant = status;
  saveConfig(currentConfig);
  currentConfig = null;
}

function getHelperToolsConfig() {
  if (!currentConfig) {
    currentConfig = loadConfig();
  }
  return currentConfig.helperTools || { enabled: false };
}

function setHelperToolsConfig(partial) {
  if (!currentConfig) {
    currentConfig = loadConfig();
  }
  currentConfig.helperTools = {
    ...(currentConfig.helperTools || {}),
    ...(partial || {}),
  };
  saveConfig(currentConfig);
  currentConfig = null;
}

function getHelperToolsEnabled() {
  return !!getHelperToolsConfig().enabled;
}

function setHelperToolsEnabled(enabled) {
  setHelperToolsConfig({ enabled: !!enabled });
  // Mutex: liga helperTools desliga osIntegration (decisão do usuário).
  if (enabled) {
    if (!currentConfig) currentConfig = loadConfig();
    if (currentConfig.osIntegration) {
      currentConfig.osIntegration = false;
      saveConfig(currentConfig);
      currentConfig = null;
    }
  } else {
    // Desliga workspaceAccess junto (dependência).
    if (!currentConfig) currentConfig = loadConfig();
    if (currentConfig.workspaceAccess && currentConfig.workspaceAccess.enabled) {
      currentConfig.workspaceAccess.enabled = false;
      saveConfig(currentConfig);
      currentConfig = null;
    }
  }
}

function getWorkspaceAccessEnabled() {
  if (!currentConfig) currentConfig = loadConfig();
  return !!(currentConfig.workspaceAccess && currentConfig.workspaceAccess.enabled);
}

function setWorkspaceAccessEnabled(enabled) {
  if (!currentConfig) currentConfig = loadConfig();
  if (!currentConfig.workspaceAccess) currentConfig.workspaceAccess = {};
  // Para OpenAI, requer helperTools ligado (quem faz a leitura de arquivos).
  // Para CLIs (geminiCli, claudeCli), o CLI usa o diretório diretamente — sem restrição.
  const model = currentConfig.aiModel || 'openIa';
  const isCli = model === 'geminiCli' || model === 'claudeCli';
  if (enabled && !isCli && !(currentConfig.helperTools && currentConfig.helperTools.enabled)) {
    console.warn("[config] workspaceAccess requer helperTools ligado — ignorando");
    return;
  }
  currentConfig.workspaceAccess.enabled = !!enabled;
  saveConfig(currentConfig);
  currentConfig = null;
}

function getBackendApiKey() {
  if (!currentConfig) currentConfig = loadConfig();
  return currentConfig.backendApiKey || "";
}

function setBackendApiKey(key) {
  if (!currentConfig) currentConfig = loadConfig();
  currentConfig.backendApiKey = key || "";
  saveConfig(currentConfig);
  currentConfig = null;
}

function getKnowledgeBaseConfig() {
  if (!currentConfig) currentConfig = loadConfig();
  return { ...defaultConfig.knowledgeBase, ...(currentConfig.knowledgeBase || {}) };
}

function setKnowledgeBaseConfig(partial) {
  if (!currentConfig) currentConfig = loadConfig();
  currentConfig.knowledgeBase = {
    ...(currentConfig.knowledgeBase || defaultConfig.knowledgeBase),
    ...(partial || {}),
  };
  saveConfig(currentConfig);
  currentConfig = null;
}

function getAnswerBankConfig() {
  if (!currentConfig) currentConfig = loadConfig();
  return { ...defaultConfig.answerBank, ...(currentConfig.answerBank || {}) };
}

function setAnswerBankConfig(partial) {
  if (!currentConfig) currentConfig = loadConfig();
  currentConfig.answerBank = {
    ...(currentConfig.answerBank || defaultConfig.answerBank),
    ...(partial || {}),
  };
  saveConfig(currentConfig);
  currentConfig = null;
}

function getTranslationAssistantConfig() {
  if (!currentConfig) currentConfig = loadConfig();
  return { ...defaultConfig.translationAssistant, ...(currentConfig.translationAssistant || {}) };
}

function setTranslationAssistantConfig(partial) {
  if (!currentConfig) currentConfig = loadConfig();
  currentConfig.translationAssistant = {
    ...(currentConfig.translationAssistant || defaultConfig.translationAssistant),
    ...partial,
  };
  saveConfig(currentConfig);
  currentConfig = null;
}

// Retorna a configuração completa mesclada com defaults.
// Útil para IPC handlers genéricos (config-get-all).
function getConfig() {
  if (!currentConfig) currentConfig = loadConfig();
  return { ...currentConfig };
}

// Setter genérico com suporte a dot-notation (ex: "translationAssistant.enabled").
function setConfigValue(dotPath, value) {
  if (!currentConfig) currentConfig = loadConfig();
  const keys = dotPath.split('.');
  let obj = currentConfig;
  for (let i = 0; i < keys.length - 1; i++) {
    if (obj[keys[i]] === undefined || typeof obj[keys[i]] !== 'object') {
      obj[keys[i]] = {};
    }
    obj = obj[keys[i]];
  }
  obj[keys[keys.length - 1]] = value;
  saveConfig(currentConfig);
  currentConfig = null;
}

module.exports = {
  initialize,
  getPromptInstruction,
  setPromptInstruction,
  getDebugModeStatus,
  setDebugModeStatus,
  getPrintModeStatus,
  setPrintModeStatus,
  getOsIntegrationStatus,
  setOsIntegrationStatus,
  getRealtimeAssistantStatus,
  setRealtimeAssistantStatus,
  getLanguage,
  setLanguage,
  getAiModel,
  setAiModel,
  getOpenIaToken,
  setOpenIaToken,
  getOpenAiModel,
  setOpenAiModel,
  getOpenAiReasoningEffort,
  setOpenAiReasoningEffort,
  getOpenAiVisionModel,
  setOpenAiVisionModel,
  getClaudeCliModel,
  setClaudeCliModel,
  getGeminiCliModel,
  setGeminiCliModel,
  getOllamaLocalModel,
  setOllamaLocalModel,
  getOllamaLocalHost,
  setOllamaLocalHost,
  getAudioCaptureMode,
  setAudioCaptureMode,
  getHelperToolsConfig,
  setHelperToolsConfig,
  getHelperToolsEnabled,
  setHelperToolsEnabled,
  getWorkspaceAccessEnabled,
  setWorkspaceAccessEnabled,
  getBackendApiKey,
  setBackendApiKey,
  getTranslationAssistantConfig,
  setTranslationAssistantConfig,
  getKnowledgeBaseConfig,
  setKnowledgeBaseConfig,
  getAnswerBankConfig,
  setAnswerBankConfig,
  getConfig,
  setConfigValue,
  getIp,
};
