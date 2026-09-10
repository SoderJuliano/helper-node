// main/state.js
const {
  electron, path, os, crypto, exec, spawn, util, fs, fs2,
  BackendService, GeminiCliProvider, ClaudeCliProvider, TesseractService,
  OpenAIService, RealtimeAssistantService, RealtimeOpenAiService, ipcService,
  configService, edition, knowledgeBase, fileEditService, historyService,
  helperTools, workspace, agenticWorkflow, ollamaAgenticWorkflow,
  translationAssistant, visionGuide, platformScreenCapture, runTestMode,
  analyzeInterviewImage, cloudTranscribeAudio,
  APP_ICON, HIDE_FROM_TASKBAR, IMAGE_COOLDOWN_MS, AUDIO_TMP_DIR,
  audioFilePath, SCREENSHOT_DIRS, PROJECT_SEARCH_SKIP_DIRS, TREE_HEAVY_DIRS,
  OS_LIVE_CONTINUATION_WINDOW_MS, OS_LIVE_SAMPLE_RATE, OS_LIVE_SILENCE_RMS,
  OS_LIVE_SILENCE_MS, OS_LIVE_MAX_MS, OS_LIVE_TMP_DIR,
  realtimeAssistantService, realtimeOpenAiService,
  state, helpers
} = require('./globals.js');

helpers.shouldUseAgentic = function(rawText) {
  if (!configService.getHelperToolsEnabled || !configService.getHelperToolsEnabled()) return false;
  if (!configService.getWorkspaceAccessEnabled || !configService.getWorkspaceAccessEnabled()) return false;
  if (!(helperTools.shouldForceHeavyModel && helperTools.shouldForceHeavyModel(rawText || ""))) return false;
  const t = (rawText || "").toLowerCase();
  const isDirectCommand =
    /\b(git|npm|yarn|pnpm|cargo|docker|kubectl|systemctl|make)\b/.test(t) ||
    /\b(commit|push|pull|rebase|merge|clone|checkout|stash)\b/.test(t) ||
    /\b(rode|roda|rodar|execut|\brun\b|test|build|deploy|lint|instal)\b/.test(t);
  return !isDirectCommand;
}

// NÃO reintroduzir um classificador SIM/NAO por LLM aqui. A versão anterior
// gastava UMA GERAÇÃO INTEIRA do modelo do backend (qwen3.6:35b, com
// raciocínio) só pra decidir se valia rodar a busca — e essa chamada era
// BLOQUEANTE, antes de qualquer stream. Um "oi" pagava o preço duas vezes.
// O retrieval abaixo é keyword/BM25 sobre arquivo local: sem rede, barato o
// bastante pra rodar sempre. É o que o irmão do ChatGPT (knowledgeBlockForOpenAI)
// já fazia — a assimetria não tinha motivo.
helpers.knowledgeBlockForOllama = async function(query) {
  try {
    if (!configService.getKnowledgeBaseConfig().enabled) return "";
    // MODO IDE (ferramentas ligadas) NÃO leva base de conhecimento. São notas
    // sobre versões/tecnologias recentes — não ajudam a editar um arquivo, e o
    // custo é alto no lugar errado: o prompt do tool loop é REENVIADO INTEIRO
    // a cada rodada, então cada trecho injetado é pago de novo em TODA
    // iteração, empurrando o num_ctx pra cima e deixando o turno mais lento.
    if (configService.getHelperToolsEnabled && configService.getHelperToolsEnabled()) {
      console.log('[knowledgeBase] SKIP: modo IDE (ferramentas ON) — base não entra no prompt do agente');
      return "";
    }
    return await knowledgeBase.augment(query, { topK: 5 }); // sem token → keyword
  } catch (_) { return ""; }
}

helpers.knowledgeBlockForOpenAI = async function(query) {
  try {
    if (!configService.getKnowledgeBaseConfig().enabled) return "";
    return await knowledgeBase.augment(query, { token: configService.getOpenIaToken(), topK: 5 });
  } catch (_) { return ""; }
}

helpers.pickRealtimeService = function() {
  return helpers.getEffectiveAiModel() === "openIa" ? realtimeOpenAiService : realtimeAssistantService;
}

helpers.anyRealtimeActive = function() {
  return realtimeOpenAiService.isActive() || realtimeAssistantService.isActive();
}

helpers.stopAllRealtime = function() {
  const tasks = [];
  if (realtimeOpenAiService.isActive()) tasks.push(realtimeOpenAiService.stop().catch(() => {}));
  if (realtimeAssistantService.isActive()) tasks.push(realtimeAssistantService.stop().catch(() => {}));
  return Promise.all(tasks);
}

helpers.isTranslationOnlyMode = function() {
  try {
    return configService.getOsIntegrationStatus() && translationAssistant.isActive();
  } catch (_) { return false; }
}

helpers.isHyprland = function() {
  return !!process.env.HYPRLAND_INSTANCE_SIGNATURE;
}

helpers.shouldUseVisionFor = function(ocrText) {
  if (!ocrText || !ocrText.trim()) {
    return { useVision: true, reason: 'OCR vazio (provável imagem sem texto)' };
  }
  const t = ocrText.trim();
  if (t.length < 25) {
    return { useVision: true, reason: `OCR curto demais (${t.length} chars)` };
  }

  // 1) Símbolos matemáticos / equações
  const mathSymbols = /[×÷±≠≈≤≥∞√∫∑∏πθλμωΩ²³⁴⁵⁶⁷⁸⁹⁰₀₁₂₃₄₅]/;
  if (mathSymbols.test(t)) {
    return { useVision: true, reason: 'símbolos matemáticos detectados' };
  }
  // Operadores ASCII: x= ou =? em contexto numérico (sinal de "conta")
  if (/\d\s*[x*+\-/=]\s*\d/.test(t) && /=\s*\?/.test(t)) {
    return { useVision: true, reason: 'expressão matemática com "=?" (problema a resolver)' };
  }
  // Frações tipo "1/2", "3/4" misturadas com palavras curtas
  if (/\d+\/\d+/.test(t) && t.split(/\s+/).filter(w => w.length < 3).length > 5) {
    return { useVision: true, reason: 'fração + texto picotado' };
  }

  // 2) Padrão de múltipla escolha (A) B) C)) ou (A. B. C.)
  const choicePattern = /(^|\n)\s*[A-Fa-f][).]\s+\S/g;
  const choices = (t.match(choicePattern) || []).length;
  if (choices >= 3) {
    // Tem 3+ alternativas mas OCR pode ter perdido as opções
    // Se as linhas das alternativas forem curtas/quebradas, manda visão
    return { useVision: true, reason: `múltipla escolha (${choices} alternativas)` };
  }

  // 3) Razão de ruído (caracteres não-imprimíveis-comuns)
  const totalChars = t.length;
  // Conta caracteres "esquisitos" típicos de OCR ruim:
  // chars Unicode raros, sequências de pontuação, símbolos isolados
  const noiseChars = (t.match(/[^\w\s.,!?;:()'"\-–—\/áéíóúâêôãõçÁÉÍÓÚÂÊÔÃÕÇ\u00A0]/g) || []).length;
  const noiseRatio = noiseChars / totalChars;
  if (noiseRatio > 0.20) {
    return { useVision: true, reason: `OCR ruidoso (${(noiseRatio * 100).toFixed(0)}% chars estranhos)` };
  }

  // 4) Muitas "palavras" de 1-2 caracteres seguidas → texto picotado
  const words = t.split(/\s+/).filter(Boolean);
  const tinyWords = words.filter(w => w.length <= 2 && /[a-zA-Z]/.test(w)).length;
  if (words.length > 10 && tinyWords / words.length > 0.40) {
    return { useVision: true, reason: `texto picotado (${tinyWords}/${words.length} palavras de 1-2 chars)` };
  }

  // 5) Tabelas/grids: muitos | em linhas curtas
  const pipeLines = t.split('\n').filter(l => (l.match(/\|/g) || []).length >= 2).length;
  if (pipeLines >= 3) {
    return { useVision: true, reason: 'aparenta tabela/grid' };
  }

  // OCR limpo o suficiente — TEXTO basta
  return { useVision: false, reason: `OCR limpo (${words.length} palavras, ruído ${(noiseRatio * 100).toFixed(0)}%)` };
}
