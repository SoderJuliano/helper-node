// services/helperTools/tools/searchInFiles.js
// Busca de padrão em arquivos. Prefere ripgrep (rg) se disponível,
// senão cai pra grep -rn.

const { exec } = require("child_process");
const { promisify } = require("util");
const policy = require("../policy");

const execP = promisify(exec);

async function _hasRipgrep() {
  try {
    await execP("command -v rg");
    return true;
  } catch (_) {
    return false;
  }
}

module.exports = {
  name: "searchInFiles",
  description:
    "Busca um padrão (texto literal ou regex) em arquivos de um diretório. Retorna até 50 matches com caminho:linha:trecho. Use antes de readFile pra localizar onde mexer em projetos grandes.",
  schema: {
    type: "object",
    properties: {
      pattern: { type: "string", description: "Texto ou regex a buscar." },
      path: { type: "string", description: "Diretório raiz da busca." },
      regex: { type: "boolean", description: "Tratar pattern como regex (default false).", default: false },
      caseSensitive: { type: "boolean", description: "Default false.", default: false },
      maxResults: { type: "number", description: "Max 50.", default: 50 },
      filePattern: { type: "string", description: "Glob de arquivos (ex: *.js). Opcional." },
    },
    required: ["pattern", "path"],
  },
  mutates: false,

  async run(args, ctx) {
    const cfg = ctx && ctx.cfg;
    const check = policy.checkRead(args.path, cfg);
    if (!check.ok) return check;

    const root = check.abs;
    const pattern = String(args.pattern || "");
    if (!pattern) return { ok: false, error: "pattern vazio" };

    const isRegex = !!args.regex;
    const cs = !!args.caseSensitive;
    const max = Math.max(1, Math.min(50, Number(args.maxResults) || 50));
    const filePat = args.filePattern;

    const hasRg = await _hasRipgrep();
    const matches = [];

    if (hasRg) {
      const flags = [
        "--no-heading",
        "-n",
        cs ? "" : "-i",
        isRegex ? "" : "-F",
        `--max-count=${max}`,
        `--max-columns=200`,
        filePat ? `-g '${filePat.replace(/'/g, "'\\''")}'` : "",
      ]
        .filter(Boolean)
        .join(" ");
      const cmd = `rg ${flags} -- '${pattern.replace(/'/g, "'\\''")}' '${root.replace(/'/g, "'\\''")}'`;
      try {
        const { stdout } = await execP(cmd, { maxBuffer: 1024 * 1024 });
        for (const line of stdout.split("\n")) {
          if (!line) continue;
          const m = line.match(/^([^:]+):(\d+):(.*)$/);
          if (m) {
            matches.push({ file: m[1], line: Number(m[2]), text: m[3].slice(0, 200) });
            if (matches.length >= max) break;
          }
        }
      } catch (e) {
        // exit code 1 = sem matches → não é erro
        if (e.code !== 1) return { ok: false, error: e.message };
      }
    } else {
      // Fallback grep
      const grepFlags = [
        "-rn",
        cs ? "" : "-i",
        isRegex ? "-E" : "-F",
        filePat ? `--include='${filePat.replace(/'/g, "'\\''")}'` : "",
      ]
        .filter(Boolean)
        .join(" ");
      const cmd = `grep ${grepFlags} -- '${pattern.replace(/'/g, "'\\''")}' '${root.replace(/'/g, "'\\''")}'`;
      try {
        const { stdout } = await execP(cmd, { maxBuffer: 1024 * 1024 });
        for (const line of stdout.split("\n")) {
          if (!line) continue;
          const m = line.match(/^([^:]+):(\d+):(.*)$/);
          if (m) {
            matches.push({ file: m[1], line: Number(m[2]), text: m[3].slice(0, 200) });
            if (matches.length >= max) break;
          }
        }
      } catch (e) {
        if (e.code !== 1) return { ok: false, error: e.message };
      }
    }

    return {
      ok: true,
      result: {
        pattern,
        root,
        matchCount: matches.length,
        truncated: matches.length >= max,
        matches,
        engine: hasRg ? "ripgrep" : "grep",
      },
    };
  },
};
