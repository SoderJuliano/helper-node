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
// Sintaxe bash — só faz sentido em shell POSIX.
function injetarHelpersPosix(escrever) {
  try {
    const script = [
      'cd() { builtin cd "$@" && printf "\\033[32m📁 Pasta atual: %s\\033[0m\\n" "$(pwd)"; }',
      'git() { if [ "$1" = "add" ]; then command git "$@" && command git status -s; else command git "$@"; fi; }',
      '__helper_git_b() { local b; b=$(git symbolic-ref --short HEAD 2>/dev/null || git rev-parse --short HEAD 2>/dev/null); [ -n "$b" ] && printf " \\033[35m(%s)\\033[0m" "$b"; }',
      'PS1=\'\\[\\033[36m\\]\\w\\[\\033[0m\\]$(__helper_git_b) \\[\\033[32m\\]>\\033[0m\\ \' export PS1',
      'alias ls="ls --color=auto" 2>/dev/null',
      'alias ll="ls -lah --color=auto" 2>/dev/null',
      'alias la="ls -A --color=auto" 2>/dev/null'
    ].join('\n') + '\n';
    escrever(script);
  } catch (e) {
    console.warn("[terminal] falha ao injetar helpers POSIX:", e.message);
  }
}

// Helpers ultraleves para PowerShell no Windows: UTF-8, prompt Dracula ANSI instantâneo (<0.5ms) com branch Git, cd /d compatível, git add com status e ls inteligente colorido e responsivo.
// Passado via -EncodedCommand para inicialização 100% limpa e silenciosa sem poluir o buffer de tela do terminal.
const PS_INIT_SCRIPT = [
  '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8',
  '$OutputEncoding = [System.Text.Encoding]::UTF8',
  '$env:GIT_PAGER = "cat"',
  '$env:PAGER = "cat"',
  '$env:COLORTERM = "truecolor"',
  '$env:FORCE_COLOR = "1"',
  '$env:CLICOLOR = "1"',
  '$env:CLICOLOR_FORCE = "1"',
  'Remove-Item alias:cd -Force -ErrorAction SilentlyContinue',
  'function global:cd { param([Parameter(ValueFromRemainingArguments=$true)][string[]]$PathArgs); if ($PathArgs.Count -gt 1 -and $PathArgs[0] -eq "/d") { Set-Location -LiteralPath ($PathArgs[1..($PathArgs.Count-1)] -join " ") } elseif ($PathArgs.Count -ge 1) { Set-Location -LiteralPath ($PathArgs -join " ") } else { Set-Location ~ } }',
  'function global:git { if ($args.Count -ge 1 -and $args[0] -eq "add") { & (Get-Command -CommandType Application git) @args; & (Get-Command -CommandType Application git) status -s } else { & (Get-Command -CommandType Application git) @args } }',
  '$e = [char]27; function global:prompt { $lastOk = $?; $loc = (Get-Location).Path; $homeDir = $HOME; $p = if ($homeDir -and $loc.StartsWith($homeDir, [System.StringComparison]::OrdinalIgnoreCase)) { "~" + $loc.Substring($homeDir.Length) } else { $loc }; $b = ""; $curr = $loc; for ($j = 0; $j -lt 6; $j++) { $g = [System.IO.Path]::Combine($curr, ".git"); if ([System.IO.Directory]::Exists($g)) { $h = [System.IO.Path]::Combine($g, "HEAD"); if ([System.IO.File]::Exists($h)) { $c = [System.IO.File]::ReadAllText($h).Trim(); if ($c.StartsWith("ref: refs/heads/")) { $b = " (" + $c.Substring(16) + ")" } elseif ($c) { $b = " (" + $c.Substring(0, [Math]::Min(7, $c.Length)) + ")" } } break } elseif ([System.IO.File]::Exists($g)) { try { $gtxt = [System.IO.File]::ReadAllText($g).Trim(); if ($gtxt.StartsWith("gitdir: ")) { $tg = $gtxt.Substring(8).Trim(); if (-not [System.IO.Path]::IsPathRooted($tg)) { $tg = [System.IO.Path]::Combine($curr, $tg) } $h = [System.IO.Path]::Combine($tg, "HEAD"); if ([System.IO.File]::Exists($h)) { $c = [System.IO.File]::ReadAllText($h).Trim(); if ($c.StartsWith("ref: refs/heads/")) { $b = " (" + $c.Substring(16) + ")" } } } } catch {} break } $parent = [System.IO.Path]::GetDirectoryName($curr); if (-not $parent -or $parent -eq $curr) { break }; $curr = $parent }; $arr = if ($lastOk) { "$e[32m" } else { "$e[31m" }; "$e[36m$p$e[35m$b $arr>$e[0m " }',
  'Remove-Item alias:ls -Force -ErrorAction SilentlyContinue',
  'Remove-Item alias:ll -Force -ErrorAction SilentlyContinue',
  'Remove-Item alias:la -Force -ErrorAction SilentlyContinue',
  'Remove-Item alias:dir -Force -ErrorAction SilentlyContinue',
  'function global:ls {',
  '  param([Parameter(ValueFromRemainingArguments=$true)][string[]]$PathArgs);',
  '  if ($MyInvocation.ExpectingInput) { return (Get-ChildItem @PathArgs) };',
  '  $isLong = $false; $showHidden = $false; $targets = [System.Collections.Generic.List[string]]::new();',
  '  if ($PathArgs) { foreach ($arg in $PathArgs) {',
  '    if ($arg -eq "-l" -or $arg -eq "/l") { $isLong = $true }',
  '    elseif ($arg -eq "-a" -or $arg -eq "-all" -or $arg -eq "/a") { $showHidden = $true }',
  '    elseif ($arg -eq "-la" -or $arg -eq "-al" -or $arg -eq "-alF") { $isLong = $true; $showHidden = $true }',
  '    elseif ($arg.StartsWith("-") -and $arg.Contains("l")) { $isLong = $true; if ($arg.Contains("a")) { $showHidden = $true } }',
  '    else { $targets.Add($arg) }',
  '  } };',
  '  if ($targets.Count -eq 0) { $targets.Add(".") };',
  '  $getColor = { param($it); if ($it.PSIsContainer) { return "$e[1;36m" }; $ext = $it.Extension.ToLowerInvariant(); switch -Wildcard ($ext) { "*.exe" { return "$e[1;32m" }; "*.bat" { return "$e[1;32m" }; "*.cmd" { return "$e[1;32m" }; "*.ps1" { return "$e[1;32m" }; "*.sh" { return "$e[1;32m" }; "*.js" { return "$e[33m" }; "*.ts" { return "$e[33m" }; "*.jsx" { return "$e[33m" }; "*.tsx" { return "$e[33m" }; "*.json"{ return "$e[33m" }; "*.md" { return "$e[35m" }; "*.html"{ return "$e[34m" }; "*.css" { return "$e[34m" }; "*.zip" { return "$e[1;31m" }; "*.tar" { return "$e[1;31m" }; "*.gz" { return "$e[1;31m" }; default { if ($it.Name.StartsWith(".")) { return "$e[90m" }; return "$e[37m" } } };',
  '  foreach ($target in $targets) {',
  '    $items = @(); try {',
  '      $gciParams = @{ Path = $target; ErrorAction = "SilentlyContinue" }; if ($showHidden) { $gciParams["Force"] = $true };',
  '      $items = @(Get-ChildItem @gciParams);',
  '      if ($items.Count -eq 0 -and (Test-Path -Path $target)) { $items = @(Get-Item -Path $target -Force:$showHidden -ErrorAction SilentlyContinue) }',
  '    } catch { [Console]::Error.WriteLine("ls: cannot access " + $target + ": No such file or directory"); continue };',
  '    if ($items.Count -eq 0) { if (-not (Test-Path -Path $target)) { [Console]::Error.WriteLine("ls: cannot access " + $target + ": No such file or directory") }; continue };',
  '    if ($targets.Count -gt 1) { [Console]::Out.WriteLine($target + ":") };',
  '    $termWidth = 80; try { if ($Host.UI.RawUI.WindowSize.Width -gt 20) { $termWidth = $Host.UI.RawUI.WindowSize.Width } } catch {};',
  '    if (-not $isLong) {',
  '      $formatted = [System.Collections.Generic.List[object]]::new(); $maxLen = 0;',
  '      foreach ($it in $items) {',
  '        $suffix = if ($it.PSIsContainer) { "/" } else { "" };',
  '        $name = $it.Name + $suffix;',
  '        if ($name.Length -gt $maxLen) { $maxLen = $name.Length };',
  '        $clr = & $getColor $it;',
  '        $formatted.Add([PSCustomObject]@{ Len = $name.Length; Display = "$clr$name$e[0m" })',
  '      };',
  '      $colWidth = [Math]::Min($termWidth - 2, $maxLen + 3);',
  '      $numCols = [Math]::Max(1, [Math]::Floor($termWidth / $colWidth));',
  '      $numRows = [Math]::Ceiling($formatted.Count / $numCols);',
  '      for ($r = 0; $r -lt $numRows; $r++) {',
  '        $line = "";',
  '        for ($c = 0; $c -lt $numCols; $c++) {',
  '          $idx = $r + ($c * $numRows);',
  '          if ($idx -lt $formatted.Count) {',
  '            $item = $formatted[$idx];',
  '            $padCount = [Math]::Max(1, ($colWidth - $item.Len));',
  '            $pad = " " * $padCount;',
  '            $line += $item.Display + $pad;',
  '          }',
  '        };',
  '        [Console]::Out.WriteLine($line.TrimEnd());',
  '      }',
  '    } else {',
  '      foreach ($it in $items) {',
  '        $clr = & $getColor $it; $mode = if ($it.PSIsContainer) { "d----" } else { "-a---" };',
  '        $date = $it.LastWriteTime.ToString("dd/MM/yyyy  HH:mm");',
  '        $size = if ($it.PSIsContainer) { "<DIR>     " } else {',
  '          $len = $it.Length;',
  '          if ($len -ge 1GB) { ("{0,7:N1} GB" -f ($len / 1GB)) }',
  '          elseif ($len -ge 1MB) { ("{0,7:N1} MB" -f ($len / 1MB)) }',
  '          elseif ($len -ge 1KB) { ("{0,7:N1} KB" -f ($len / 1KB)) }',
  '          else { ("{0,7} B " -f $len) }',
  '        };',
  '        $sfx = if ($it.PSIsContainer) { "/" } else { "" };',
  '        $name = $it.Name + $sfx;',
  '        [Console]::Out.WriteLine("$mode  $date  $size  $clr$name$e[0m");',
  '      }',
  '    };',
  '    if ($targets.Count -gt 1) { [Console]::Out.WriteLine("") }',
  '  }',
  '}',
  'function global:ll { ls -l @args }',
  'function global:la { ls -la @args }',
  'function global:dir { ls @args }'
].join('\n');
const PS_INIT_BASE64 = Buffer.from(PS_INIT_SCRIPT, 'utf16le').toString('base64');

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
    let shell = "";
    let shellArgs = [];
    let isPowerShell = false;

    if (isWin) {
      const pwshPath = "C:\\Program Files\\PowerShell\\7\\pwsh.exe";
      const sysPowerShell = process.env.SystemRoot
        ? path.join(process.env.SystemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe")
        : "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe";

      if (fs2.existsSync(pwshPath)) {
        shell = pwshPath;
        shellArgs = ["-NoProfile", "-NoLogo", "-ExecutionPolicy", "Bypass", "-NoExit", "-EncodedCommand", PS_INIT_BASE64];
        isPowerShell = true;
      } else if (fs2.existsSync(sysPowerShell)) {
        shell = sysPowerShell;
        shellArgs = ["-NoProfile", "-NoLogo", "-ExecutionPolicy", "Bypass", "-NoExit", "-EncodedCommand", PS_INIT_BASE64];
        isPowerShell = true;
      } else {
        shell = process.env.COMSPEC || "cmd.exe";
        shellArgs = [];
        isPowerShell = false;
      }
    } else {
      shell = process.env.SHELL || "/bin/bash";
      shellArgs = ["-i"];
      isPowerShell = false;
    }

    state.terminalShellType = isWin ? (isPowerShell ? "powershell" : "cmd") : "posix";

    state.terminalPty = pty.spawn(shell, shellArgs, {
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

    // Injeta helpers para shells POSIX (PowerShell já inicializa de forma limpa via -EncodedCommand)
    if (!isWin) {
      injetarHelpersPosix((s) => state.terminalPty.write(s));
    }

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
