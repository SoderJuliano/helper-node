// fileEditService.js — porteiro único de ESCRITA de arquivo pelo editor humano.
//
// Hoje só o save do editor (index.html/editorController.js) passa por aqui.
// OpenAI (helperTools/writeFile.js etc.) e os CLIs (Claude Code/Gemini) ainda
// escrevem por conta própria — este módulo é o ponto de partida pra, no
// futuro, todos convergirem pro mesmo gateway sem precisar redesenhar nada.
// Ver ARCHITECTURE.md > Editor de código.
//
// Backup usa a MESMA convenção de services/helperTools/tools/writeFile.js
// (~/.config/helper-node/backups/<data>/<timestamp>_<nome>) — humano e IA
// compartilham o mesmo diretório de backups.

const fs = require("fs");
const path = require("path");
const os = require("os");

const BACKUP_ROOT = path.join(os.homedir(), ".config", "helper-node", "backups");

function backup(absPath) {
  if (!fs.existsSync(absPath)) return null;
  try {
    const date = new Date().toISOString().slice(0, 10);
    const dir = path.join(BACKUP_ROOT, date);
    fs.mkdirSync(dir, { recursive: true });
    const target = path.join(dir, `${Date.now()}_${path.basename(absPath)}`);
    fs.copyFileSync(absPath, target);
    return target;
  } catch (e) {
    console.warn("[fileEditService] backup falhou:", e.message);
    return null;
  }
}

/**
 * Salva o conteúdo do editor. Detecta conflito comparando o mtime esperado
 * (capturado quando o editor abriu/salvou o arquivo pela última vez) com o
 * mtime real em disco no momento do save.
 *
 * v1: só AVISA (retorna conflict:true) e salva mesmo assim — não bloqueia,
 * não faz merge. É o ponto de extensão pra virar prompt/3-way merge depois,
 * sem precisar mexer em quem chama esta função.
 */
function writeFile(absPath, content, { expectedMtimeMs } = {}) {
  let conflict = false;
  if (expectedMtimeMs != null && fs.existsSync(absPath)) {
    const currentMtime = fs.statSync(absPath).mtimeMs;
    if (Math.abs(currentMtime - expectedMtimeMs) > 1) conflict = true;
  }
  const backupAt = backup(absPath);
  fs.mkdirSync(path.dirname(absPath), { recursive: true });
  fs.writeFileSync(absPath, content, "utf8");
  const st = fs.statSync(absPath);
  return { ok: true, path: absPath, backupAt, mtimeMs: st.mtimeMs, conflict };
}

module.exports = { writeFile, backup };
