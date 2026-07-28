// main/helpers/getIaResponse.js
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
  state, helpers,
  appConfig, Notification
} = require('../globals.js');

helpers.getIaResponse = async function(text) {
  state.globalBypassAllConfirmations = false;
  console.log("getIaResponse called with text:", text);
  state.waitingNotificationInterval = setInterval(() => {
    if (appConfig.notificationsEnabled && Notification.isSupported()) {
      new Notification({
        title: "Helper-Node",
        body: "Aguarde, gerando uma resposta...",
        silent: true,
      }).show();
    }
  }, 10000);

  let resposta;
  let usedKnowledge = false; // base de conhecimento foi injetada nesta resposta?
  try {
    const aiModel = helpers.getEffectiveAiModel();
    console.log("Current AI Model:", aiModel);

    if (aiModel === 'openIa') {
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
            clearInterval(state.waitingNotificationInterval);
            state.waitingNotificationInterval = null;
            return;
        }
        const openAiModel = configService.getOpenAiModel();

        // Comando direto não planeja (só executa); tarefa complexa → agentic.
        const useAgentic = helpers.shouldUseAgentic(text);

        // O agentic limpa as sessões da IA; sem re-injetar o contexto do
        // workspace a IA "esquece" o projeto. Reseta a flag ANTES de montar o
        // contexto pra garantir que a estrutura do projeto entre neste turno.
        if (useAgentic) { try { workspace.resetContextSent(); } catch (_) {} }

        const _wsText1 = await helpers.prependWorkspaceContextIfNeeded(text, openAiModel);

        if (useAgentic) {
            console.log('🤖 Iniciando AGENTIC WORKFLOW (multi-fase)...');
            // Limpa a sessão anterior pra evitar contaminação entre tarefas distintas.
            if (OpenAIService.sessions) OpenAIService.sessions = {};

            try {
              resposta = await agenticWorkflow.run(
                  _wsText1,
                  { token, model: openAiModel, baseInstruction: instruction },
                  state.mainWindow.webContents
              );
            } catch (err) {
              resposta = `[Agentic Workflow] Interrompido ou falhou: ${err.message}`;
            } finally {
              // Próximo turno re-injeta o contexto do projeto (a sessão foi limpa).
              try { workspace.resetContextSent(); } catch (_) {}
            }
        } else {
            const _kb1 = await helpers.knowledgeBlockForOpenAI(text);
            if (_kb1) usedKnowledge = true;
            const _augText1 = _kb1 ? _kb1 + "\n\n---\n\n" + _wsText1 : _wsText1;
            const ht = helpers.buildHelperToolsOpenAIOpts(_augText1, instruction, openAiModel);
            resposta = await OpenAIService.makeOpenAIRequest(
              _augText1,
              token,
              ht.instruction || instruction,
              ht.model || openAiModel,
              null,
              ht.opts
            );
        }
    } else if (aiModel === 'ollamaLocal') {
        const OllamaLocalService = require('../../services/ollamaLocalService');
        const _kbL = await helpers.knowledgeBlockForOllama(text);
        if (_kbL) usedKnowledge = true;
        const _augTextL = _kbL ? _kbL + "\n\n---\n\n" + text : text;

        const htEnabled = configService.getHelperToolsEnabled && configService.getHelperToolsEnabled();
        if (htEnabled) {
          const instructionO = configService.getPromptInstruction();
          const _wsTxtO = await helpers.prependWorkspaceContextIfNeeded(_augTextL, 'ollama');
          const _htO = helpers.buildHelperToolsOpenAIOpts(_wsTxtO, instructionO, configService.getOpenAiModel());
          resposta = await OllamaLocalService.responder(_wsTxtO, _htO.opts);
        } else {
          resposta = await OllamaLocalService.responder(_augTextL);
        }
    } else {
        // Ollama/Backend e' o unico provider nao-OpenAI suportado.
        // Helper tools agora funcionam tambem no Ollama (via structured prompt + parser).
        try {
          const instructionO = configService.getPromptInstruction();
          const useAgentic = helpers.shouldUseAgentic(text);
          if (useAgentic) { try { workspace.resetContextSent(); } catch (_) {} }
          const _wsTxtO = await helpers.prependWorkspaceContextIfNeeded(text, 'ollama');

          if (useAgentic) {
              console.log('🤖 Iniciando AGENTIC WORKFLOW OLLAMA (multi-fase)...');
              BackendService.clearSessions();
              try {
                resposta = await ollamaAgenticWorkflow.run(
                    _wsTxtO, 
                    { baseInstruction: instructionO },
                    state.mainWindow.webContents
                );
              } catch (err) {
                resposta = `[Ollama Agentic] Interrompido ou falhou: ${err.message}`;
              }
          } else {
              const _kbO = await helpers.knowledgeBlockForOllama(text);
              if (_kbO) usedKnowledge = true;
              const _augTxtO = _kbO ? _kbO + "\n\n---\n\n" + _wsTxtO : _wsTxtO;
              const _htO = helpers.buildHelperToolsOpenAIOpts(_augTxtO, instructionO, configService.getOpenAiModel());
              resposta = await BackendService.responder(_augTxtO, _htO.opts);
          }
          state.backendIsOnline = true;
        } catch (backendError) {
          console.error("Backend Ollama falhou:", backendError && backendError.message);
          state.backendIsOnline = false;
          throw new Error(
            "Backend Ollama indisponivel. Verifique se o servico esta rodando ou troque pra OpenAI em Configuracoes."
          );
        }
    }

    clearInterval(state.waitingNotificationInterval);
    state.waitingNotificationInterval = null;

    // Formata a resposta para exibição na UI
    const formattedResposta = helpers.formatToHTML(resposta);
    state.mainWindow.webContents.send("gemini-response", { resposta: formattedResposta, usedKnowledge });

    // Usa a resposta crua para a notificação de texto simples
    if (appConfig.notificationsEnabled && Notification.isSupported()) {
      const plainTextBody = helpers.formatForPlainTextNotification(resposta);
      const chunks = helpers.chunkText(plainTextBody);

      (async () => {
        for (let i = 0; i < chunks.length; i++) {
          const chunk = chunks[i];
          if (chunk) {
            new Notification({
              title: `Resposta do Assistente (${i + 1}/${chunks.length})`,
              body: chunk,
              silent: true,
            }).show();

            if (i < chunks.length - 1) {
              await new Promise((res) => setTimeout(res, 2000));
            }
          }
        }
      })();
    }
  } catch (error) {
    clearInterval(state.waitingNotificationInterval);
    state.waitingNotificationInterval = null;

    console.error("IA service error:", error);
    state.mainWindow.webContents.send(
      "transcription-error",
      "Failed to process IA response"
    );
    if (appConfig.notificationsEnabled && Notification.isSupported()) {
      new Notification({
        title: "Erro do Assistente",
        body: "Não foi possível gerar uma resposta de nenhuma fonte.",
        silent: true,
      }).show();
    }
  }
}
