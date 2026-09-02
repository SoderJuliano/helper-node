// main/ipc/chatStreamHandler.js
const {
  BackendService, configService, helpers,
} = require('../globals.js');

async function handleSendToGeminiStream(event, text, sessionId) {
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
      const _finalL = helpers.appendVoiceSummaryInstructionIfNeeded(_augTextL);

      await OllamaLocalService.responderStream(
        _finalL,
        (chunk) => {
          event.sender.send("gemini-stream-chunk", chunk);
        },
        () => {
          event.sender.send("gemini-stream-complete");
        },
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

    const _finalBackendPrompt = helpers.appendVoiceSummaryInstructionIfNeeded(_augTxtO2);

    if (_htO2.opts && _htO2.opts.tools && _htO2.opts.onToolCall) {
      const AgentService = require('../../services/backendAgentService');
      if (await AgentService.suportaAgente()) {
        console.log("IPC: modo AGENTE (tool calling nativo via /agent)");
        await AgentService.agentStream(
          _finalBackendPrompt,
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
          {
            sessionId,
            instruction: _htO2.instruction || instructionO2,
            tools: _htO2.opts.tools,
            onToolCall: _htO2.opts.onToolCall,
            userText: text,
          }
        );
        return;
      }
    }

    await BackendService.responderStream(
      _finalBackendPrompt,
      (chunk) => {
        event.sender.send("gemini-stream-chunk", chunk);
      },
      () => {
        event.sender.send("gemini-stream-complete");
      },
      (error) => {
        if (error && (error.message === 'Request cancelled' || error.message === 'Cancelado.')) {
          console.log('[ipc] Stream cancelado pelo usuário.');
          event.sender.send("transcription-error", "Request cancelled");
          return;
        }
        console.error("Stream error:", error);
        event.sender.send("transcription-error", error.message);
      },
      { ..._htO2.opts, sessionId, userText: text }
    );
  } catch (error) {
    if (error && (error.message === 'Request cancelled' || error.message === 'Cancelado.')) {
      console.log('[ipc] Stream cancelado pelo usuário (catch externo).');
      event.sender.send("transcription-error", "Request cancelled");
      return;
    }
    console.error("Erro no stream:", error.message);
    event.sender.send("transcription-error", "Falha ao processar streaming da IA.");
  }
}

async function handleSendToGeminiImageStream(event, { text, image, sessionId }) {
  try {
    const aiModel = helpers.getEffectiveAiModel();
    if (aiModel === 'ollamaLocal') {
      const OllamaLocalService = require('../../services/ollamaLocalService');
      const instructionO = configService.getPromptInstruction();
      const _wsTxt = await helpers.prependWorkspaceContextIfNeeded(text, 'ollama');
      const _kbL = await helpers.knowledgeBlockForOllama(text);
      const _augTextL = _kbL ? _kbL + "\n\n---\n\n" + _wsTxt : _wsTxt;
      const _ht = helpers.buildHelperToolsOpenAIOpts(_augTextL, instructionO, configService.getOpenAiModel());
      const _finalL = helpers.appendVoiceSummaryInstructionIfNeeded(_augTextL);

      await OllamaLocalService.responderStream(
        _finalL,
        (chunk) => { event.sender.send("gemini-stream-chunk", chunk); },
        () => { event.sender.send("gemini-stream-complete"); },
        (error) => {
          if (error && (error.message === 'Request cancelled' || error.message === 'Cancelado.')) {
            event.sender.send("transcription-error", "Request cancelled");
            return;
          }
          event.sender.send("transcription-error", error.message);
        },
        { ..._ht.opts, sessionId, imageBase64: image }
      );
      return;
    }

    const instruction = configService.getPromptInstruction();
    const _wsTxt = await helpers.prependWorkspaceContextIfNeeded(text, 'ollama');
    const _kb = await helpers.knowledgeBlockForOllama(text);
    const _augTxt = _kb ? _kb + "\n\n---\n\n" + _wsTxt : _wsTxt;
    const _ht = helpers.buildHelperToolsOpenAIOpts(_augTxt, instruction, configService.getOpenAiModel());
    const _finalBackendPrompt = helpers.appendVoiceSummaryInstructionIfNeeded(_augTxt);

    await BackendService.responderStream(
      _finalBackendPrompt,
      (chunk) => { event.sender.send("gemini-stream-chunk", chunk); },
      () => { event.sender.send("gemini-stream-complete"); },
      (error) => {
        if (error && (error.message === 'Request cancelled' || error.message === 'Cancelado.')) {
          event.sender.send("transcription-error", "Request cancelled");
          return;
        }
        event.sender.send("transcription-error", error.message);
      },
      { ..._ht.opts, sessionId, imageBase64: image, userText: text }
    );
  } catch (error) {
    if (error && (error.message === 'Request cancelled' || error.message === 'Cancelado.')) {
      event.sender.send("transcription-error", "Request cancelled");
      return;
    }
    event.sender.send("transcription-error", "Falha ao processar streaming com imagem.");
  }
}

module.exports = {
  handleSendToGeminiStream,
  handleSendToGeminiImageStream,
};
