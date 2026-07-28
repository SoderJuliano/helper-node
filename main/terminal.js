// main/terminal.js
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
  state, helpers
} = require('./globals.js');

helpers.writeToTerminal = function(data) {
  try {
    if (state.terminalPty) { state.terminalPty.write(data); return true; }
    if (state.terminalProcess && state.terminalProcess.stdin && state.terminalProcess.stdin.writable) {
      state.terminalProcess.stdin.write(data);
      return true;
    }
  } catch (e) {
    console.error("[terminal write] error:", e.message);
  }
  return false;
}

helpers.killTerminal = function() {
  if (state.terminalPty) { try { state.terminalPty.kill(); } catch (_) {} state.terminalPty = null; }
  if (state.terminalProcess) { try { state.terminalProcess.kill(); } catch (_) {} state.terminalProcess = null; }
}

helpers.getActiveProjectPath = function() {
  const workspace = require('../services/workspace');
  const dirItem = (workspace.list() || []).find((a) => a.type === "dir");
  if (dirItem && dirItem.path) {
    try {
      if (fs2.existsSync(dirItem.path) && fs2.statSync(dirItem.path).isDirectory()) {
        return dirItem.path;
      }
    } catch (_) {}
  }
  return os.homedir();
}

helpers.syncTerminalCwd = function(forceMessage = false) {
  const newProjectPath = helpers.getActiveProjectPath();
  if (state.currentTerminalProjectPath !== newProjectPath || forceMessage) {
    state.currentTerminalProjectPath = newProjectPath;
    if (state.terminalPty || (state.terminalProcess && state.terminalProcess.stdin && state.terminalProcess.stdin.writable)) {
      try {
        // `cd "caminho"` funciona tanto em bash/zsh quanto em cmd.exe/PowerShell.
        const nl = state.terminalPty ? "\r" : "\n";
        helpers.writeToTerminal(`cd "${newProjectPath.replace(/"/g, '\\"')}"${nl}`);
        if (state.mainWindow && !state.mainWindow.isDestroyed()) {
          state.mainWindow.webContents.send("terminal:output", {
            type: "stdout",
            data: `\x1b[32m\n[📁 Terminal sincronizado com projeto: ${newProjectPath}]\x1b[0m\n\n`
          });
        }
      } catch (e) {
        console.error("[terminal:sync] error:", e.message);
      }
    }
  }
}
