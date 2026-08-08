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
// Tamanho da janela do PTY. O front-end mede o xterm e manda o valor real; isto
// é só o ponto de partida até a primeira medida chegar.
//
// Isto ficou HARDCODED em 120x30 sem nenhum resize por muito tempo, e era a
// causa do "o terminal corta as letras na direita mesmo grande": o shell
// formatava a saída pra 120 colunas independentemente do tamanho real do
// painel, então tudo que passava disso era quebrado/escondido.
const COLS_PADRAO = 120;
const ROWS_PADRAO = 30;

// Função `cd` que mostra a pasta e `git add` que já imprime o status curto.
// Sintaxe bash — só faz sentido em shell POSIX, nunca no cmd.exe.
function injetarHelpersPosix(escrever) {
  try {
    escrever('cd() { builtin cd "$@" && printf "\\033[32m📁 Pasta atual: %s\\033[0m\\n" "$(pwd)"; }\n');
    escrever('git() { if [ "$1" = "add" ]; then command git "$@" && command git status -s; else command git "$@"; fi; }\n');
  } catch (e) {
    console.warn("[terminal] falha ao injetar helpers POSIX:", e.message);
  }
}

function dimensoesValidas(dim) {
  const cols = Math.floor(Number(dim && dim.cols));
  const rows = Math.floor(Number(dim && dim.rows));
  if (!Number.isFinite(cols) || !Number.isFinite(rows)) return null;
  // Teto generoso; piso pra nunca mandar 0 (ConPTY aborta com tamanho zero).
  if (cols < 20 || rows < 4 || cols > 1000 || rows > 400) return null;
  return { cols, rows };
}

ipcMain.handle("terminal:init", async (event, dim) => {
  helpers.killTerminal();

  const projectPath = helpers.getActiveProjectPath();
  state.currentTerminalProjectPath = projectPath;

  const inicial = dimensoesValidas(dim) || { cols: COLS_PADRAO, rows: ROWS_PADRAO };
  state.terminalSize = inicial;

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

  // === PTY de verdade via node-pty (todas as plataformas) ===
  // No Windows expõe o ConPTY; no Linux/macOS, o forkpty. É o mesmo motor do
  // terminal do VS Code, e é o único caminho que suporta resize — que o
  // fallback de Python abaixo não tem. O binário é N-API (prebuild), então
  // carrega no Electron sem recompilar; se não carregar, o Linux ainda cai no
  // Python e o Windows reporta o erro.
  try {
    const pty = require("node-pty");
    const shell = isWin
      ? (process.env.COMSPEC || "cmd.exe")
      : (process.env.SHELL || "/bin/bash");
    state.terminalPty = pty.spawn(shell, isWin ? [] : ["-i"], {
      name: "xterm-256color",
      cols: inicial.cols,
      rows: inicial.rows,
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

    // Mesmos atalhos de sempre no shell POSIX: `cd` mostra a pasta e `git add`
    // já imprime o status curto. Sintaxe bash — não faz sentido no cmd.exe.
    if (!isWin) injetarHelpersPosix((s) => state.terminalPty.write(s));

    return { ok: true, shell, projectPath, pty: true };
  } catch (e) {
    console.error("[terminal:init] node-pty indisponível:", e.message);
    state.terminalPty = null;
    if (isWin) {
      if (state.mainWindow && !state.mainWindow.isDestroyed()) {
        state.mainWindow.webContents.send("terminal:output", { type: "stderr", data: `Falha ao iniciar o terminal (node-pty): ${e.message}\r\n` });
        state.mainWindow.webContents.send("terminal:closed", { code: -1 });
      }
      return { ok: false, error: e.message };
    }
    // Linux/macOS seguem pro fallback de Python abaixo.
  }

  // === Fallback Linux/macOS: pty via Python ===
  // Sem resize: o tamanho vai só no COLUMNS/LINES do ambiente, então o shell
  // nasce certo mas não acompanha o redimensionamento da janela. Quem tiver o
  // node-pty instalado não passa por aqui.
  env.COLUMNS = String(inicial.cols);
  env.LINES = String(inicial.rows);
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

  if (state.terminalProcess.stdin && state.terminalProcess.stdin.writable) {
    injetarHelpersPosix((s) => state.terminalProcess.stdin.write(s));
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
  // Agora quem digita é o xterm.js, e ele já manda o byte que o terminal espera:
  // Enter = CR (\r), Ctrl+C = \x03, setas = \x1b[A… Tudo passa CRU pro PTY — é
  // isso que faz o vim do `git pull` ser usável em vez de adivinhação.
  //
  // A exceção é o fallback de Python (child_process, sem PTY do nosso lado):
  // ali o stdin do shell quer LF, então o CR do xterm vira \n.
  const payload = state.terminalPty ? data : String(data).replace(/\r/g, "\n");
  helpers.writeToTerminal(payload);
});

// O xterm mede o painel e manda cols/rows reais. Sem isto o shell formata pra
// uma largura que não é a da tela e o texto some na borda direita.
ipcMain.on("terminal:resize", (event, dim) => {
  const tamanho = dimensoesValidas(dim);
  if (!tamanho) return;
  if (state.terminalSize &&
      state.terminalSize.cols === tamanho.cols &&
      state.terminalSize.rows === tamanho.rows) {
    return; // ResizeObserver dispara muito; só age quando mudou de verdade.
  }
  state.terminalSize = tamanho;
  if (!state.terminalPty) return; // fallback de Python não suporta resize
  try {
    state.terminalPty.resize(tamanho.cols, tamanho.rows);
  } catch (e) {
    console.warn("[terminal:resize] falhou:", e.message);
  }
});

};
