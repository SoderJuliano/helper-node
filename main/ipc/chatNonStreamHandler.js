// main/ipc/chatNonStreamHandler.js
const {
  BackendService, GeminiCliProvider, ClaudeCliProvider, CopilotCliProvider, TesseractService,
  OpenAIService, configService, workspace, agenticWorkflow,
  ollamaAgenticWorkflow, helpers, appConfig, Notification,
} = require('../globals.js');

async function handleSendToGemini(event, text, sessionId) {
  try {
    const aiModel = helpers.getEffectiveAiModel();
    if (aiModel === 'llama-stream' || aiModel === 'qwen-stream' || aiModel === 'llama' || aiModel === 'ollamaLocal') {
      console.warn(`[send-to-gemini] canal SEM streaming usado com modelo "${aiModel}" — sem thinking ao vivo.`);
    }
    let resposta, usedKnowledge = false;
    let promptWithHistory = text;
    let pastMessages = [];
    if (sessionId) {
      const historyService = require('../../services/historyService');
      const session = historyService.getSessionById(Number(sessionId)) || historyService.getSessionById(sessionId);
      if (session && session.conversations && session.conversations.length > 1) {
        pastMessages = session.conversations.slice(0, -1);
        if (pastMessages.length > 0) {
          promptWithHistory = helpers.buildPromptWithHistory(text, pastMessages);
        }
      }
    }

    if (aiModel === 'geminiCli') {
      const projectPath = workspace.getProjectPath();
      const geminiModel = configService.getGeminiCliModel();
      GeminiCliProvider.setModel(geminiModel);
      const finalPrompt = helpers.appendVoiceSummaryInstructionIfNeeded(helpers.appendAttachmentsContext(text));
      try {
        await GeminiCliProvider.send(finalPrompt, projectPath, event.sender, sessionId, pastMessages);
      } catch (gcliErr) {
        console.error('[gemini-cli] send error:', gcliErr.message);
        try { event.sender.send('gemini-stream-complete'); } catch (_) {}
      }
      return;
    }

    if (aiModel === 'claudeCli') {
      const projectPath = workspace.getProjectPath();
      const claudeModel = configService.getClaudeCliModel();
      ClaudeCliProvider.setModel(claudeModel);
      const finalPrompt = helpers.appendVoiceSummaryInstructionIfNeeded(helpers.appendAttachmentsContext(text));
      try {
        await ClaudeCliProvider.send(finalPrompt, projectPath, event.sender, sessionId, pastMessages);
      } catch (ccliErr) {
        console.error('[claude-cli] send error:', ccliErr.message);
        try { event.sender.send('gemini-stream-complete'); } catch (_) {}
      }
      return;
    }

    if (aiModel === 'copilotCli') {
      const projectPath = workspace.getProjectPath();
      const copilotModel = configService.getCopilotCliModel();
      CopilotCliProvider.setModel(copilotModel);
      const finalPrompt = helpers.appendVoiceSummaryInstructionIfNeeded(helpers.appendAttachmentsContext(promptWithHistory));
      try {
        await CopilotCliProvider.send(finalPrompt, projectPath, event.sender, {
          attachments: helpers.getAttachableFilePaths(),
        });
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
      const useAgentic = helpers.shouldUseAgentic(text);
      if (useAgentic) { try { workspace.resetContextSent(); } catch (_) {} }

      const _wsText2 = await helpers.prependWorkspaceContextIfNeeded(promptWithHistory, openAiModel);
      const _imgInline = helpers.inlineImageForProvider(aiModel);

      if (useAgentic) {
        console.log('🤖 IPC: Iniciando AGENTIC WORKFLOW (multi-fase)...');
        if (OpenAIService.sessions) OpenAIService.sessions = {};

        try {
          resposta = await agenticWorkflow.run(
            _wsText2,
            { token, model: openAiModel, baseInstruction: instruction, imageBase64: _imgInline },
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
          _imgInline,
          ht.opts
        );
      }
      const usage = OpenAIService.lastUsage;
      event.sender.send("openai-final-response", { resposta, usedKnowledge, usage });
      return;
    } else if (aiModel === 'ollamaLocal') {
      console.log("IPC: Usando Ollama Local Service...");
      const OllamaLocalService = require('../../services/ollamaLocalService');
      const instructionO = configService.getPromptInstruction();
      const _wsTxt = await helpers.prependWorkspaceContextIfNeeded(text, 'ollama');
      const _kbL = await helpers.knowledgeBlockForOllama(text);
      if (_kbL) usedKnowledge = true;
      const _augTextL = _kbL ? _kbL + "\n\n---\n\n" + _wsTxt : _wsTxt;
      const _ht = helpers.buildHelperToolsOpenAIOpts(_augTextL, instructionO, configService.getOpenAiModel());

      resposta = await OllamaLocalService.responder(_augTextL, { ..._ht.opts, sessionId });
      event.sender.send("gemini-response", { resposta, usedKnowledge });
      helpers.triggerTtsPlaybackIfEnabled(resposta);
      return;
    }

    console.log("IPC: Usando Backend Service...");
    const instructionO2 = configService.getPromptInstruction();
    const _wsTxtO2 = await helpers.prependWorkspaceContextIfNeeded(text, 'ollama');
    const _kbO2 = await helpers.knowledgeBlockForOllama(text);
    if (_kbO2) usedKnowledge = true;
    const _augTxtO2 = _kbO2 ? _kbO2 + "\n\n---\n\n" + _wsTxtO2 : _wsTxtO2;
    const _htO2 = helpers.buildHelperToolsOpenAIOpts(_augTxtO2, instructionO2, configService.getOpenAiModel());
    const useAgenticOllama = helpers.shouldUseAgentic(text);

    if (useAgenticOllama && _htO2.opts && _htO2.opts.tools) {
      console.log('🤖 IPC: Iniciando OLLAMA AGENTIC WORKFLOW...');
      try {
        resposta = await ollamaAgenticWorkflow.run(
          _augTxtO2,
          { baseInstruction: instructionO2, tools: _htO2.opts.tools, onToolCall: _htO2.opts.onToolCall },
          event.sender
        );
      } catch (err) {
        resposta = `[Ollama Agentic Workflow] Interrompido ou falhou: ${err.message}`;
      }
    } else {
      resposta = await BackendService.responder(_augTxtO2, _htO2.opts);
    }
    event.sender.send("gemini-response", { resposta, usedKnowledge });
    helpers.triggerTtsPlaybackIfEnabled(resposta);
  } catch (error) {
    console.error("Erro ao chamar o modelo:", error.message);
    event.sender.send("transcription-error", "Falha ao processar resposta da IA.");
  }
}

async function handleSendToGeminiVision(event, { text, image }) {
  try {
    const aiModel = helpers.getEffectiveAiModel();

    if (aiModel === 'geminiCli') {
      const ocr = await TesseractService.getTextFromImage(image).catch(() => '');
      const baseTxt = (text && text.trim() ? `${text}\n\n` : '')
        + (ocr && ocr.trim() ? `Conteúdo extraído da imagem:\n${ocr}` : '');
      const projectPath = workspace.getProjectPath();
      const geminiModel = configService.getGeminiCliModel();
      GeminiCliProvider.setModel(geminiModel);
      const finalPrompt = helpers.appendVoiceSummaryInstructionIfNeeded(helpers.appendAttachmentsContext(baseTxt));
      try {
        await GeminiCliProvider.send(finalPrompt, projectPath, event.sender, null, []);
      } catch (gcliErr) {
        console.error('[gemini-cli send-to-gemini-vision] send error:', gcliErr.message);
        try { event.sender.send('gemini-stream-complete'); } catch (_) {}
      }
      return;
    } else if (aiModel === 'claudeCli') {
      const ocr = await TesseractService.getTextFromImage(image).catch(() => '');
      const baseTxt = (text && text.trim() ? `${text}\n\n` : '')
        + (ocr && ocr.trim() ? `Conteúdo extraído da imagem:\n${ocr}` : '');
      const projectPath = workspace.getProjectPath();
      const claudeModel = configService.getClaudeCliModel();
      ClaudeCliProvider.setModel(claudeModel);
      const finalPrompt = helpers.appendVoiceSummaryInstructionIfNeeded(helpers.appendAttachmentsContext(baseTxt));
      try {
        await ClaudeCliProvider.send(finalPrompt, projectPath, event.sender, null, []);
      } catch (ccliErr) {
        console.error('[claude-cli send-to-gemini-vision] send error:', ccliErr.message);
        try { event.sender.send('gemini-stream-complete'); } catch (_) {}
      }
      return;
    } else if (aiModel === 'copilotCli') {
      const ocr = await TesseractService.getTextFromImage(image).catch(() => '');
      const baseTxt = (text && text.trim() ? `${text}\n\n` : '')
        + (ocr && ocr.trim() ? `Conteúdo extraído da imagem:\n${ocr}` : '');
      const projectPath = workspace.getProjectPath();
      const copilotModel = configService.getCopilotCliModel();
      CopilotCliProvider.setModel(copilotModel);
      const finalPrompt = helpers.appendVoiceSummaryInstructionIfNeeded(helpers.appendAttachmentsContext(baseTxt));
      try {
        await CopilotCliProvider.send(finalPrompt, projectPath, event.sender, {
          attachments: helpers.getAttachableFilePaths(),
        });
      } catch (cpErr) {
        console.error('[copilot-cli send-to-gemini-vision] send error:', cpErr.message);
        try { event.sender.send('gemini-stream-complete'); } catch (_) {}
      }
      return;
    } else if (aiModel !== 'openIa' && aiModel !== 'openIaCodex') {
      const ocr = await TesseractService.getTextFromImage(image).catch(() => '');
      const instructionO = configService.getPromptInstruction();
      const baseTxt = (text && text.trim() ? `${text}\n\n` : '')
        + (ocr && ocr.trim() ? `Conteúdo extraído da imagem:\n${ocr}` : '');
      const _wsTxt = await helpers.prependWorkspaceContextIfNeeded(baseTxt, 'ollama');
      const _ht = helpers.buildHelperToolsOpenAIOpts(_wsTxt, instructionO, configService.getOpenAiModel());
      const resposta = await BackendService.responder(_wsTxt, _ht.opts);
      event.sender.send("gemini-response", { resposta, usedKnowledge: false });
      helpers.triggerTtsPlaybackIfEnabled(resposta);
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
    helpers.triggerTtsPlaybackIfEnabled(resposta);
  } catch (error) {
    console.error("IPC visão: erro ao analisar imagem:", error && error.message);
    event.sender.send("transcription-error", "Falha ao analisar a imagem com a IA.");
  }
}

module.exports = {
  handleSendToGemini,
  handleSendToGeminiVision,
};
