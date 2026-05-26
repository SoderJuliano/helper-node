// services/helperTools/tools/runShellAdvanced.js
// Executa qualquer comando shell — SEMPRE pede confirmação visual.
// Use pra comandos fora da whitelist do runCommand (sudo, scripts customizados,
// pipelines complexos).

const { spawn } = require("child_process");
const path = require("path");
const os = require("os");
const workspace = require("../../workspace");

const DEFAULT_TIMEOUT_MS = 60000;
const MAX_OUTPUT_BYTES = 64 * 1024;
const MAX_TIMEOUT_MS = 300000; // 5 min

// Bloqueia comandos perigosos mesmo COM confirmação. Forks/bombs, rm em /,
// reformat, dd em disco raw, etc. Se o user quer mesmo, faz no terminal.
const HARD_DENY_PATTERNS = [
  /\brm\s+-rf\s+\/(\s|$)/,           // rm -rf /
  /\brm\s+-rf\s+\/\*/,                // rm -rf /*
  /\bmkfs\.[a-z0-9]+\b/,              // mkfs.*
  /\bdd\s+if=.*of=\/dev\//,           // dd if=... of=/dev/...
  /:\(\)\{.*:\|:&\};:/,               // fork bomb
  /\b>\s*\/dev\/sd[a-z]\b/,           // > /dev/sda
  /\bshutdown\s+-h\b/,                // use systemPowerAction
  /\binit\s+0\b/,
];

let _confirmer = null;
function setConfirmer(fn) { _confirmer = fn; }

function expandHome(p) {
  if (!p) return p;
  if (p === "~" || p.startsWith("~/")) return path.join(os.homedir(), p.slice(2));
  return p;
}

function isDenied(cmd) {
  for (const re of HARD_DENY_PATTERNS) {
    if (re.test(cmd)) return re.source;
  }
  return null;
}

function runShell(command, opts) {
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let truncated = false;
    let killed = false;

    const child = spawn("bash", ["-lc", command], {
      cwd: opts.cwd,
      env: { ...process.env },
      stdio: ["ignore", "pipe", "pipe"],
    });

    const timer = setTimeout(() => {
      killed = true;
      try { child.kill("SIGKILL"); } catch (_) {}
    }, opts.timeoutMs);

    child.stdout.on("data", (chunk) => {
      if (stdout.length < MAX_OUTPUT_BYTES) {
        stdout += chunk.toString("utf8");
        if (stdout.length > MAX_OUTPUT_BYTES) {
          stdout = stdout.slice(0, MAX_OUTPUT_BYTES) + "\n…[truncated]";
          truncated = true;
        }
      }
    });
    child.stderr.on("data", (chunk) => {
      if (stderr.length < MAX_OUTPUT_BYTES) {
        stderr += chunk.toString("utf8");
        if (stderr.length > MAX_OUTPUT_BYTES) {
          stderr = stderr.slice(0, MAX_OUTPUT_BYTES) + "\n…[truncated]";
          truncated = true;
        }
      }
    });

    child.on("error", (err) => {
      clearTimeout(timer);
      resolve({ ok: false, error: `Falha ao executar: ${err.message}`, stdout, stderr });
    });

    child.on("close", (code) => {
      clearTimeout(timer);
      const ok = code === 0 && !killed;
      resolve({
        ok,
        result: {
          exitCode: killed ? -1 : code,
          killed,
          stdout: stdout.trim(),
          stderr: stderr.trim(),
          truncated,
          cmd: command,
        },
        ...(ok ? {} : { error: killed ? "Timeout: comando excedeu o limite" : `Exit code ${code}` }),
      });
    });
  });
}

module.exports = {
  name: "runShellAdvanced",
  description:
    "Executa um comando shell arbitrário (bash -lc). SEMPRE pede confirmação visual ao usuário. Use SOMENTE quando runCommand não cobrir (pipelines complexos, scripts customizados, sudo). NUNCA use pra coisas perigosas (rm -rf /, mkfs, dd em disco raw — bloqueado).",
  schema: {
    type: "object",
    properties: {
      command: { type: "string", description: "Comando shell completo. Ex: 'find . -name \"*.log\" | xargs gzip'." },
      cwd: { type: "string", description: "(Opcional) Diretório de trabalho. Default: workspace[0] ou $HOME." },
      timeoutMs: { type: "number", description: "(Opcional) Timeout em ms (max 300000=5min). Default 60000." },
      reason: { type: "string", description: "(Opcional) Motivo curto exibido na confirmação." },
    },
    required: ["command"],
    additionalProperties: false,
  },
  mutates: true,
  setConfirmer,

  async run(args, ctx) {
    const command = String(args && args.command || "").trim();
    if (!command) return { ok: false, error: "command obrigatório" };

    const denied = isDenied(command);
    if (denied) {
      return { ok: false, error: `Comando bloqueado por política de segurança (match: ${denied}). Execute manualmente no terminal se realmente quiser.` };
    }

    let cwd = args && args.cwd ? path.resolve(expandHome(args.cwd)) : null;
    if (!cwd) {
      try {
        const list = workspace.list();
        if (list && list.length) cwd = list[0].path;
      } catch (_) {}
      if (!cwd) cwd = os.homedir();
    }

    let confirmed = false;
    if (ctx && ctx.force) {
      console.log(`[runShellAdvanced] force=true → ignorando confirmação visual para: ${command}`);
      confirmed = true;
    } else {
      if (typeof _confirmer !== "function") {
        return { ok: false, error: "confirmer não registrado" };
      }
      confirmed = await _confirmer({
        title: "Confirmação necessária",
        message: "A IA quer executar este comando shell:",
        detail: `${command}\n\ncwd: ${cwd}\n${args.reason || ""}`,
        confirmText: "Executar",
        cancelText: "Cancelar",
        timeoutMs: 30000,
      });
    }

    if (!confirmed) return { ok: true, result: { executed: false, reason: "cancelado pelo usuário" } };

    const timeoutMs = Math.min(Math.max(Number(args && args.timeoutMs) || DEFAULT_TIMEOUT_MS, 1000), MAX_TIMEOUT_MS);
    console.log(`[runShellAdvanced] ${command} (cwd=${cwd}, timeout=${timeoutMs}ms)`);
    return await runShell(command, { cwd, timeoutMs });
  },
};
