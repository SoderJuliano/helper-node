// services/helperTools/tools/findFiles.js
// Localiza arquivos por nome/glob, 100% em Node — sem shell.
//
// A versão anterior montava `fd` ou `find` e rodava via exec, e quebrava no
// Windows por três motivos, do mesmo jeito que o searchInFiles quebrava:
//   1. A detecção era `command -v fd` — builtin POSIX que não existe no cmd.exe.
//   2. O fallback chamava `find`, mas no Windows `find.exe` é um comando
//      COMPLETAMENTE diferente (procura texto DENTRO de arquivos, não arquivos
//      por nome) — os argumentos -maxdepth/-type/-name nem são reconhecidos.
//   3. O comando era montado com aspas SIMPLES, que no cmd.exe são caracteres
//      literais e não delimitadores.
//
// Sem essa ferramenta funcionando, o agente não consegue nem se localizar no
// projeto: passa a reler arquivos inteiros em pedaços e anda em círculos.

const fs = require("fs");
const path = require("path");
const policy = require("../policy");

const SKIP_DIRS = new Set([
  ".git", "node_modules", "target", "build", ".idea", "__pycache__", ".venv", "dist",
]);

// "*.ts" → /^.*\.ts$/i ; comparado contra o basename do arquivo.
function globToRegExp(glob) {
  const escaped = String(glob)
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, ".*")
    .replace(/\?/g, ".");
  return new RegExp(`^${escaped}$`, "i");
}

module.exports = {
  name: "findFiles",
  description:
    "Encontra arquivos por nome/glob. Ex: findFiles({glob: 'package.json', path: '~/projeto'}) → caminhos absolutos. Útil pra localizar configs antes de readFile.",
  schema: {
    type: "object",
    properties: {
      glob: { type: "string", description: "Padrão (ex: '*.ts', 'config.*', 'Dockerfile')." },
      path: { type: "string", description: "Raiz da busca." },
      maxResults: { type: "number", default: 50 },
      maxDepth: { type: "number", default: 6 },
    },
    required: ["glob", "path"],
  },
  mutates: false,

  async run(args, ctx) {
    const cfg = ctx && ctx.cfg;
    const check = policy.checkRead(args.path, cfg);
    if (!check.ok) return check;
    const root = check.abs;
    const glob = String(args.glob || "");
    if (!glob) return { ok: false, error: "glob vazio" };
    const max = Math.max(1, Math.min(200, Number(args.maxResults) || 50));
    const depth = Math.max(1, Math.min(10, Number(args.maxDepth) || 6));
    const re = globToRegExp(glob);

    const files = [];
    // [diretório, profundidade] — profundidade relativa à raiz, como o -maxdepth.
    const stack = [[root, 0]];
    try {
      const st = fs.statSync(root);
      if (st.isFile()) {
        return {
          ok: true,
          result: { glob, root, count: re.test(path.basename(root)) ? 1 : 0, truncated: false, files: re.test(path.basename(root)) ? [root] : [], engine: "node" },
        };
      }
    } catch (e) {
      return { ok: false, error: `Caminho inacessível: ${e.message}` };
    }

    while (stack.length && files.length < max) {
      const [dir, d] = stack.pop();
      let entries;
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch (_) {
        continue; // sem permissão / sumiu no meio: ignora e segue
      }
      for (const entry of entries) {
        if (files.length >= max) break;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (SKIP_DIRS.has(entry.name)) continue;
          if (d + 1 <= depth) stack.push([full, d + 1]);
        } else if (entry.isFile() && re.test(entry.name)) {
          files.push(full);
        }
      }
    }

    files.sort((a, b) => a.localeCompare(b));
    return {
      ok: true,
      result: {
        glob,
        root,
        count: files.length,
        truncated: files.length >= max,
        files,
        engine: "node",
      },
    };
  },
};
