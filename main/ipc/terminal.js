// main/ipc/terminal.js
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
ipcMain.handle("terminal:init", async (event) => {
  helpers.killTerminal();

  const projectPath = helpers.getActiveProjectPath();
  state.currentTerminalProjectPath = projectPath;

  const isWin = process.platform === "win32";
  const env = {
    ...process.env,
    TERM: "linux", // Evita que o fish mande queries de DA1 que causam timeout em terminais simples
    FISH_NO_SHELL_INTEGRATION: "1", // Desativa as sequências ]133; que poluem a saída
    COLORTERM: "truecolor",
    CLICOLOR: "1",
    CLICOLOR_FORCE: "1",
    FORCE_COLOR: "1",
    PYTHONUNBUFFERED: "1",
    GIT_CONFIG_PARAMETERS: "'color.ui=always'",
    // Desativa pagers interativos (less) que travavam git log/diff/branch,
    // systemctl, man etc. num terminal line-buffered sem como enviar 'q'.
    GIT_PAGER: "cat",
    PAGER: "cat",
    SYSTEMD_PAGER: "cat",
    MANPAGER: "cat",
  };

  // === Windows: ConPTY de verdade via node-pty ===
  // O `import pty` do Python é Unix-only; no Windows usamos node-pty, que expõe
  // o ConPTY (mesmo motor do terminal do VS Code). Assim Ctrl+C, prompt vivo,
  // cores e programas interativos funcionam. O binário é N-API (prebuild
  // win32-x64/arm64), então carrega no Electron sem recompilar.
  if (isWin) {
    try {
      const pty = require("node-pty");
      const shell = process.env.COMSPEC || "cmd.exe";
      state.terminalPty = pty.spawn(shell, [], {
        name: "xterm-256color",
        cols: 120,
        rows: 30,
        cwd: projectPath,
        env: { ...env, TERM: "xterm-256color" },
      });

      state.terminalPty.onData((chunk) => {
        if (state.mainWindow && !state.mainWindow.isDestroyed()) {
          state.mainWindow.webContents.send("terminal:output", { type: "stdout", data: chunk });
        }
      });

      state.terminalPty.onExit(({ exitCode }) => {
        if (state.mainWindow && !state.mainWindow.isDestroyed()) {
          state.mainWindow.webContents.send("terminal:closed", { code: exitCode });
        }
        state.terminalPty = null;
      });

      return { ok: true, shell, projectPath, pty: true };
    } catch (e) {
      console.error("[terminal:init] node-pty falhou:", e.message);
      if (state.mainWindow && !state.mainWindow.isDestroyed()) {
        state.mainWindow.webContents.send("terminal:output", { type: "stderr", data: `Falha ao iniciar o terminal (node-pty): ${e.message}\r\n` });
        state.mainWindow.webContents.send("terminal:closed", { code: -1 });
      }
      state.terminalPty = null;
      return { ok: false, error: e.message };
    }
  }

  // === Linux/macOS: pty via Python (comportamento original, intocado) ===
  const shell = process.env.SHELL || "/bin/bash";
  const ptyCode = `import pty, os; os.environ['TERM']='linux'; pty.spawn(['${shell}', '-i'])`;
  try {
    state.terminalProcess = spawn("python3", ["-c", ptyCode], {
      env,
      cwd: projectPath,
      stdio: ["pipe", "pipe", "pipe"],
    });
  } catch (_) {
    state.terminalProcess = spawn(shell, ["-i"], {
      env,
      cwd: projectPath,
      stdio: ["pipe", "pipe", "pipe"],
    });
  }

  // `spawn` não lança pra shell inexistente/ENOENT — emite 'error' de forma
  // assíncrona. Sem este handler, o terminal ficava morto sem avisar.
  state.terminalProcess.on("error", (err) => {
    if (state.mainWindow && !state.mainWindow.isDestroyed()) {
      state.mainWindow.webContents.send("terminal:output", { type: "stderr", data: `Erro no terminal: ${err.message}\r\n` });
      state.mainWindow.webContents.send("terminal:closed", { code: -1 });
    }
    state.terminalProcess = null;
  });

  state.terminalProcess.stdout.setEncoding("utf8");
  state.terminalProcess.stderr.setEncoding("utf8");

  // Injeta função cd personalizada e helper do git (feedback visual de 'git
  // add'/'commit') — sintaxe bash, só faz sentido em shell POSIX.
  if (state.terminalProcess.stdin && state.terminalProcess.stdin.writable) {
    state.terminalProcess.stdin.write('cd() { builtin cd "$@" && printf "\\033[32m📁 Pasta atual: %s\\033[0m\\n" "$(pwd)"; }\n');
    state.terminalProcess.stdin.write('git() { if [ "$1" = "add" ]; then command git "$@" && command git status -s; else command git "$@"; fi; }\n');
  }

  state.terminalProcess.stdout.on("data", (chunk) => {
    // Intercept terminal queries to prevent shells like fish from hanging for 10s
    if (state.terminalProcess && state.terminalProcess.stdin && state.terminalProcess.stdin.writable) {
      if (chunk.includes('\x1b[c') || chunk.includes('\x1b[0c')) {
        try { state.terminalProcess.stdin.write('\x1b[?1;0c'); } catch (_) {}
      }
      if (chunk.includes('\x1b]11;?')) {
        try { state.terminalProcess.stdin.write('\x1b]11;rgb:0000/0000/0000\x1b\\'); } catch (_) {}
      }
    }
    if (state.mainWindow && !state.mainWindow.isDestroyed()) {
      state.mainWindow.webContents.send("terminal:output", { type: "stdout", data: chunk });
    }
  });

  state.terminalProcess.stderr.on("data", (chunk) => {
    if (state.mainWindow && !state.mainWindow.isDestroyed()) {
      state.mainWindow.webContents.send("terminal:output", { type: "stderr", data: chunk });
    }
  });

  state.terminalProcess.on("close", (code) => {
    if (state.mainWindow && !state.mainWindow.isDestroyed()) {
      state.mainWindow.webContents.send("terminal:closed", { code });
    }
    state.terminalProcess = null;
  });

  return { ok: true, shell, projectPath };
});

ipcMain.on("terminal:input", (event, data) => {
  // ConPTY (node-pty) espera CR (\r) como Enter; o front-end manda \n. Os chars
  // de controle (Ctrl+C = \x03 etc.) passam intactos. No child_process (Linux)
  // manda como está.
  const payload = state.terminalPty ? String(data).replace(/\n/g, "\r") : data;
  helpers.writeToTerminal(payload);
});

};
