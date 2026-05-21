// services/helperTools/tools/runCommand.js
// Executa comandos do sistema validados contra a whitelist SAFE_COMMANDS.
// Roda SEM confirmação visual — a whitelist garante segurança.
// Use pra: git status/commit/push/add, npm/mvn version, ls, cat, etc.
//
// Comandos fora da whitelist precisam usar runShellAdvanced (com confirmação).

const { spawn } = require("child_process");
const path = require("path");
const os = require("os");
const { SAFE_COMMANDS } = require("../config");
const workspace = require("../../workspace");

const DEFAULT_TIMEOUT_MS = 30000;
const MAX_OUTPUT_BYTES = 64 * 1024; // 64KB de stdout/stderr cada

function expandHome(p) {
  if (!p) return p;
  if (p === "~" || p.startsWith("~/")) return path.join(os.homedir(), p.slice(2));
  return p;
}

function _argAllowed(cmd, arg) {
  const spec = SAFE_COMMANDS[cmd];
  if (!spec) return false;
  if (spec === "*") return true;
  if (!Array.isArray(spec)) return false;
  // Flag/subcommand whitelisted? Aceita qualquer argumento que comece com
  // qualquer item da whitelist (ex: spec=["status"] aceita "status" e "status -s")
  for (const allowed of spec) {
    if (arg === allowed) return true;
    if (allowed.startsWith("-") && arg === allowed) return true;
  }
  // Tambem aceita argumentos "valor" tipo "-m" "mensagem do commit" — strings
  // que nao sao flags (nao comecam com -) sao permitidas DESDE QUE pelo menos
  // um item da whitelist seja prefixo ou subcomando casado anteriormente.
  // Pra simplificar: se a whitelist contem o primeiro arg (subcomando), libera
  // os subsequentes. Validacao final fica em validateArgs.
  return false;
}

function validateArgs(cmd, args) {
  const spec = SAFE_COMMANDS[cmd];
  if (!spec) return { ok: false, error: `Comando "${cmd}" não está na whitelist. Use runShellAdvanced (exige confirmação).` };
  if (spec === "*") return { ok: true };
  if (!Array.isArray(spec)) return { ok: false, error: `whitelist mal configurada para "${cmd}"` };
  if (!args.length) return { ok: true };

  // O PRIMEIRO arg precisa estar na whitelist (subcomando ou flag).
  // Depois disso, libera os args seguintes (valores de flag, paths, mensagens).
  const first = args[0];
  const firstOk = spec.includes(first) || (first.startsWith("-") && spec.includes(first));
  if (!firstOk) {
    return {
      ok: false,
      error: `Subcomando/flag "${first}" não permitido para "${cmd}". Permitidos: ${spec.join(", ")}.`,
    };
  }
  return { ok: true };
}

function runSpawn(cmd, args, opts) {
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let truncated = false;
    let killed = false;

    const child = spawn(cmd, args, {
      cwd: opts.cwd,
      env: { ...process.env },
      stdio: ["ignore", "pipe", "pipe"],
    });

    const timer = setTimeout(() => {
      killed = true;
      try { child.kill("SIGKILL"); } catch (_) {}
    }, opts.timeoutMs || DEFAULT_TIMEOUT_MS);

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
          cmd: `${cmd} ${args.join(" ")}`.trim(),
        },
        ...(ok ? {} : { error: killed ? "Timeout: comando excedeu o limite" : `Exit code ${code}` }),
      });
    });
  });
}

module.exports = {
  name: "runCommand",
  description:
    "Executa um comando do sistema validado pela whitelist de segurança (git, npm, mvn, ls, cat, etc). Roda SEM confirmação — a whitelist garante segurança. Use pra: git status/commit/push, npm/mvn install, ler info do sistema. Para comandos fora da whitelist, use runShellAdvanced.",
  schema: {
    type: "object",
    properties: {
      cmd: { type: "string", description: "Nome do comando (ex: 'git', 'npm', 'ls'). Sem path completo." },
      args: {
        type: "array",
        items: { type: "string" },
        description: "Argumentos do comando. O primeiro arg deve estar na whitelist (ex: 'status' pra git).",
      },
      cwd: {
        type: "string",
        description: "(Opcional) Diretório de trabalho. Deve estar dentro de um anexo do workspace. Default: workspace[0] ou $HOME.",
      },
      timeoutMs: {
        type: "number",
        description: "(Opcional) Timeout em ms. Default 30000 (30s). Máx 120000.",
      },
    },
    required: ["cmd"],
    additionalProperties: false,
  },
  mutates: false, // whitelist é segura

  async run(args) {
    const cmd = (args && args.cmd || "").trim();
    const cmdArgs = Array.isArray(args && args.args) ? args.args.map(String) : [];
    if (!cmd) return { ok: false, error: "cmd obrigatório" };
    // Bloqueia paths absolutos e traversal, mas permite "./mvnw" e "./gradlew"
    // (wrappers de build que ficam na raiz do projeto e estao na whitelist).
    if (cmd.includes("\\") || cmd.includes("..") || cmd.startsWith("/")) {
      return { ok: false, error: "Use apenas o nome do comando, sem path absoluto." };
    }
    if (cmd.includes("/") && !cmd.startsWith("./")) {
      return { ok: false, error: "Caminho relativo inválido. Use 'cmd' ou './wrapper'." };
    }

    const v = validateArgs(cmd, cmdArgs);
    if (!v.ok) return v;

    // CWD: precisa estar no workspace OU em $HOME (fallback seguro).
    let cwd = args && args.cwd ? path.resolve(expandHome(args.cwd)) : null;
    if (!cwd) {
      try {
        const list = workspace.list();
        if (list && list.length) cwd = list[0].path;
      } catch (_) {}
      if (!cwd) cwd = os.homedir();
    } else {
      // Valida CWD contra workspace
      let inside = false;
      try { inside = workspace.isPathAllowed(cwd); } catch (_) {}
      if (!inside && !cwd.startsWith(os.homedir())) {
        return { ok: false, error: `cwd "${cwd}" fora do workspace e fora de $HOME.` };
      }
    }

    const timeoutMs = Math.min(Math.max(Number(args && args.timeoutMs) || DEFAULT_TIMEOUT_MS, 1000), 120000);
    console.log(`[runCommand] ${cmd} ${cmdArgs.join(" ")} (cwd=${cwd}, timeout=${timeoutMs}ms)`);
    const result = await runSpawn(cmd, cmdArgs, { cwd, timeoutMs });
    return result;
  },
};
