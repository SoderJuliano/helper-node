// services/helperTools/tools/findFiles.js
// Localiza arquivos por nome/glob. Usa `fd` se disponível, senão `find`.

const { exec } = require("child_process");
const { promisify } = require("util");
const policy = require("../policy");

const execP = promisify(exec);

async function _hasFd() {
  try {
    await execP("command -v fd");
    return true;
  } catch {
    try {
      await execP("command -v fdfind");
      return "fdfind"; // debian/ubuntu
    } catch {
      return false;
    }
  }
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

    const fdBin = await _hasFd();
    let cmd;
    if (fdBin) {
      const bin = fdBin === true ? "fd" : "fdfind";
      cmd = `${bin} --max-depth ${depth} --type f -g '${glob.replace(
        /'/g,
        "'\\''"
      )}' '${root.replace(/'/g, "'\\''")}'`;
    } else {
      cmd = `find '${root.replace(/'/g, "'\\''")}' -maxdepth ${depth} -type f -name '${glob.replace(/'/g, "'\\''")}'`;
    }

    try {
      const { stdout } = await execP(cmd, { maxBuffer: 1024 * 1024 });
      const files = stdout.split("\n").filter(Boolean).slice(0, max);
      return {
        ok: true,
        result: {
          glob,
          root,
          count: files.length,
          truncated: files.length >= max,
          files,
          engine: fdBin ? "fd" : "find",
        },
      };
    } catch (e) {
      // find pode imprimir warnings em stderr mas ainda assim ter stdout válido
      if (e.stdout) {
        const files = e.stdout.split("\n").filter(Boolean).slice(0, max);
        return { ok: true, result: { glob, root, count: files.length, files, engine: "find" } };
      }
      return { ok: false, error: e.message };
    }
  },
};
