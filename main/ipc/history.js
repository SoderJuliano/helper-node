// main/ipc/history.js
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
  ipcMain
} = require('../globals.js');

module.exports = function registerIpc() {
ipcMain.handle('get-last-three-sessions', async () => {
  try {
    return historyService.getLastThreeSessions();
  } catch (error) {
    console.error('Erro ao obter últimas 3 sessões:', error);
    return [];
  }
});

ipcMain.handle('get-all-sessions', async () => {
  try {
    return historyService.getAllSessions();
  } catch (error) {
    console.error('Erro ao obter todas as sessões:', error);
    return [];
  }
});

ipcMain.handle('seed-ai-session', async (event, messages) => {
  try {
    const n = OpenAIService.seedSession(Array.isArray(messages) ? messages : []);
    return { ok: true, seeded: n };
  } catch (error) {
    console.error('Erro ao restaurar contexto da IA:', error);
    return { ok: false, error: error.message };
  }
});

ipcMain.handle('get-session-by-id', async (event, sessionId) => {
  try {
    return historyService.getSessionById(sessionId);
  } catch (error) {
    console.error('Erro ao obter sessão:', error);
    return null;
  }
});

ipcMain.handle('download-conversation-txt', async (event, sessionId) => {
  try {
    // dataset.sessionId vem como string; historyService usa Date.now() (number).
    // Tenta number primeiro, fallback pra string original.
    const numericId = Number(sessionId);
    const session = historyService.getSessionById(Number.isFinite(numericId) ? numericId : sessionId)
      || historyService.getSessionById(sessionId);
    if (!session) return { ok: false, error: 'Sessao nao encontrada.' };

    const homeDir = require('os').homedir();
    const candidates = [
      path.join(homeDir, 'Downloads'),
      path.join(homeDir, 'Documents'),
      '/tmp',
    ];
    let outDir = null;
    for (const d of candidates) {
      try {
        await fs.access(d);
        outDir = d;
        break;
      } catch (_) {}
    }
    if (!outDir) outDir = require('os').tmpdir();

    const safeTitle = (session.title || 'conversa')
      .toString()
      .replace(/[\\/:*?"<>|]+/g, '_')
      .replace(/\s+/g, '_')
      .slice(0, 60);
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const fileName = `helper-node_${stamp}_${safeTitle}.txt`;
    const fullPath = path.join(outDir, fileName);

    const header = [
      `# Helper Node - ${session.title || '(sem titulo)'}`,
      `# Sessao: ${session.id}`,
      `# Data: ${new Date().toISOString()}`,
      '',
      '',
    ].join('\n');

    const body = (session.conversations || []).map((msg) => {
      const label = msg.role === 'user' ? 'P:' : 'R:';
      return `${label}\n${msg.content}\n${'─'.repeat(60)}\n`;
    }).join('\n');

    await fs.writeFile(fullPath, header + body, 'utf8');
    console.log(`📥 Conversa exportada: ${fullPath}`);
    return { ok: true, path: fullPath };
  } catch (error) {
    console.error('Erro ao exportar conversa:', error);
    return { ok: false, error: error.message };
  }
});

ipcMain.handle('add-message', async (event, sessionId, role, content) => {
  try {
    const finalSessionId = await historyService.addMessage(sessionId, role, content);
    return { success: true, sessionId: finalSessionId };
  } catch (error) {
    console.error('Erro ao adicionar mensagem ao histórico:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('create-new-session', async (event, title) => {
  try {
    const session = await historyService.createNewSession(title);
    return session;
  } catch (error) {
    console.error('Erro ao criar sessão:', error);
    return null;
  }
});

ipcMain.handle('new-chat', async () => {
  try {
    const session = await historyService.createNewSession('Nova conversa');
    // Nova sessao = re-injeta contexto do workspace na proxima pergunta.
    try { workspace.resetContextSent && workspace.resetContextSent(); } catch (_) {}
    return session;
  } catch (error) {
    console.error('Erro ao criar novo chat:', error);
    return null;
  }
});

ipcMain.handle('delete-session', async (event, sessionId) => {
  try {
    const success = await historyService.deleteSession(sessionId);
    if (success) {
      console.log(`✓ Sessão ${sessionId} deletada com sucesso`);
    }
    return { success };
  } catch (error) {
    console.error('Erro ao deletar sessão:', error);
    return { success: false, error: error.message };
  }
});

};
