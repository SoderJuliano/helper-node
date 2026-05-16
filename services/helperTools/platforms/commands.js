// services/helperTools/platforms/commands.js
// Mapeia operações abstratas ("instalar pacote", "exportar variável") pra
// comandos nativos da plataforma detectada. A IA NÃO precisa saber qual
// distro é — ela pede "install grim" e a gente traduz.

const { detect } = require("./detect");

function installPackage(pkgNames) {
  const arr = Array.isArray(pkgNames) ? pkgNames : [pkgNames];
  const list = arr.join(" ");
  switch (detect().pkg) {
    case "apt":
      return `sudo apt update && sudo apt install -y ${list}`;
    case "pacman":
      return `sudo pacman -S --noconfirm ${list}`;
    case "dnf":
    case "yum":
      return `sudo ${detect().pkg} install -y ${list}`;
    case "zypper":
      return `sudo zypper install -y ${list}`;
    case "apk":
      return `sudo apk add ${list}`;
    case "brew":
      return `brew install ${list}`;
    default:
      return null;
  }
}

function exportVarStatement(name, value) {
  // Retorna a linha pra adicionar no rc file de acordo com o shell.
  const shell = detect().shell;
  if (shell === "fish") return `set -gx ${name} "${value}"`;
  return `export ${name}="${value}"`;
}

function reloadShellCommand() {
  const shell = detect().shell;
  if (shell === "fish") return `source ~/.config/fish/config.fish`;
  if (shell === "zsh") return `source ~/.zshrc`;
  return `source ~/.bashrc`;
}

module.exports = {
  installPackage,
  exportVarStatement,
  reloadShellCommand,
};
