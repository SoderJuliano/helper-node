const fs = require("fs");
const path = require("path");
const os = require("os");

function getDesktopFilePath() {
  return path.join(os.homedir(), ".local", "share", "applications", "helper-node.desktop");
}

function generateDesktopContent(appDir) {
  const iconPath = path.join(appDir, "assets", "linux.png");
  const execCmd = "helper-node %F";

  return `[Desktop Entry]
Name=Helper Node
Comment=Copiloto de IA e Editor de Codigo
Exec=${execCmd}
Icon=${iconPath}
Terminal=false
Type=Application
Categories=Development;TextEditor;Utility;
MimeType=text/plain;text/x-chdr;text/x-csrc;text/x-c++hdr;text/x-c++src;text/x-java;text/x-python;application/json;application/javascript;inode/directory;
`;
}

async function installLinuxDesktop(appDir) {
  if (process.platform !== "linux") return { ok: false, error: "Apenas para Linux." };

  const targetPath = getDesktopFilePath();
  const targetDir = path.dirname(targetPath);
  const dir = appDir || path.resolve(__dirname, "..", "..");

  try {
    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }
    fs.writeFileSync(targetPath, generateDesktopContent(dir), "utf8");
    return { ok: true, path: targetPath };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

async function uninstallLinuxDesktop() {
  if (process.platform !== "linux") return { ok: false, error: "Apenas para Linux." };
  const targetPath = getDesktopFilePath();
  try {
    if (fs.existsSync(targetPath)) {
      fs.unlinkSync(targetPath);
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

module.exports = {
  installLinuxDesktop,
  uninstallLinuxDesktop,
  getDesktopFilePath,
};
