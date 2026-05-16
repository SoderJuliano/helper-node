// services/helperTools/backup.js
// Copia arquivo pra ~/.config/helper-node/backups/ ANTES de qualquer edição.
// Rotação: mantém últimos N por arquivo.

const fs = require("fs/promises");
const path = require("path");
const audit = require("./audit");

let backupDir = null;
let maxPerFile = 50;

function init(dir, max) {
  backupDir = dir;
  if (typeof max === "number" && max > 0) maxPerFile = max;
}

function _stamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function _safeName(absPath) {
  // /home/u/.bashrc -> home_u_.bashrc
  return absPath.replace(/^\/+/, "").replace(/\//g, "_");
}

/**
 * Cria backup do arquivo. Se arquivo não existe, NOOP (não há o que salvar).
 * @returns { backupPath } | null
 */
async function backup(absPath) {
  if (!backupDir) return null;
  try {
    await fs.access(absPath); // existe?
  } catch (_) {
    return null;
  }
  try {
    await fs.mkdir(backupDir, { recursive: true });
    const safe = _safeName(absPath);
    const dest = path.join(backupDir, `${_stamp()}__${safe}`);
    await fs.copyFile(absPath, dest);
    await _rotate(safe);
    audit.log("BACKUP", { source: absPath, backup: dest });
    return dest;
  } catch (e) {
    audit.log("BACKUP_FAIL", { source: absPath, error: e.message });
    return null;
  }
}

async function _rotate(safeName) {
  try {
    const files = (await fs.readdir(backupDir))
      .filter((f) => f.endsWith(`__${safeName}`))
      .sort(); // ISO timestamps no início ordenam cronologicamente
    while (files.length > maxPerFile) {
      const old = files.shift();
      try {
        await fs.unlink(path.join(backupDir, old));
      } catch (_) {}
    }
  } catch (_) {}
}

/**
 * Lista backups disponíveis para um arquivo.
 */
async function listBackups(absPath) {
  if (!backupDir) return [];
  const safe = _safeName(absPath);
  try {
    const files = (await fs.readdir(backupDir))
      .filter((f) => f.endsWith(`__${safe}`))
      .sort()
      .reverse(); // mais recente primeiro
    return files.map((f) => path.join(backupDir, f));
  } catch (_) {
    return [];
  }
}

/**
 * Restaura um backup. Por segurança, exige path do backup explícito.
 */
async function restore(backupPath, targetPath) {
  await fs.copyFile(backupPath, targetPath);
  audit.log("RESTORE", { backup: backupPath, target: targetPath });
}

module.exports = { init, backup, listBackups, restore };
