// services/helperTools/tools/fileInfo.js
const fs = require("fs/promises");
const path = require("path");
const { exec } = require("child_process");
const { promisify } = require("util");
const policy = require("../policy");

const execP = promisify(exec);

module.exports = {
  name: "fileInfo",
  description:
    "Retorna metadados de um arquivo: tamanho, número de linhas, tipo (texto/binário), mtime. Use ANTES de readFile para decidir se vale ler tudo (max 500 linhas) ou usar readFileChunk.",
  schema: {
    type: "object",
    properties: {
      path: { type: "string", description: "Caminho do arquivo." },
    },
    required: ["path"],
  },
  mutates: false,

  async run(args, ctx) {
    const cfg = ctx && ctx.cfg;
    const check = policy.checkRead(args.path, cfg);
    if (!check.ok) return check;
    const abs = check.abs;
    try {
      const s = await fs.stat(abs);
      if (s.isDirectory()) {
        return { ok: false, error: "É um diretório, não um arquivo. Use listDir." };
      }
      const sizeBytes = s.size;
      let lines = null;
      let isText = null;
      if (sizeBytes < 5 * 1024 * 1024) {
        try {
          const { stdout } = await execP(`wc -l < '${abs.replace(/'/g, "'\\''")}'`);
          lines = parseInt(stdout.trim(), 10) || 0;
        } catch (_) {
          lines = null;
        }
        // heurística: lê primeiros 4KB, se tiver byte 0 → binário
        try {
          const buf = Buffer.alloc(Math.min(4096, sizeBytes));
          const fh = await fs.open(abs, "r");
          await fh.read(buf, 0, buf.length, 0);
          await fh.close();
          isText = !buf.includes(0);
        } catch (_) {
          isText = null;
        }
      }
      return {
        ok: true,
        result: {
          path: abs,
          name: path.basename(abs),
          sizeBytes,
          sizeHuman: _human(sizeBytes),
          lines,
          isText,
          mtime: s.mtime.toISOString(),
          extension: path.extname(abs),
          // Sugere readFile ou readFileChunk
          suggestion:
            lines == null
              ? "lines desconhecido"
              : lines <= 500
              ? "readFile (cabe inteiro)"
              : "readFileChunk (arquivo grande, leia em pedaços)",
        },
      };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  },
};

function _human(b) {
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / 1024 / 1024).toFixed(2)} MB`;
}
