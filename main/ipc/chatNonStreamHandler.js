// main/ipc/chatNonStreamHandler.js
const {
  BackendService, GeminiCliProvider, ClaudeCliProvider, CopilotCliProvider, TesseractService,
  OpenAIService, configService, workspace, agenticWorkflow,
  ollamaAgenticWorkflow, helpers, appConfig, Notification, state,
  path, fs, fs2,
} = require('../globals.js');

function getCompositeSender(eventSender) {
  return {
    send: (channel, ...args) => {
      try {
        if (eventSender && typeof eventSender.send === 'function') {
          eventSender.send(channel, ...args);
        }
      } catch (_) {}
      try {
        if (state.nexaWindow && !state.nexaWindow.isDestroyed() && state.nexaWindow.webContents !== eventSender) {
          state.nexaWindow.webContents.send(channel, ...args);
        }
      } catch (_) {}
    }
  };
}

function emitToTargets(eventSender, channel, ...args) {
  try {
    if (eventSender && typeof eventSender.send === 'function') {
      eventSender.send(channel, ...args);
    }
  } catch (_) {}
  try {
    if (state.nexaWindow && !state.nexaWindow.isDestroyed() && state.nexaWindow.webContents !== eventSender) {
      state.nexaWindow.webContents.send(channel, ...args);
    }
  } catch (_) {}
}

async function handleSendToGemini(event, text, sessionId) {
  try {
    const compositeSender = getCompositeSender(event.sender);
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

    const visualCtx = await helpers.prepareVisualPromptContext(text, aiModel);
    let promptCurrentWithVisual = text;
    let promptWithVisualContext = promptWithHistory;
    if (visualCtx.screenshotPath) {
      const visualHeader = `[CAPTURA DE TELA EM TEMPO REAL: Janela/Tela "${visualCtx.sourceName}"]\nArquivo: ${visualCtx.screenshotPath}\nTexto capturado da tela por OCR:\n"""\n${visualCtx.ocrText || "(Visual gráfico da janela)"}\n"""\nDIRETIVA VISUAL: Você tem acesso visual direto à tela/janela do usuário capturada acima. Responda DIRETAMENTE sobre o conteúdo visual e textual da tela. NUNCA diga que não consegue ver a tela.\n\n---\n\n`;
      promptCurrentWithVisual = visualHeader + text;
      promptWithVisualContext = visualHeader + promptWithHistory;
    }

    if (aiModel === 'geminiCli') {
      const projectPath = workspace.getProjectPath();
      const geminiModel = configService.getGeminiCliModel();
      GeminiCliProvider.setModel(geminiModel);
      const finalPrompt = helpers.appendVoiceSummaryInstructionIfNeeded(helpers.appendAttachmentsContext(promptCurrentWithVisual));
      try {
        await GeminiCliProvider.send(finalPrompt, projectPath, compositeSender, sessionId, pastMessages);
      } catch (gcliErr) {
        console.error('[gemini-cli] send error:', gcliErr.message);
        try { emitToTargets(event.sender, 'gemini-stream-complete'); } catch (_) {}
      }
      return;
    }

    if (aiModel === 'claudeCli') {
      const projectPath = workspace.getProjectPath();
      const claudeModel = configService.getClaudeCliModel();
      ClaudeCliProvider.setModel(claudeModel);
      const finalPrompt = helpers.appendVoiceSummaryInstructionIfNeeded(helpers.appendAttachmentsContext(promptCurrentWithVisual));
      try {
        await ClaudeCliProvider.send(finalPrompt, projectPath, compositeSender, sessionId, pastMessages);
      } catch (ccliErr) {
        console.error('[claude-cli] send error:', ccliErr.message);
        try { emitToTargets(event.sender, 'gemini-stream-complete'); } catch (_) {}
      }
      return;
    }

    if (aiModel === 'copilotCli') {
      const projectPath = workspace.getProjectPath();
      const copilotModel = configService.getCopilotCliModel();
      CopilotCliProvider.setModel(copilotModel);
      const finalPrompt = helpers.appendVoiceSummaryInstructionIfNeeded(helpers.appendAttachmentsContext(promptWithVisualContext));
      try {
        await CopilotCliProvider.send(finalPrompt, projectPath, compositeSender, {
          attachments: helpers.getAttachableFilePaths(),
        });
      } catch (cpErr) {
        console.error('[copilot-cli] send error:', cpErr.message);
        try { emitToTargets(event.sender, 'gemini-stream-complete'); } catch (_) {}
      }
      return;
    }

    const isZai = (aiModel === 'zaiGlm');
    if (aiModel === 'openIa' || aiModel === 'openIaCodex' || isZai) {
      const token = isZai ? configService.getZaiApiKey() : configService.getOpenIaToken();
      const instruction = helpers.withUserContext(configService.getPromptInstruction());
      if (!token) {
        if (appConfig.notificationsEnabled && Notification.isSupported()) {
          new Notification({
            title: "Erro de Configuração",
            body: isZai
              ? "A chave da Z.ai não está configurada. Por favor, adicione a key nas configurações de API."
              : "O token da OpenAI não está configurado. Por favor, adicione o token nas configurações.",
            silent: true,
          }).show();
        }
        return;
      }
      const openAiModel = isZai ? configService.getZaiModel() : configService.getOpenAiModel();
      const useAgentic = helpers.shouldUseAgentic(text);
      if (useAgentic) { try { workspace.resetContextSent(); } catch (_) {} }

      const userCtx = helpers.getUserPreferencesContext ? helpers.getUserPreferencesContext() : '';
      const promptWithUserCtx = userCtx ? `${userCtx}\n\n---\n\n${promptWithVisualContext}` : promptWithVisualContext;
      const _wsText2 = await helpers.prependWorkspaceContextIfNeeded(promptWithUserCtx, openAiModel);
      const _imgInline = visualCtx.imageBase64 || helpers.inlineImageForProvider(aiModel);

      if (useAgentic) {
        console.log('🤖 IPC: Iniciando AGENTIC WORKFLOW (multi-fase)...');
        if (OpenAIService.sessions) OpenAIService.sessions = {};

        try {
          resposta = await agenticWorkflow.run(
            _wsText2,
            { token, model: openAiModel, baseInstruction: instruction, imageBase64: _imgInline, isZai },
            compositeSender
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
        const _finalOpenAiPrompt = helpers.appendVoiceSummaryInstructionIfNeeded(_augText2);
        const _finalOpenAiInstruction = ht.instruction ? helpers.appendVoiceSummaryInstructionIfNeeded(ht.instruction) : helpers.appendVoiceSummaryInstructionIfNeeded(instruction);
        resposta = await OpenAIService.makeOpenAIRequest(
          _finalOpenAiPrompt,
          token,
          _finalOpenAiInstruction,
          ht.model || openAiModel,
          _imgInline,
          { ...(ht.opts || {}), isZai }
        );
      }
      const usage = OpenAIService.lastUsage;
      emitToTargets(event.sender, "openai-final-response", { resposta, usedKnowledge, usage });
      return;
    } else if (aiModel === 'ollamaLocal') {
      console.log("IPC: Usando Ollama Local Service...");
      const OllamaLocalService = require('../../services/ollamaLocalService');
      const instructionO = helpers.withUserContext(configService.getPromptInstruction(), { aiModel: 'ollamaLocal' });
      const _wsTxt = await helpers.prependWorkspaceContextIfNeeded(text, 'ollama');
      const _kbL = await helpers.knowledgeBlockForOllama(text);
      if (_kbL) usedKnowledge = true;
      const _augTextL = _kbL ? _kbL + "\n\n---\n\n" + _wsTxt : _wsTxt;
      const _ht = helpers.buildHelperToolsOpenAIOpts(_augTextL, instructionO, configService.getOpenAiModel());

      resposta = await OllamaLocalService.responder(_augTextL, { ..._ht.opts, sessionId });
      if (typeof resposta === 'string' && (resposta.trim().startsWith('{') || resposta.includes('"response"'))) {
        try {
          const { parseNexaResponse } = require('../nexa/nexaResponseHelper.js');
          const parsed = parseNexaResponse(resposta);
          if (parsed && parsed.response) resposta = parsed.response;
        } catch (_) {}
      }
      emitToTargets(event.sender, "gemini-response", { resposta, usedKnowledge });
      return;
    }

    console.log("IPC: Usando Backend Service...");
    const instructionO2 = helpers.withUserContext(configService.getPromptInstruction());
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
          compositeSender
        );
      } catch (err) {
        resposta = `[Ollama Agentic Workflow] Interrompido ou falhou: ${err.message}`;
      }
    } else {
      resposta = await BackendService.responder(_augTxtO2, _htO2.opts);
    }
    emitToTargets(event.sender, "gemini-response", { resposta, usedKnowledge });
  } catch (error) {
    console.error("Erro ao chamar o modelo:", error.message);
    emitToTargets(event.sender, "transcription-error", "Falha ao processar resposta da IA.");
  }
}

async function handleSendToGeminiVision(event, { text, image }) {
  try {
    const compositeSender = getCompositeSender(event.sender);
    const aiModel = helpers.getEffectiveAiModel();

    let imageFilePath = null;
    try {
      const imageAttachments = require('../../services/imageAttachments.js');
      const dir = imageAttachments.ensureDir();
      const tmpImgPath = path.join(dir, `screen-intent-${Date.now()}.png`);
      const base64Data = image.replace(/^data:image\/\w+;base64,/, '');
      await fs.writeFile(tmpImgPath, Buffer.from(base64Data, 'base64'));
      if (fs2.existsSync(tmpImgPath)) {
        imageFilePath = tmpImgPath;
        if (workspace.purgeEphemeralCaptures) {
          workspace.purgeEphemeralCaptures();
        }
        await workspace.addPath(tmpImgPath, 'file', {
          trustAgy: true,
          meta: { origin: 'screen-capture' },
        });
      }
    } catch (saveErr) {
      console.warn('[handleSendToGeminiVision] Erro ao anexar imagem ao workspace:', saveErr.message);
    }

    const isGenericUserTextCli = !text || !text.trim() || /^(image in context|processo texto da imagem|captura de tela)$/i.test(text.trim());
    const promptDirective = isGenericUserTextCli
      ? 'Analise a imagem anexada capturada da tela e forneça a solução, resposta ou explicação detalhada.'
      : text.trim();

    if (aiModel === 'geminiCli') {
      const ocr = await TesseractService.getTextFromImage(image).catch(() => '');
      const baseTxt = `${promptDirective}${(ocr && ocr.trim()) ? `\n\nConteúdo extraído via OCR:\n${ocr.trim()}` : ''}`;
      const projectPath = workspace.getProjectPath();
      const geminiModel = configService.getGeminiCliModel();
      GeminiCliProvider.setModel(geminiModel);
      const finalPrompt = helpers.appendVoiceSummaryInstructionIfNeeded(helpers.appendAttachmentsContext(baseTxt));
      try {
        await GeminiCliProvider.send(finalPrompt, projectPath, compositeSender, null, []);
      } catch (gcliErr) {
        console.error('[gemini-cli send-to-gemini-vision] send error:', gcliErr.message);
        try { emitToTargets(event.sender, 'gemini-stream-complete'); } catch (_) {}
      }
      return;
    } else if (aiModel === 'claudeCli') {
      const ocr = await TesseractService.getTextFromImage(image).catch(() => '');
      const baseTxt = `${promptDirective}${(ocr && ocr.trim()) ? `\n\nConteúdo extraído via OCR:\n${ocr.trim()}` : ''}`;
      const projectPath = workspace.getProjectPath();
      const claudeModel = configService.getClaudeCliModel();
      ClaudeCliProvider.setModel(claudeModel);
      const finalPrompt = helpers.appendVoiceSummaryInstructionIfNeeded(helpers.appendAttachmentsContext(baseTxt));
      try {
        await ClaudeCliProvider.send(finalPrompt, projectPath, compositeSender, null, []);
      } catch (ccliErr) {
        console.error('[claude-cli send-to-gemini-vision] send error:', ccliErr.message);
        try { emitToTargets(event.sender, 'gemini-stream-complete'); } catch (_) {}
      }
      return;
    } else if (aiModel === 'copilotCli') {
      const ocr = await TesseractService.getTextFromImage(image).catch(() => '');
      const baseTxt = `${promptDirective}${(ocr && ocr.trim()) ? `\n\nConteúdo extraído via OCR:\n${ocr.trim()}` : ''}`;
      const projectPath = workspace.getProjectPath();
      const copilotModel = configService.getCopilotCliModel();
      CopilotCliProvider.setModel(copilotModel);
      const finalPrompt = helpers.appendVoiceSummaryInstructionIfNeeded(helpers.appendAttachmentsContext(baseTxt));
      try {
        await CopilotCliProvider.send(finalPrompt, projectPath, compositeSender, {
          attachments: helpers.getAttachableFilePaths(),
        });
      } catch (cpErr) {
        console.error('[copilot-cli send-to-gemini-vision] send error:', cpErr.message);
        try { emitToTargets(event.sender, 'gemini-stream-complete'); } catch (_) {}
      }
      return;
    } else if (aiModel !== 'openIa' && aiModel !== 'openIaCodex' && aiModel !== 'zaiGlm') {
      const ocr = await TesseractService.getTextFromImage(image).catch(() => '');
      const instructionO = helpers.withUserContext(configService.getPromptInstruction());
      const baseTxt = (text && text.trim() ? `${text}\n\n` : '')
        + (ocr && ocr.trim() ? `Conteúdo extraído da imagem:\n${ocr}` : '');
      const _wsTxt = await helpers.prependWorkspaceContextIfNeeded(baseTxt, 'ollama');
      const _ht = helpers.buildHelperToolsOpenAIOpts(_wsTxt, instructionO, configService.getOpenAiModel());
      const resposta = await BackendService.responder(_wsTxt, _ht.opts);
      emitToTargets(event.sender, "gemini-response", { resposta, usedKnowledge: false });
      return;
    }

    const isZai = (aiModel === 'zaiGlm');
    const token = isZai ? configService.getZaiApiKey() : configService.getOpenIaToken();
    const instruction = helpers.withUserContext(configService.getPromptInstruction());
    if (!token) {
      emitToTargets(event.sender, "transcription-error", isZai ? "Chave da Z.ai não configurada." : "Token da OpenAI não configurado.");
      return;
    }
    const historyService = require('../../services/historyService');
    let currentSession = historyService.getCurrentSession();
    if (!currentSession) {
      try { currentSession = await historyService.createNewSession('Conversa'); } catch (_) {}
    }
    const activeSessionId = currentSession ? currentSession.id : 'default';

    const userCtx = helpers.getUserPreferencesContext ? helpers.getUserPreferencesContext() : '';
    const isGenericUserText = !text || !text.trim() || /^(image in context|processo texto da imagem|captura de tela)$/i.test(text.trim());
    const baseVisionDirective = isGenericUserText
      ? `Você está analisando uma imagem/captura enviada pelo usuário em uma entrevista técnica, teste comportamental/psicotécnico (Gupy, Mindsight) ou ambiente de trabalho.
Identifique com precisão o que está na imagem (pergunta teórica, teste comportamental/fit cultural, desafio de código, quiz de múltipla escolha ou formulário).
Entregue a SOLUÇÃO COMPLETA, DIRETA e APROFUNDADA:
- Se for teste comportamental/fit cultural (Gupy/Mindsight): aplique a calibração de Engenheiro de Software (alta autodisciplina/persistência, decisões analíticas e racionais, alta estabilidade emocional, extroversão equilibrada e colaborativa; ordene 1 a 3 com texto exato ou Mais/Menos).
- Se for desafio de código: escreva a solução funcional ideal e explique a complexidade de tempo/espaço.
- Se for pergunta técnica/entrevista: responda em primeira pessoa com autoridade técnica e exemplo prático.
- Se for múltipla escolha: indique a alternativa correta em destaque e a justificativa técnica.
NUNCA faça descrições vagas ou respostas genéricas.`
      : `Analise a IMAGEM com atenção e responda diretamente ao pedido do usuário com profundidade e precisão técnica.`;

    const userTextPart = (text && text.trim() && !isGenericUserText) ? `${text.trim()}\n\n` : '';
    const visionPrompt = helpers.appendVoiceSummaryInstructionIfNeeded(
      (userCtx ? `${userCtx}\n\n---\n\n` : '')
      + userTextPart
      + baseVisionDirective
      + '\n\nIMPORTANTE: na imagem, "x" entre dois números significa MULTIPLICAÇÃO '
      + '(ex.: "11x2" = 11 × 2 = 22, NÃO é 11 ao quadrado). '
      + 'Notação de potência seria "11²" ou "11^2".'
    );
    const visionModel = isZai
      ? configService.getZaiModel()
      : ((configService.getOpenAiVisionModel && configService.getOpenAiVisionModel()) || configService.getOpenAiModel() || 'gpt-4o');
    const ht = helpers.buildHelperToolsOpenAIOpts(visionPrompt, instruction, visionModel);
    const finalInstruction = ht.instruction ? helpers.appendVoiceSummaryInstructionIfNeeded(ht.instruction) : helpers.appendVoiceSummaryInstructionIfNeeded(instruction);
    console.log(`🤖 IPC visão: ${isZai ? 'Z.ai' : 'OpenAI'} ${ht.model || visionModel} (chat)...`);
    const resposta = await OpenAIService.makeOpenAIRequest(
      visionPrompt,
      token,
      finalInstruction,
      ht.model || visionModel,
      image,
      { stateless: false, sessionId: activeSessionId, isZai, ...(ht.opts || {}) }
    );
    if (currentSession && resposta) {
      const userContent = text && text.trim() ? text.trim() : 'Image in context';
      try {
        await historyService.addMessage(currentSession.id, 'user', userContent);
        await historyService.addMessage(currentSession.id, 'assistant', resposta);
      } catch (_) {}
    }
    emitToTargets(event.sender, "openai-final-response", { resposta, usedKnowledge: false });
  } catch (error) {
    console.error("IPC visão: erro ao analisar imagem:", error && error.message);
    emitToTargets(event.sender, "transcription-error", "Falha ao analisar a imagem com a IA.");
  }
}

module.exports = {
  handleSendToGemini,
  handleSendToGeminiVision,
};
