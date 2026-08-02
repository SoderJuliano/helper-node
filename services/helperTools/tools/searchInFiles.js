// services/helperTools/tools/searchInFiles.js
// Busca de padrão em arquivos, 100% em Node — sem shell.
//
// A versão anterior montava `rg`/`grep` e rodava via exec. Isso quebrava
// inteiro no Windows, e o pior: quebrava EM SILÊNCIO.
//   1. A detecção do ripgrep era `command -v rg` — `command` é builtin de shell
//      POSIX, não existe no cmd.exe. Sempre caía no fallback.
//   2. O comando era montado com aspas SIMPLES ('padrao', '/caminho'), que são
//      sintaxe POSIX. No cmd.exe aspas simples são caracteres literais, então o
//      grep procurava pela string COM as aspas, num caminho COM as aspas.
//   3. O catch fazia `if (e.code !== 1)` — e "sem resultado" também é código 1.
//      Então a falha virava `{ ok: true, matchCount: 0 }`.
//
// Resultado prático: a ferramenta dizia "0 resultados" pra padrão que aparecia
// 29 vezes no arquivo. O agente ficava cego, desistia da busca, passava a reler
// arquivos inteiros em pedaços, perdia o fio e recomeçava a tarefa em círculos.
//
// Em Node não há shell, aspeamento, nem binário externo: funciona igual nos três
// sistemas e um erro de verdade aparece como erro.

const fs = require("fs");
const path = require("path");
const policy = require("../policy");

const SKIP_DIRS = new Set([
  ".git", "node_modules", "target", "build", ".idea", "__pycache__", ".venv", "dist",
]);
const MAX_FILE_BYTES = 2 * 1024 * 1024; // arquivo maior que isto é pulado
const MAX_FILES_SCANNED = 3000;

// "*.js" → /^.*\.js$/i ; usado só no nome do arquivo (basename).
function globToRegExp(glob) {
  const escaped = String(glob)
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, ".*")
    .replace(/\?/g, ".");
  return new RegExp(`^${escaped}$`, "i");
}

function looksBinary(buf) {
  const sample = buf.slice(0, Math.min(512, buf.length));
  let nul = 0;
  for (let i = 0; i < sample.length; i++) if (sample[i] === 0) nul++;
  return sample.length > 0 && nul / sample.length > 0.01;
}

function collectFiles(root, fileRe) {
  const out = [];
  let stat;
  try {
    stat = fs.statSync(root);
  } catch (e) {
    return { error: `Caminho inacessível: ${e.message}` };
  }
  if (stat.isFile()) {
    if (!fileRe || fileRe.test(path.basename(root))) out.push(root);
    return { files: out };
  }
  const stack = [root];
  while (stack.length && out.length < MAX_FILES_SCANNED) {
    const dir = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (_) {
      continue;
    }
    for (const entry of entries) {
      if (out.length >= MAX_FILES_SCANNED) break;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) stack.push(full);
      } else if (entry.isFile()) {
        if (!fileRe || fileRe.test(entry.name)) out.push(full);
      }
    }
  }
  return { files: out };
}

module.exports = {
  name: "searchInFiles",
  description:
    "Busca um padrão (texto literal ou regex) em arquivos de um diretório. Retorna até 50 matches com caminho:linha:trecho. Use antes de readFile pra localizar onde mexer em projetos grandes.",
  schema: {
    type: "object",
    properties: {
      pattern: { type: "string", description: "Texto ou regex a buscar." },
      path: { type: "string", description: "Diretório (ou arquivo) raiz da busca." },
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

    const cs = !!args.caseSensitive;
    const max = Math.max(1, Math.min(50, Number(args.maxResults) || 50));

    // Normaliza filePattern: ".js" → "*.js" (modelo costuma mandar sem o *)
    let filePat = args.filePattern;
    if (filePat && !filePat.includes("*") && filePat.startsWith(".")) {
      filePat = "*" + filePat;
    }
    const fileRe = filePat ? globToRegExp(filePat) : null;

    // Casador de linha: regex de verdade, ou busca literal (sem interpretar
    // metacaracteres — "." e "*" no padrão do usuário são literais aqui).
    let testLine;
    if (args.regex) {
      let re;
      try {
        re = new RegExp(pattern, cs ? "" : "i");
      } catch (e) {
        return { ok: false, error: `Regex inválida: ${e.message}` };
      }
      testLine = (line) => re.test(line);
    } else {
      const needle = cs ? pattern : pattern.toLowerCase();
      testLine = (line) => (cs ? line : line.toLowerCase()).includes(needle);
    }

    const collected = collectFiles(root, fileRe);
    if (collected.error) return { ok: false, error: collected.error };

    const matches = [];
    let filesScanned = 0;

    for (const file of collected.files) {
      if (matches.length >= max) break;
      let buf;
      try {
        const st = fs.statSync(file);
        if (st.size > MAX_FILE_BYTES) continue;
        buf = fs.readFileSync(file);
      } catch (_) {
        continue;
      }
      if (looksBinary(buf)) continue;
      filesScanned++;

      const lines = buf.toString("utf8").split(/\r?\n/);
      for (let i = 0; i < lines.length; i++) {
        if (matches.length >= max) break;
        if (testLine(lines[i])) {
          matches.push({ file, line: i + 1, text: lines[i].trim().slice(0, 200) });
        }
      }
    }

    return {
      ok: true,
      result: {
        pattern,
        root,
        matchCount: matches.length,
        truncated: matches.length >= max,
        filesScanned,
        matches,
        engine: "node",
      },
    };
  },
};
