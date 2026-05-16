// services/helperTools/audit.js
// Log de auditoria local de TODA operação executada por tool.
// Append-only, formato simples por linha (timestamp + tipo + json).

const fs = require("fs");
const path = require("path");

let logPath = null;

function init(p) {
  logPath = p;
  try {
    fs.mkdirSync(path.dirname(logPath), { recursive: true });
  } catch (_) {}
}

function _line(kind, payload) {
  const ts = new Date().toISOString();
  let body;
  try {
    body = JSON.stringify(payload);
  } catch (_) {
    body = String(payload);
  }
  return `${ts} [${kind}] ${body}\n`;
}

function log(kind, payload) {
  if (!logPath) return;
  try {
    fs.appendFile(logPath, _line(kind, payload), () => {});
  } catch (_) {}
}

function logToolCall(toolName, args, result) {
  // result: { ok, error?, redactedCount?, bytes?, ... }
  log("TOOL", {
    tool: toolName,
    args: _safeArgs(args),
    ok: !!result.ok,
    error: result.error || null,
    meta: result.meta || null,
  });
}

function logShell(cmd, status, exitCode) {
  // Mascara senha em comandos sudo. Nunca registra a string da senha.
  const masked = cmd.replace(/(\bsudo\s+-S\s+)/g, "$1[PASSWORD REDACTED via stdin] ");
  log("SHELL", { cmd: masked, status, exitCode });
}

function logConfirmation(action, decision, source) {
  log("CONFIRM", { action, decision, source });
}

function _safeArgs(args) {
  // Trunca strings muito longas (não queremos logar arquivo inteiro)
  if (!args || typeof args !== "object") return args;
  const out = {};
  for (const [k, v] of Object.entries(args)) {
    if (typeof v === "string" && v.length > 200) {
      out[k] = v.slice(0, 200) + `…[+${v.length - 200} chars]`;
    } else {
      out[k] = v;
    }
  }
  return out;
}

module.exports = { init, log, logToolCall, logShell, logConfirmation };
