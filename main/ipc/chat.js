// main/ipc/chat.js
const {
  electron, path, os, crypto, exec, spawn, util, fs, fs2,
  BackendService, GeminiCliProvider, ClaudeCliProvider, CopilotCliProvider, TesseractService,
  OpenAIService, RealtimeAssistantService, RealtimeOpenAiService, ipcService,
  configService, edition, knowledgeBase, fileEditService, historyService,
  helperTools, workspace, agenticWorkflow, ollamaAgenticWorkflow,
  translationAssistant, visionGuide, platformScreenCapture, runTestMode,
  analyzeInterviewImage, cloudTranscribeAudio,
  APP_ICON, HIDE_FROM_TASKBAR, IMAGE_COOLDOWN_MS, AUDIO_TMP_DIR,
  audioFilePath, SCREENSHOT_DIRS, PROJECT_SEARCH_SKIP_DIRS, TREE_HEAVY_DIRS,
  OS_LIVE_CONTINUATION_WINDOW_MS, OS_LIVE_SAMPLE_RATE, OS_LIVE_SILENCE_RMS,
  OS_LIVE_SILENCE_MS, OS_LIVE_MAX_MS, OS_LIVE_TMP_DIR,
  state, helpers,
  ipcMain, appConfig, Notification
} = require('../globals.js');

module.exports = function registerIpc() {
ipcMain.on("send-to-gemini", async (event, text, sessionId) => {
  try {
    const aiModel = helpers.getEffectiveAiModel();
    // Este canal NÃO streama: a resposta só aparece quando termina, sem
    // raciocínio ao vivo. Para os modelos de backend/ollama isso é escolha
    // errada do renderer (deveria ser send-to-gemini-stream) e o sintoma pro
    // usuário é "demorou muito e não veio thinking nenhum".
    if (aiModel === 'llama-stream' || aiModel === 'qwen-stream' || aiModel === 'llama' || aiModel === 'ollamaLocal') {
      console.warn(`[send-to-gemini] canal SEM streaming usado com modelo "${aiModel}" — sem thinking ao vivo.`);
    }
    let resposta, usedKnowledge = false;
    let promptWithHistory = text;
    let pastMessages = [];
    if (sessionId) {
      const session = historyService.getSessionById(Number(sessionId)) || historyService.getSessionById(sessionId);
      if (session && session.conversations && session.conversations.length > 1) {
        pastMessages = session.conversations.slice(0, -1);
        if (pastMessages.length > 0) {
          let historyContext = "=== HISTÓRICO DA CONVERSA ANTERIOR ===\n";
          for (const msg of pastMessages) {
            historyContext += `[${msg.role === 'user' ? 'Usuário' : 'IA'}]: ${msg.content}\n\n`;
          }
          historyContext += "=== FIM DO HISTÓRICO ===\n\nPergunta atual: ";
          promptWithHistory = historyContext + text;
        }
      }
    }

    // ── Gemini CLI provider ──────────────────────────────────────────────────
    if (aiModel === 'geminiCli') {
      const projectPath = workspace.getProjectPath();
      const geminiModel = configService.getGeminiCliModel();
      GeminiCliProvider.setModel(geminiModel);
      const finalPrompt = helpers.appendAttachmentsContext(text);
      try {
        await GeminiCliProvider.send(finalPrompt, projectPath, event.sender, sessionId, pastMessages);
      } catch (gcliErr) {
        console.error('[gemini-cli] send error:', gcliErr.message);
        // Garante que o loading fecha mesmo que o provider não tenha emitido gemini-stream-complete
        try { event.sender.send('gemini-stream-complete'); } catch (_) {}
      }
      return;
    }

    // ── Claude Code CLI provider ─────────────────────────────────────────────
    if (aiModel === 'claudeCli') {
      const projectPath = workspace.getProjectPath();
      const claudeModel = configService.getClaudeCliModel();
      ClaudeCliProvider.setModel(claudeModel);
      const finalPrompt = helpers.appendAttachmentsContext(promptWithHistory);
      try {
        await ClaudeCliProvider.send(finalPrompt, projectPath, event.sender);
      } catch (ccliErr) {
        console.error('[claude-cli] send error:', ccliErr.message);
        // Garante que o loading fecha mesmo que o provider não tenha emitido gemini-stream-complete
        try { event.sender.send('gemini-stream-complete'); } catch (_) {}
      }
      return;
    }

    // ── GitHub Copilot CLI provider ──────────────────────────────────────────
    if (aiModel === 'copilotCli') {
      const projectPath = workspace.getProjectPath();
      const copilotModel = configService.getCopilotCliModel();
      CopilotCliProvider.setModel(copilotModel);
      const finalPrompt = helpers.appendAttachmentsContext(promptWithHistory);
      try {
        await CopilotCliProvider.send(finalPrompt, projectPath, event.sender);
      } catch (cpErr) {
        console.error('[copilot-cli] send error:', cpErr.message);
        try { event.sender.send('gemini-stream-complete'); } catch (_) {}
      }
      return;
    }

    if (aiModel === 'openIa' || aiModel === 'openIaCodex') {
        const token = configService.getOpenIaToken();
        const instruction = configService.getPromptInstruction();
        if (!token) {
            if (appConfig.notificationsEnabled && Notification.isSupported()) {
                new Notification({
                    title: "Erro de Configuração",
                    body: "O token da OpenAI não está configurado. Por favor, adicione o token nas configurações.",
                    silent: true,
                }).show();
            }
            return;
        }
        const openAiModel = configService.getOpenAiModel();

        // Comando direto não planeja (só executa); tarefa complexa → agentic.
        const useAgentic = helpers.shouldUseAgentic(text);
        if (useAgentic) { try { workspace.resetContextSent(); } catch (_) {} }

        const _wsText2 = await helpers.prependWorkspaceContextIfNeeded(promptWithHistory, openAiModel);

        if (useAgentic) {
            console.log('🤖 IPC: Iniciando AGENTIC WORKFLOW (multi-fase)...');
            // Limpa qualquer sessão anterior pra evitar contaminação
            if (OpenAIService.sessions) OpenAIService.sessions = {};

            try {
              resposta = await agenticWorkflow.run(
                  _wsText2,
                  { token, model: openAiModel, baseInstruction: instruction },
                  event.sender
              );
            } catch (err) {
              resposta = `[Agentic Workflow] Interrompido ou falhou: ${err.message}`;
            } finally {
              try { workspace.resetContextSent(); } catch (_) {}
            }
        } else {
            const _kb2 = await helpers.knowledgeBlockForOpenAI(text);
            if (_kb2) usedKnowledge = true;
            const _augText2 = _kb2 ? _kb2 + "\n\n---\n\n" + _wsText2 : _wsText2;
            const ht = helpers.buildHelperToolsOpenAIOpts(_augText2, instruction, openAiModel, aiModel === 'openIaCodex');
            resposta = await OpenAIService.makeOpenAIRequest(
              _augText2,
              token,
              ht.instruction || instruction,
              ht.model || openAiModel,
              null,
              ht.opts
            );
        }
        const usage = OpenAIService.lastUsage;
        event.sender.send("openai-final-response", { resposta, usedKnowledge, usage });
        return;
    } else if (aiModel === 'ollamaLocal') {
        try {
          const OllamaLocalService = require('../../services/ollamaLocalService');
          const _kbL = await helpers.knowledgeBlockForOllama(text);
          if (_kbL) usedKnowledge = true;
          const _augTextL = _kbL ? _kbL + "\n\n---\n\n" + promptWithHistory : promptWithHistory;

          const htEnabled = configService.getHelperToolsEnabled && configService.getHelperToolsEnabled();
          if (htEnabled) {
            const instructionO = configService.getPromptInstruction();
            const _wsTxtO = await helpers.prependWorkspaceContextIfNeeded(_augTextL, 'ollama');
            const _htO = helpers.buildHelperToolsOpenAIOpts(_wsTxtO, instructionO, configService.getOpenAiModel());
            resposta = await OllamaLocalService.responder(_wsTxtO, _htO.opts);
          } else {
            resposta = await OllamaLocalService.responder(_augTextL);
          }
        } catch (ollamaError) {
          console.error("IPC: Ollama Local falhou:", ollamaError && ollamaError.message);
          throw new Error(
            "Ollama Local indisponivel. Verifique se o servico esta rodando ou troque pra OpenAI em Configuracoes."
          );
        }
    } else {
        // Ollama/Backend e' o unico provider nao-OpenAI suportado.
        try {
          const instructionO2 = configService.getPromptInstruction();
          const useAgentic = helpers.shouldUseAgentic(text);
          if (useAgentic) { try { workspace.resetContextSent(); } catch (_) {} }
          const _wsTxtO2 = await helpers.prependWorkspaceContextIfNeeded(promptWithHistory, 'ollama');

          if (useAgentic) {
              console.log('🤖 IPC: Iniciando AGENTIC WORKFLOW OLLAMA (multi-fase)...');
              BackendService.clearSessions();
              try {
                resposta = await ollamaAgenticWorkflow.run(
                    _wsTxtO2, 
                    { baseInstruction: instructionO2 },
                    event.sender
                );
              } catch (err) {
                if (err && (err.message === 'Request cancelled' || err.message === 'Cancelado.')) {
                  event.sender.send("transcription-error", "Request cancelled");
                  return;
                }
                resposta = `[Ollama Agentic] Interrompido ou falhou: ${err.message}`;
              }
          } else {
              const _kbO2 = await helpers.knowledgeBlockForOllama(text);
              if (_kbO2) usedKnowledge = true;
              const _augTxtO2 = _kbO2 ? _kbO2 + "\n\n---\n\n" + _wsTxtO2 : _wsTxtO2;
              const _htO2 = helpers.buildHelperToolsOpenAIOpts(_augTxtO2, instructionO2, configService.getOpenAiModel());
              resposta = await BackendService.responder(_augTxtO2, _htO2.opts);
          }
          state.backendIsOnline = true;
        } catch (backendError) {
          console.error("IPC: Backend Ollama falhou:", backendError && backendError.message);
          state.backendIsOnline = false;
          throw new Error(
            "Backend Ollama indisponivel. Verifique se o servico esta rodando ou troque pra OpenAI em Configuracoes."
          );
        }
    }
    event.sender.send("gemini-response", { resposta, usedKnowledge });
  } catch (error) {
    console.error("IPC: IA service error:", error);
    event.sender.send(
      "transcription-error",
      "Failed to process IA response from any source"
    );
  }
});

ipcMain.on("send-to-gemini-vision", async (event, { text, image }) => {
  try {
    if (!image) {
      event.sender.send("transcription-error", "Imagem ausente para análise visual.");
      return;
    }
    const aiModel = helpers.getEffectiveAiModel();
    if (aiModel === 'ollamaLocal') {
      const OllamaLocalService = require('../../services/ollamaLocalService');
      const ocr = await TesseractService.getTextFromImage(image).catch(() => '');
      const instructionO = configService.getPromptInstruction();
      const baseTxt = (text && text.trim() ? `${text}\n\n` : '')
        + (ocr && ocr.trim() ? `Conteúdo extraído da imagem:\n${ocr}` : '');
      const _wsTxt = await helpers.prependWorkspaceContextIfNeeded(baseTxt, 'ollama');
      let resposta;
      const htEnabled = configService.getHelperToolsEnabled && configService.getHelperToolsEnabled();
      if (htEnabled) {
        const _ht = helpers.buildHelperToolsOpenAIOpts(_wsTxt, instructionO, configService.getOpenAiModel());
        resposta = await OllamaLocalService.responder(_wsTxt, _ht.opts);
      } else {
        resposta = await OllamaLocalService.responder(_wsTxt);
      }
      event.sender.send("gemini-response", { resposta, usedKnowledge: false });
      return;
    } else if (aiModel !== 'openIa') {
      // Backends sem visão (Ollama/full offline): cai no OCR + texto.
      const ocr = await TesseractService.getTextFromImage(image).catch(() => '');
      const instructionO = configService.getPromptInstruction();
      const baseTxt = (text && text.trim() ? `${text}\n\n` : '')
        + (ocr && ocr.trim() ? `Conteúdo extraído da imagem:\n${ocr}` : '');
      const _wsTxt = await helpers.prependWorkspaceContextIfNeeded(baseTxt, 'ollama');
      const _ht = helpers.buildHelperToolsOpenAIOpts(_wsTxt, instructionO, configService.getOpenAiModel());
      const resposta = await BackendService.responder(_wsTxt, _ht.opts);
      event.sender.send("gemini-response", { resposta, usedKnowledge: false });
      return;
    }

    const token = configService.getOpenIaToken();
    const instruction = configService.getPromptInstruction();
    if (!token) {
      event.sender.send("transcription-error", "Token da OpenAI não configurado.");
      return;
    }
    const visionModel = configService.getOpenAiVisionModel();
    const visionPrompt = (text && text.trim() ? `${text}\n\n` : '')
      + 'Analise a IMAGEM com atenção. Responda conforme as regras do sistema.\n\n'
      + 'IMPORTANTE: na imagem, "x" entre dois números significa MULTIPLICAÇÃO '
      + '(ex.: "11x2" = 11 × 2 = 22, NÃO é 11 ao quadrado). '
      + 'Notação de potência seria "11²" ou "11^2".';
    console.log(`🤖 IPC visão: OpenAI ${visionModel} [VISÃO high] (chat)...`);
    const resposta = await OpenAIService.makeOpenAIRequest(
      visionPrompt,
      token,
      instruction,
      visionModel,
      image,
      { stateless: true }
    );
    event.sender.send("openai-final-response", { resposta, usedKnowledge: false });
  } catch (error) {
    console.error("IPC visão: erro ao analisar imagem:", error && error.message);
    event.sender.send("transcription-error", "Falha ao analisar a imagem com a IA.");
  }
});

ipcMain.on("stop-agentic-workflow", (event, sessionId) => {
  agenticWorkflow.stop(sessionId);
  if (typeof ollamaAgenticWorkflow !== 'undefined') {
    ollamaAgenticWorkflow.stop(sessionId);
  }
  // Para CLIs: aborta o processo em curso para o projeto ativo.
  const projectPath = workspace.getProjectPath();
  ClaudeCliProvider.abortCurrent(projectPath).catch(() => {});
  GeminiCliProvider.abortCurrent && GeminiCliProvider.abortCurrent(projectPath).catch(() => {});
});

ipcMain.on("clear-ai-sessions", () => {
  console.log("🧹 Limpando sessões de IA (OpenAI + Backend + Gemini)...");
  if (OpenAIService.sessions) OpenAIService.sessions = {};
  BackendService.clearSessions();
  GeminiCliProvider.shutdown().catch((e) => {
    console.warn('[gemini-cli] clear-ai-sessions shutdown error:', e.message);
  });
});

ipcMain.on("send-to-gemini-stream", async (event, text, sessionId) => {
  try {
    const aiModel = helpers.getEffectiveAiModel();
    if (aiModel === 'ollamaLocal') {
      console.log("IPC: Usando Ollama Local Stream Service...");
      const OllamaLocalService = require('../../services/ollamaLocalService');
      const instructionO = configService.getPromptInstruction();
      const _wsTxt = await helpers.prependWorkspaceContextIfNeeded(text, 'ollama');
      const _kbL = await helpers.knowledgeBlockForOllama(text);
      const _augTextL = _kbL ? _kbL + "\n\n---\n\n" + _wsTxt : _wsTxt;
      const _ht = helpers.buildHelperToolsOpenAIOpts(_augTextL, instructionO, configService.getOpenAiModel());

      await OllamaLocalService.responderStream(
        _augTextL,
        // onChunk
        (chunk) => {
          event.sender.send("gemini-stream-chunk", chunk);
        },
        // onComplete
        () => {
          event.sender.send("gemini-stream-complete");
        },
        // onError
        (error) => {
          if (error && (error.message === 'Request cancelled' || error.message === 'Cancelado.')) {
            console.log('[ipc] Stream local cancelado pelo usuário.');
            event.sender.send("transcription-error", "Request cancelled");
            return;
          }
          console.error("Stream local error:", error);
          event.sender.send("transcription-error", error.message);
        },
        { ..._ht.opts, sessionId }
      );
      return;
    }

    console.log("IPC: Usando Backend Stream Service...");
    const instructionO2 = configService.getPromptInstruction();
    const _wsTxtO2 = await helpers.prependWorkspaceContextIfNeeded(text, 'ollama');
    const _kbO2 = await helpers.knowledgeBlockForOllama(text);
    const _augTxtO2 = _kbO2 ? _kbO2 + "\n\n---\n\n" + _wsTxtO2 : _wsTxtO2;
    const _htO2 = helpers.buildHelperToolsOpenAIOpts(_augTxtO2, instructionO2, configService.getOpenAiModel());

    // MODO AGENTE NATIVO. Só vale quando há ferramentas engajadas (é aí que o
    // protocolo importa) e quando o servidor expõe /agent. No caminho nativo a
    // chamada de ferramenta é um objeto tipado, e não texto que o modelo
    // confunde com o próprio raciocínio — medido: 18s por rodada contra 47-110s,
    // e 87 tokens de raciocínio contra 4546.
    if (_htO2.opts && _htO2.opts.tools && _htO2.opts.onToolCall) {
      const AgentService = require('../../services/backendAgentService');
      if (await AgentService.suportaAgente()) {
        console.log("IPC: modo AGENTE (tool calling nativo via /agent)");
        await AgentService.agentStream(
          _augTxtO2,
          (chunk) => { event.sender.send("gemini-stream-chunk", chunk); },
          () => { event.sender.send("gemini-stream-complete"); },
          (error) => {
            if (error && (error.message === 'Request cancelled' || error.message === 'Cancelado.')) {
              console.log('[ipc] Agente cancelado pelo usuário.');
              event.sender.send("transcription-error", "Request cancelled");
              return;
            }
            console.error("Agent error:", error);
            event.sender.send("transcription-error", error.message);
          },
          { ..._htO2.opts, model: configService.getBackendModel && configService.getBackendModel() }
        );
        return;
      }
      console.log("IPC: /agent indisponível no servidor — caindo pro protocolo de texto.");
    }

    await BackendService.responderStream(
      _augTxtO2,
      // onChunk
      (chunk) => {
        event.sender.send("gemini-stream-chunk", chunk);
      },
      // onComplete
      () => {
        event.sender.send("gemini-stream-complete");
      },
      // onError
      (error) => {
        if (error && (error.message === 'Request cancelled' || error.message === 'Cancelado.')) {
          console.log('[ipc] Stream cancelado pelo usuário.');
          event.sender.send("transcription-error", "Request cancelled");
          return;
        }
        console.error("Stream error:", error);
        event.sender.send("transcription-error", error.message);
      },
      // userText = a pergunta CRUA, sem o contexto de workspace colado na
      // frente. É com ela que o backend decide se o turno pede análise
      // profunda do projeto — usar o prompt montado fazia todo "oi" virar
      // análise obrigatória do repositório.
      { ..._htO2.opts, sessionId, userText: text }
    );
  } catch (error) {
    if (error && (error.message === 'Request cancelled' || error.message === 'Cancelado.')) {
      event.sender.send("transcription-error", "Request cancelled");
      return;
    }
    console.error("IPC: Stream service error:", error);
    event.sender.send(
      "transcription-error",
      (error && error.message) || "Falha ao processar a resposta em stream."
    );
  }
});

ipcMain.on("cancel-ia-request", () => {
  if (state.waitingNotificationInterval) {
    clearInterval(state.waitingNotificationInterval);
    state.waitingNotificationInterval = null;
  }
  try { BackendService.abortCurrentRequest(); } catch (_) {}
  // O modo agente tem o próprio turno em andamento — sem isto o botão "Parar
  // IA" não alcança o caminho nativo e o usuário fica sem como interromper.
  try { require('../../services/backendAgentService').abortCurrentRequest(); } catch (_) {}
  try {
    const OllamaLocalService = require('../../services/ollamaLocalService');
    OllamaLocalService.abortCurrentRequest();
  } catch (_) {}
  console.log("IA request cancelled");
});

ipcMain.handle("get-backend-url", async () => await BackendService.getApiUrl());
ipcMain.handle("get-backend-api-key", () => configService.getBackendApiKey());
ipcMain.handle("get-ai-model", () => {
  const m = configService.getAiModel();
  // O renderer usa ESTE valor pra escolher entre o canal com streaming
  // (send-to-gemini-stream, mostra o raciocínio ao vivo) e o sem streaming
  // (send-to-gemini, só entrega o texto no fim). Quando os dois discordam, é
  // aqui que dá pra ver — sem isso a escolha do canal é invisível no log.
  console.log(`[get-ai-model] -> ${JSON.stringify(m)}`);
  return m;
});
ipcMain.handle("get-edition", () => edition.getEdition());
ipcMain.on("open-config-ui", () => helpers.createConfigWindow());
ipcMain.on("open-preferences-ui", () => helpers.createPreferencesWindow());

function broadcastAiModelChange(data = {}) {
  try {
    const { BrowserWindow } = require("electron");
    BrowserWindow.getAllWindows().forEach((win) => {
      if (win && !win.isDestroyed()) win.webContents.send("ai-model-changed", data);
    });
  } catch (err) {
    console.warn("Error broadcasting ai-model-changed:", err);
  }
}

ipcMain.on("set-ai-model", (event, aiModel) => {
  const anterior = configService.getAiModel();
  // Trocar de provedor no meio de uma resposta invalida a resposta — aí abortar
  // é certo. Mas o botão Salvar das Configurações reenvia SEMPRE o modelo
  // atual, mesmo sem alteração nenhuma: abortar incondicionalmente matava a
  // resposta em andamento só porque o usuário abriu e salvou as Configurações
  // enquanto esperava. O sintoma era "mandei a pergunta e nunca veio nada".
  if (anterior !== aiModel) {
    try { BackendService.abortCurrentRequest(); } catch (_) {}
  }
  configService.setAiModel(aiModel);
  broadcastAiModelChange({ provider: aiModel });
});

ipcMain.handle("get-openai-model", () => configService.getOpenAiModel());
ipcMain.on("set-openai-model", (event, model) => {
  configService.setOpenAiModel(model);
  broadcastAiModelChange({ provider: 'openIa', model });
});

ipcMain.handle("get-openai-reasoning-effort", () => configService.getOpenAiReasoningEffort());
ipcMain.on("set-openai-reasoning-effort", (event, effort) => configService.setOpenAiReasoningEffort(effort));
ipcMain.handle("get-openai-vision-model", () => configService.getOpenAiVisionModel());
ipcMain.on("set-openai-vision-model", (event, model) => configService.setOpenAiVisionModel(model));

ipcMain.handle("get-backend-model", () => configService.getBackendModel ? configService.getBackendModel() : '');
ipcMain.on("set-backend-model", (event, model) => {
  if (configService.setBackendModel) configService.setBackendModel(model);
  broadcastAiModelChange({ provider: 'llama', model });
});

ipcMain.handle("get-ollama-local-model", () => configService.getOllamaLocalModel());
ipcMain.on("set-ollama-local-model", (event, model) => {
  configService.setOllamaLocalModel(model);
  broadcastAiModelChange({ provider: 'ollamaLocal', model });
});
ipcMain.handle("get-ollama-local-host", () => configService.getOllamaLocalHost());

ipcMain.handle("get-gemini-cli-model", () => configService.getGeminiCliModel());

ipcMain.on("set-gemini-cli-model", (event, model) => {
  configService.setGeminiCliModel(model);
  GeminiCliProvider.setModel(model);
  broadcastAiModelChange({ provider: 'geminiCli', model });
});

ipcMain.handle("get-gemini-cli-models", () => GeminiCliProvider.getModels());

ipcMain.handle("check-gemini-cli-installed", async () => {
  try {
    const ok = await GeminiCliProvider.checkInstalled();
    return { installed: ok };
  } catch (e) {
    return { installed: false, error: String(e && e.message) };
  }
});

ipcMain.handle("gemini-cli-restart-session", async () => {
  const projectPath = workspace.getProjectPath();
  await GeminiCliProvider.changeProject(projectPath, projectPath).catch(() => {});
  return { ok: true };
});

ipcMain.handle("get-claude-cli-model", () => configService.getClaudeCliModel());

ipcMain.on("set-claude-cli-model", (event, model) => {
  configService.setClaudeCliModel(model);
  ClaudeCliProvider.setModel(model);
  broadcastAiModelChange({ provider: 'claudeCli', model });
});

ipcMain.handle("get-claude-cli-models", () => ClaudeCliProvider.getModels());

ipcMain.handle("check-claude-cli-installed", async () => {
  try {
    const ok = await ClaudeCliProvider.checkInstalled();
    return { installed: ok };
  } catch (e) {
    return { installed: false, error: String(e && e.message) };
  }
});

ipcMain.handle("claude-cli-restart-session", async () => {
  const projectPath = workspace.getProjectPath();
  await ClaudeCliProvider.changeProject(projectPath, projectPath).catch(() => {});
  return { ok: true };
});

ipcMain.handle("get-copilot-cli-model", () => configService.getCopilotCliModel());

ipcMain.on("set-copilot-cli-model", (event, model) => {
  configService.setCopilotCliModel(model);
  CopilotCliProvider.setModel(model);
  broadcastAiModelChange({ provider: 'copilotCli', model });
});

ipcMain.handle("get-copilot-cli-models", () => CopilotCliProvider.getModels());

ipcMain.handle("check-copilot-cli-installed", async () => {
  try {
    const ok = await CopilotCliProvider.checkInstalled();
    return { installed: ok };
  } catch (e) {
    return { installed: false, error: String(e && e.message) };
  }
});

ipcMain.handle("check-ollama-local-status", async () => {
  try {
    const svc = require('../../services/ollamaLocalService');
    const ok = await svc.ping();
    if (!ok) return { running: false, models: null };
    const models = await svc.listInstalledModels();
    return { running: true, models: models || [] };
  } catch (e) {
    return { running: false, error: String(e && e.message), models: null };
  }
});

ipcMain.handle("get-open-ia-token", () => {
    return configService.getOpenIaToken();
});

ipcMain.on("set-open-ia-token", (event, token) => {
    configService.setOpenIaToken(token);
});

ipcMain.on("send-os-question", async (event, data) => {
  const text = typeof data === 'string' ? data : data.text;
  const image = typeof data === 'object' ? data.image : null;
  
  // Close input window
  if (state.osInputWindow && !state.osInputWindow.isDestroyed()) {
    state.osInputWindow.close();
  }

  // Com o Tutor ligado no modo integrado, uma pergunta de TEXTO (Ctrl+I) vai
  // direto PRO TUTOR — ele responde na própria telinha, com o contexto da tela,
  // em vez de abrir uma janela separada sem contexto. (Com imagem colada segue
  // o fluxo normal de visão abaixo.)
  if (!image && text && text.trim() && configService.getOsIntegrationStatus() && visionGuide.isActive()) {
    try { visionGuide.askQuestion(text.trim()); } catch (e) { console.warn('[vision-guide] askQuestion falhou:', e.message); }
    return;
  }

  // Show loading notification
  helpers.createOsNotificationWindow('loading', 'Processando pergunta...');
  
  try {
    // Imagem colada no input integrado = a imagem É a fonte da pergunta. Força
    // visão (não deixa o roteador OCR decidir mandar só texto e descartar a
    // imagem). Sem imagem, segue o fluxo de texto normal.
    await helpers.processOsQuestion(text, image, image ? { forceVision: true } : {});
  } catch (error) {
    console.error('Error processing OS question:', error);
    helpers.createOsNotificationWindow('response', 'Erro ao processar pergunta.');
  }
});

};
