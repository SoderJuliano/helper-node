// services/helperTools/policy.js
// Validações de segurança: que caminhos a IA pode ler/escrever,
// quais extensões/nomes de arquivo são permitidos pra WRITE, etc.

const path = require("path");
const fs = require("fs");
const os = require("os");
const {
  ALLOWED_EXTENSIONS_FOR_WRITE,
  NAMED_FILES_ALLOWED_FOR_WRITE,
} = require("./config");

function expandHome(p) {
  if (!p) return p;
  if (p === "~" || p.startsWith("~/")) {
    return path.join(os.homedir(), p.slice(2));
  }
  if (p.startsWith("$HOME")) {
    return path.join(os.homedir(), p.slice(5));
  }
  return p;
}

function resolveAbs(p) {
  const expanded = expandHome(p);
  return path.resolve(expanded);
}

function isInsideAny(abs, roots) {
  return roots.some((root) => {
    const r = path.resolve(expandHome(root));
    const rel = path.relative(r, abs);
    return rel && !rel.startsWith("..") && !path.isAbsolute(rel);
  });
}

function isDeniedPath(abs, deniedFragments, deniedSuffixes) {
  const lower = abs.toLowerCase();
  for (const frag of deniedFragments) {
    if (lower.includes(frag.toLowerCase())) return frag;
  }
  for (const suf of deniedSuffixes) {
    if (lower.endsWith(suf.toLowerCase())) return suf;
  }
  return null;
}

function isAllowedForWrite(abs, allowEnvFiles) {
  const base = path.basename(abs);
  const ext = path.extname(abs).toLowerCase();

  // .env (sem .example) só com flag
  if (base === ".env" || /^\.env\./.test(base)) {
    if (base === ".env.example") return true;
    return !!allowEnvFiles;
  }

  if (NAMED_FILES_ALLOWED_FOR_WRITE.includes(base)) return true;
  if (ALLOWED_EXTENSIONS_FOR_WRITE.includes(ext)) return true;
  // Arquivos começados com . que estão na NAMED whitelist
  if (NAMED_FILES_ALLOWED_FOR_WRITE.includes(base.toLowerCase())) return true;
  return false;
}

/**
 * Valida operação de READ.
 * @returns { ok: true, abs } | { ok: false, error }
 */
function checkRead(rawPath, cfg) {
  if (!rawPath || typeof rawPath !== "string") {
    return { ok: false, error: "Caminho inválido." };
  }
  const abs = resolveAbs(rawPath);
  const denied = isDeniedPath(abs, cfg.deniedPathFragments, cfg.deniedFileSuffixes);
  if (denied) {
    return {
      ok: false,
      error: `Caminho bloqueado por política (match: "${denied}").`,
    };
  }
  // .env real precisa de flag
  const base = path.basename(abs);
  if ((base === ".env" || /^\.env\.(?!example)/.test(base)) && !cfg.allowEnvFiles) {
    return {
      ok: false,
      error:
        ".env real bloqueado. Habilite `allowEnvFiles` nas configs se necessário.",
    };
  }
  return { ok: true, abs };
}

/**
 * Valida operação de WRITE.
 * Mais restritivo: sandbox por raiz + extensão/nome permitido.
 */
function checkWrite(rawPath, cfg) {
  const read = checkRead(rawPath, cfg);
  if (!read.ok) return read;
  const { abs } = read;

  if (!isInsideAny(abs, cfg.writeRoots)) {
    return {
      ok: false,
      error: `Fora do sandbox de escrita (${cfg.writeRoots.join(", ")}).`,
    };
  }
  if (!isAllowedForWrite(abs, cfg.allowEnvFiles)) {
    return {
      ok: false,
      error: `Tipo de arquivo não permitido para escrita: ${path.basename(abs)}.`,
    };
  }
  return { ok: true, abs };
}

function fileExists(abs) {
  try {
    return fs.statSync(abs).isFile();
  } catch (_) {
    return false;
  }
}

module.exports = {
  expandHome,
  resolveAbs,
  isInsideAny,
  isDeniedPath,
  isAllowedForWrite,
  checkRead,
  checkWrite,
  fileExists,
};
