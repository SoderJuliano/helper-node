const path = require("path");
const fs = require("fs");

function isFlag(arg) {
  if (!arg || typeof arg !== "string") return false;
  return arg.startsWith("-");
}

function isInternalRuntimeArg(arg) {
  if (!arg || typeof arg !== "string") return false;
  const lower = arg.toLowerCase().replace(/\\/g, "/");
  if (lower.endsWith("/electron.exe") || lower.endsWith("/electron")) return true;
  if (lower.endsWith("/node.exe") || lower.endsWith("/node")) return true;
  if (lower.endsWith("/main.js") || lower.endsWith("/launch.js")) return true;
  if (arg === ".") return false; // "." is a valid directory reference
  return false;
}

function cleanPathString(raw) {
  if (!raw || typeof raw !== "string") return "";
  let clean = raw.trim();
  clean = clean.replace(/^[`'"]+|[`'"]+$/g, "");
  clean = clean.replace(/^file:\/\/\/?([a-zA-Z]:)/i, "$1").replace(/^file:\/\//i, "");
  return clean;
}

function extractTargetPaths(argv, workingDir) {
  if (!Array.isArray(argv)) return [];
  const baseDir = workingDir || process.cwd();
  const results = [];

  for (let i = 1; i < argv.length; i++) {
    const raw = argv[i];
    if (isFlag(raw) || isInternalRuntimeArg(raw)) continue;

    const cleaned = cleanPathString(raw);
    if (!cleaned) continue;

    // Se o argumento for "." ou caminho relativo, resolve com baseDir
    const resolved = path.isAbsolute(cleaned)
      ? path.normalize(cleaned)
      : path.resolve(baseDir, cleaned);

    if (!results.includes(resolved)) {
      results.push(resolved);
    }
  }

  return results;
}

async function processTarget(targetPath, { state, workspace }) {
  if (!targetPath || typeof targetPath !== "string") return;
  const absPath = path.resolve(targetPath);

  try {
    if (!fs.existsSync(absPath)) {
      // Se nao existe mas o diretorio pai existe, cria arquivo vazio para edicao
      const parentDir = path.dirname(absPath);
      if (fs.existsSync(parentDir) && path.extname(absPath)) {
        try {
          fs.writeFileSync(absPath, "", "utf8");
        } catch (writeErr) {
          console.warn("[systemIntegration] Falha ao criar arquivo novo:", writeErr.message);
          return;
        }
      } else {
        console.warn("[systemIntegration] Caminho inexistente:", absPath);
        return;
      }
    }

    const stat = fs.statSync(absPath);
    const win = state && state.mainWindow;

    if (stat.isDirectory()) {
      if (workspace && typeof workspace.openProject === "function") {
        await workspace.openProject(absPath);
      }
      if (win && !win.isDestroyed()) {
        win.webContents.send("workspace-changed", {
          attachments: workspace ? workspace.list() : [],
        });
      }
    } else {
      if (workspace && typeof workspace.addPath === "function") {
        try {
          await workspace.addPath(absPath, "file");
        } catch (addErr) {
          console.warn("[systemIntegration] Falha ao anexar ao workspace:", addErr.message);
        }
      }

      if (win && !win.isDestroyed()) {
        if (workspace && typeof workspace.list === "function") {
          win.webContents.send("workspace-changed", {
            attachments: workspace.list(),
          });
        }
        win.webContents.send("open-file-in-viewer", absPath);
        win.webContents.send("set-chat-collapsed", true);
      }
    }
  } catch (err) {
    console.error("[systemIntegration] Erro ao processar target:", err.message);
  }
}

async function dispatchTargets(targets, deps) {
  if (!Array.isArray(targets) || targets.length === 0) return;
  for (const target of targets) {
    await processTarget(target, deps);
  }
}

module.exports = {
  extractTargetPaths,
  processTarget,
  dispatchTargets,
  cleanPathString,
};
