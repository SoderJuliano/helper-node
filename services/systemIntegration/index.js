const argumentHandler = require("./argumentHandler");
const windowsRegistry = require("./windowsRegistry");
const cliInstaller = require("./cliInstaller");
const linuxDesktop = require("./linuxDesktop");

function focusMainWindow(win) {
  if (!win || win.isDestroyed()) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

function handleSecondInstance(commandLine, workingDirectory, deps) {
  const { state } = deps || {};
  const win = state && state.mainWindow;

  focusMainWindow(win);

  const targets = argumentHandler.extractTargetPaths(commandLine, workingDirectory);
  if (targets.length === 0) return;

  argumentHandler.dispatchTargets(targets, deps).catch((err) => {
    console.error("[systemIntegration] Erro ao processar second-instance:", err.message);
  });
}

function handleStartupArgs(argv, workingDir, deps) {
  const { state } = deps || {};
  const targets = argumentHandler.extractTargetPaths(argv, workingDir);
  if (targets.length === 0) return;

  const win = state && state.mainWindow;
  if (!win || win.isDestroyed()) return;

  const runDispatch = () => {
    argumentHandler.dispatchTargets(targets, deps).catch((err) => {
      console.error("[systemIntegration] Erro ao processar startup args:", err.message);
    });
  };

  if (win.webContents.isLoading()) {
    win.webContents.once("did-finish-load", () => {
      setTimeout(runDispatch, 350);
    });
  } else {
    setTimeout(runDispatch, 150);
  }
}

function handleOpenFile(filePath, deps) {
  const { state } = deps || {};
  const win = state && state.mainWindow;
  focusMainWindow(win);

  if (!filePath) return;
  argumentHandler.dispatchTargets([filePath], deps).catch((err) => {
    console.error("[systemIntegration] Erro ao processar open-file:", err.message);
  });
}

module.exports = {
  argumentHandler,
  windowsRegistry,
  cliInstaller,
  linuxDesktop,
  handleSecondInstance,
  handleStartupArgs,
  handleOpenFile,
};
