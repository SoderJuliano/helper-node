const fs = require("fs");
const path = require("path");
const os = require("os");

function getRootDir() {
  return path.resolve(__dirname, "..", "..");
}

function getWindowsTargetPaths() {
  const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local");
  const winAppsDir = path.join(localAppData, "Microsoft", "WindowsApps");
  return {
    cmd: path.join(winAppsDir, "helper-node.cmd"),
    ps1: path.join(winAppsDir, "helper-node.ps1"),
    dir: winAppsDir,
  };
}

function getUnixTargetPath() {
  return path.join(os.homedir(), ".local", "bin", "helper-node");
}

async function installWindowsCli() {
  const rootDir = getRootDir();
  const sourceCmd = path.join(rootDir, "bin", "helper-node.cmd");
  const targets = getWindowsTargetPaths();

  if (!fs.existsSync(sourceCmd)) {
    return { ok: false, error: "Arquivo de origem bin/helper-node.cmd nao encontrado." };
  }

  try {
    if (!fs.existsSync(targets.dir)) {
      fs.mkdirSync(targets.dir, { recursive: true });
    }

    fs.copyFileSync(sourceCmd, targets.cmd);
    return { ok: true, path: targets.cmd };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

async function uninstallWindowsCli() {
  const targets = getWindowsTargetPaths();
  try {
    if (fs.existsSync(targets.cmd)) {
      fs.unlinkSync(targets.cmd);
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

async function isWindowsCliInstalled() {
  const targets = getWindowsTargetPaths();
  return fs.existsSync(targets.cmd);
}

async function installUnixCli() {
  const rootDir = getRootDir();
  const sourceBin = path.join(rootDir, "bin", "helper-node");
  const targetBin = getUnixTargetPath();
  const targetDir = path.dirname(targetBin);

  if (!fs.existsSync(sourceBin)) {
    return { ok: false, error: "Script bin/helper-node nao encontrado." };
  }

  try {
    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }

    // Garante permissao de execucao
    try {
      fs.chmodSync(sourceBin, 0o755);
    } catch (_) {}

    if (fs.existsSync(targetBin) || fs.lstatSync(targetBin, { throwIfNoEntry: false })) {
      try { fs.unlinkSync(targetBin); } catch (_) {}
    }

    fs.symlinkSync(sourceBin, targetBin);
    return { ok: true, path: targetBin };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

async function uninstallUnixCli() {
  const targetBin = getUnixTargetPath();
  try {
    if (fs.existsSync(targetBin) || fs.lstatSync(targetBin, { throwIfNoEntry: false })) {
      fs.unlinkSync(targetBin);
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

async function isUnixCliInstalled() {
  const targetBin = getUnixTargetPath();
  return fs.existsSync(targetBin) || !!fs.lstatSync(targetBin, { throwIfNoEntry: false });
}

async function installCli() {
  if (process.platform === "win32") {
    return installWindowsCli();
  }
  return installUnixCli();
}

async function uninstallCli() {
  if (process.platform === "win32") {
    return uninstallWindowsCli();
  }
  return uninstallUnixCli();
}

async function isCliInstalled() {
  if (process.platform === "win32") {
    return isWindowsCliInstalled();
  }
  return isUnixCliInstalled();
}

module.exports = {
  installCli,
  uninstallCli,
  isCliInstalled,
  installWindowsCli,
  uninstallWindowsCli,
  installUnixCli,
  uninstallUnixCli,
};
