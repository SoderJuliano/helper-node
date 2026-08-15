// services/imageAttachments.js
// Imagens que entram no app sem ter arquivo próprio (Ctrl+V do clipboard,
// print HD tirado por ferramenta) precisam virar arquivo em disco pra poderem
// ser anexadas ao contexto por CAMINHO em vez de base64.
//
// Por que caminho e não base64: base64 num campo de texto (prompt ou
// TOOL_RESULT) é o jeito mais caro possível de mandar imagem — um print de 1MB
// vira ~1,4 milhão de chars, estoura qualquer contexto e ainda assim o modelo
// não "vê" nada, porque visão não entra por texto. Caminho custa ~80 chars e o
// CLI (Claude, Copilot) abre a imagem no canal de visão de verdade.
//
// Fica numa pasta do app, não dentro do projeto do usuário: repositório dele
// não é lugar de arquivo temporário nosso.

const fs = require('fs');
const os = require('os');
const path = require('path');

const DIR = path.join(os.homedir(), '.config', 'helper-node', 'pasted-images');
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

const MIME_EXT = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/jpg': '.jpg',
  'image/gif': '.gif',
  'image/webp': '.webp',
  'image/bmp': '.bmp',
};

function ensureDir() {
  if (!fs.existsSync(DIR)) fs.mkdirSync(DIR, { recursive: true });
  return DIR;
}

function getDir() { return DIR; }

// Um caminho é "nosso" se está dentro da pasta gerenciada — usado pra saber
// quais anexos podem ser apagados sem dó (os do usuário nunca são tocados).
function isManagedPath(p) {
  if (!p) return false;
  const rel = path.relative(DIR, path.resolve(p));
  return !!rel && !rel.startsWith('..') && !path.isAbsolute(rel);
}

function timestampName(prefix, ext) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 19);
  return `${prefix}-${stamp}-${Math.random().toString(36).slice(2, 6)}${ext}`;
}

// Aceita data URL ("data:image/png;base64,....") ou base64 puro.
// Devolve { path, bytes, ext } ou lança.
function saveBase64(base64Image, prefix = 'paste') {
  if (!base64Image || typeof base64Image !== 'string') throw new Error('imagem vazia');

  const match = base64Image.match(/^data:(image\/[a-z+]+);base64,/i);
  const ext = match ? (MIME_EXT[match[1].toLowerCase()] || '.png') : '.png';
  const raw = base64Image.replace(/^data:image\/[a-z+]+;base64,/i, '');

  const buf = Buffer.from(raw, 'base64');
  // Só barra dado realmente vazio/corrompido: o menor PNG válido tem ~67 bytes
  // (assinatura + IHDR + IDAT + IEND), então um piso alto rejeitaria recorte
  // legítimo de poucos pixels.
  if (buf.length < 32) throw new Error('imagem muito pequena/corrompida');

  ensureDir();
  const target = path.join(DIR, timestampName(prefix, ext));
  fs.writeFileSync(target, buf);
  return { path: target, bytes: buf.length, ext };
}

function saveBuffer(buf, prefix = 'shot', ext = '.png') {
  if (!buf || !buf.length) throw new Error('buffer vazio');
  ensureDir();
  const target = path.join(DIR, timestampName(prefix, ext));
  fs.writeFileSync(target, buf);
  return { path: target, bytes: buf.length, ext };
}

// Apaga imagens velhas. `keep` protege as que ainda estão anexadas no
// workspace — sem isso, um anexo de uma semana atrás sumiria debaixo da IA
// no meio de uma conversa.
function purgeOld(keepPaths = [], maxAgeMs = MAX_AGE_MS) {
  let removed = 0;
  try {
    if (!fs.existsSync(DIR)) return 0;
    const keep = new Set(keepPaths.map(p => path.resolve(p)));
    const cutoff = Date.now() - maxAgeMs;
    for (const name of fs.readdirSync(DIR)) {
      const full = path.join(DIR, name);
      try {
        if (keep.has(path.resolve(full))) continue;
        if (fs.statSync(full).mtimeMs >= cutoff) continue;
        fs.unlinkSync(full);
        removed++;
      } catch (_) {}
    }
  } catch (e) {
    console.warn('[imageAttachments] purge falhou:', e.message);
  }
  if (removed) console.log(`[imageAttachments] ${removed} imagem(ns) antiga(s) removida(s).`);
  return removed;
}

function readAsBase64(p) {
  const buf = fs.readFileSync(p);
  const ext = path.extname(p).toLowerCase();
  const mime = Object.keys(MIME_EXT).find(m => MIME_EXT[m] === ext) || 'image/png';
  return `data:${mime};base64,${buf.toString('base64')}`;
}

module.exports = {
  getDir, ensureDir, isManagedPath, saveBase64, saveBuffer, purgeOld, readAsBase64,
  DIR, MAX_AGE_MS,
};
