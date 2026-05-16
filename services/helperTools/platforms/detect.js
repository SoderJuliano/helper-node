// services/helperTools/platforms/detect.js
// Detecta plataforma do usuário (OS, distro, package manager, shell, DE).
// Resultado vai pro system prompt da IA pra ela usar comandos certos.

const os = require("os");
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

function commandExistsSync(cmd) {
  try {
    execSync(`command -v ${cmd}`, { stdio: "ignore" });
    return true;
  } catch (_) {
    return false;
  }
}

function detectPackageManager() {
  // Ordem importa: prioridade pra nativos.
  if (commandExistsSync("apt")) return "apt";
  if (commandExistsSync("pacman")) return "pacman";
  if (commandExistsSync("dnf")) return "dnf";
  if (commandExistsSync("yum")) return "yum";
  if (commandExistsSync("zypper")) return "zypper";
  if (commandExistsSync("apk")) return "apk";
  if (commandExistsSync("brew")) return "brew";
  if (commandExistsSync("port")) return "port";
  return "unknown";
}

function detectDistro() {
  if (os.platform() === "darwin") return "macos";
  if (os.platform() === "win32") return "windows";
  try {
    const osRelease = fs.readFileSync("/etc/os-release", "utf-8");
    const idMatch = osRelease.match(/^ID=(.+)$/m);
    const id = idMatch ? idMatch[1].replace(/"/g, "").toLowerCase() : "";
    return id || "linux";
  } catch (_) {
    return "linux";
  }
}

function detectShell() {
  const shell = process.env.SHELL || "";
  if (shell.endsWith("/fish")) return "fish";
  if (shell.endsWith("/zsh")) return "zsh";
  if (shell.endsWith("/bash")) return "bash";
  if (shell.endsWith("/sh")) return "sh";
  return path.basename(shell) || "bash";
}

function detectDesktopEnvironment() {
  const xdg = (process.env.XDG_CURRENT_DESKTOP || "").toUpperCase();
  if (xdg.includes("COSMIC")) return "COSMIC";
  if (xdg.includes("KDE")) return "KDE";
  if (xdg.includes("GNOME")) return "GNOME";
  if (xdg.includes("HYPRLAND")) return "Hyprland";
  if (xdg.includes("SWAY")) return "Sway";
  if (xdg.includes("XFCE")) return "XFCE";
  if (xdg.includes("MATE")) return "MATE";
  if (xdg.includes("CINNAMON")) return "Cinnamon";
  if (os.platform() === "darwin") return "macOS";
  return xdg || "unknown";
}

function detectShellConfigFile(homeDir) {
  // Retorna o config padrão do shell atual. Cria caminho mesmo se não existir
  // (quem ler decide o que fazer com arquivo ausente).
  const shell = detectShell();
  switch (shell) {
    case "fish":
      return path.join(homeDir, ".config", "fish", "config.fish");
    case "zsh":
      return path.join(homeDir, ".zshrc");
    case "bash":
      return path.join(homeDir, ".bashrc");
    default:
      return path.join(homeDir, ".profile");
  }
}

let cached = null;

function detect() {
  if (cached) return cached;
  const home = os.homedir();
  const distro = detectDistro();
  const pkg = detectPackageManager();
  const shell = detectShell();
  const de = detectDesktopEnvironment();
  const isWayland = process.env.XDG_SESSION_TYPE === "wayland";

  cached = {
    os: os.platform(), // 'linux' | 'darwin' | 'win32'
    arch: os.arch(),
    distro, // 'pop' | 'arch' | 'fedora' | 'macos' | ...
    pkg, // 'apt' | 'pacman' | 'dnf' | 'brew' | ...
    shell, // 'bash' | 'zsh' | 'fish'
    de, // 'COSMIC' | 'KDE' | 'GNOME' | 'Hyprland' | ...
    isWayland,
    home,
    shellConfig: detectShellConfigFile(home),
    user: os.userInfo().username,
  };
  return cached;
}

function describeForPrompt() {
  const p = detect();
  return [
    `OS: ${p.os} (${p.distro})`,
    `Arquitetura: ${p.arch}`,
    `Package manager: ${p.pkg}`,
    `Shell padrão: ${p.shell} (config: ${p.shellConfig})`,
    `Desktop: ${p.de}${p.isWayland ? " (Wayland)" : ""}`,
    `Home: ${p.home}`,
    `Usuário: ${p.user}`,
  ].join("\n");
}

module.exports = { detect, describeForPrompt };
