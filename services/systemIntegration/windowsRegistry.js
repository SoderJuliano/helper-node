const path = require("path");
const { execFile } = require("child_process");
const util = require("util");

const execFileAsync = util.promisify(execFile);

function isWindows() {
  return process.platform === "win32";
}

function runReg(args) {
  return execFileAsync("reg.exe", args, { windowsHide: true });
}

const fs = require("fs");

function getRegistryCommands(opts = {}) {
  const appDir = opts.appDir || path.resolve(__dirname, "..", "..");
  const iconPath = opts.iconPath || path.join(appDir, "assets", "windows.ico");

  const localElectron = path.join(appDir, "node_modules", "electron", "dist", "electron.exe");
  const isPackaged = typeof opts.isPackaged === "boolean"
    ? opts.isPackaged
    : (!process.defaultApp && !process.execPath.toLowerCase().includes("node.exe") && !fs.existsSync(localElectron));

  let execPath = opts.execPath;
  if (!execPath) {
    if (isPackaged) {
      execPath = process.execPath;
    } else if (fs.existsSync(localElectron)) {
      execPath = localElectron;
    } else {
      execPath = process.execPath;
    }
  }

  let fileCommand;
  let dirCommand;
  let dirBackgroundCommand;

  if (isPackaged) {
    fileCommand = `"${execPath}" "%1"`;
    dirCommand = `"${execPath}" "%1"`;
    dirBackgroundCommand = `"${execPath}" "%V"`;
  } else {
    fileCommand = `"${execPath}" "${appDir}" "%1"`;
    dirCommand = `"${execPath}" "${appDir}" "%1"`;
    dirBackgroundCommand = `"${execPath}" "${appDir}" "%V"`;
  }

  return {
    appDir,
    execPath,
    iconPath,
    fileCommand,
    dirCommand,
    dirBackgroundCommand,
  };
}

async function installContextMenu(opts = {}) {
  if (!isWindows()) {
    return { ok: false, error: "Disponivel apenas no sistema Windows." };
  }

  const { iconPath, fileCommand, dirCommand, dirBackgroundCommand } = getRegistryCommands(opts);
  const title = opts.title || "Abrir com Helper Node";

  try {
    // 1. Arquivos (*\shell\HelperNode)
    await runReg(["add", "HKCU\\Software\\Classes\\*\\shell\\HelperNode", "/ve", "/d", title, "/f"]);
    await runReg(["add", "HKCU\\Software\\Classes\\*\\shell\\HelperNode", "/v", "Icon", "/d", iconPath, "/f"]);
    await runReg(["add", "HKCU\\Software\\Classes\\*\\shell\\HelperNode\\command", "/ve", "/d", fileCommand, "/f"]);

    // 2. Diretorios (Directory\shell\HelperNode)
    await runReg(["add", "HKCU\\Software\\Classes\\Directory\\shell\\HelperNode", "/ve", "/d", title, "/f"]);
    await runReg(["add", "HKCU\\Software\\Classes\\Directory\\shell\\HelperNode", "/v", "Icon", "/d", iconPath, "/f"]);
    await runReg(["add", "HKCU\\Software\\Classes\\Directory\\shell\\HelperNode\\command", "/ve", "/d", dirCommand, "/f"]);

    // 3. Fundo de diretorios (Directory\Background\shell\HelperNode)
    await runReg(["add", "HKCU\\Software\\Classes\\Directory\\Background\\shell\\HelperNode", "/ve", "/d", title, "/f"]);
    await runReg(["add", "HKCU\\Software\\Classes\\Directory\\Background\\shell\\HelperNode", "/v", "Icon", "/d", iconPath, "/f"]);
    await runReg(["add", "HKCU\\Software\\Classes\\Directory\\Background\\shell\\HelperNode\\command", "/ve", "/d", dirBackgroundCommand, "/f"]);

    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

async function uninstallContextMenu() {
  if (!isWindows()) {
    return { ok: false, error: "Disponivel apenas no sistema Windows." };
  }

  const keys = [
    "HKCU\\Software\\Classes\\*\\shell\\HelperNode",
    "HKCU\\Software\\Classes\\Directory\\shell\\HelperNode",
    "HKCU\\Software\\Classes\\Directory\\Background\\shell\\HelperNode",
  ];

  let lastError = null;
  for (const key of keys) {
    try {
      await runReg(["delete", key, "/f"]);
    } catch (err) {
      // Ignora erro se a chave ja nao existia
      if (!/chave do Registro ou valor especificado/i.test(err.message)) {
        lastError = err.message;
      }
    }
  }

  if (lastError) {
    return { ok: false, error: lastError };
  }
  return { ok: true };
}

async function isContextMenuInstalled() {
  if (!isWindows()) return false;
  try {
    await runReg(["query", "HKCU\\Software\\Classes\\*\\shell\\HelperNode"]);
    return true;
  } catch (_) {
    return false;
  }
}

module.exports = {
  isWindows,
  getRegistryCommands,
  installContextMenu,
  uninstallContextMenu,
  isContextMenuInstalled,
};
