// services/helperTools/tools/readFile.js
const fs = require("fs/promises");
const policy = require("../policy");
const { redact } = require("../secretRedactor");

module.exports = {
  name: "readFile",
  description:
    "Lê o conteúdo inteiro de um arquivo de texto (até maxLinesForFullRead linhas, default 500). Segredos detectados (chaves, tokens, senhas) são substituídos por [REDACTED] antes de retornar. Para arquivos maiores, use readFileChunk.",
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
        return { ok: false, error: "É um diretório. Use listDir." };
      }
      const maxBytes = cfg && cfg.maxFileSizeForRead ? cfg.maxFileSizeForRead : 2 * 1024 * 1024;
      if (s.size > maxBytes) {
        return {
          ok: false,
          error: `Arquivo muito grande (${(s.size / 1024 / 1024).toFixed(2)} MB > ${(maxBytes / 1024 / 1024).toFixed(2)} MB). Use readFileChunk.`,
        };
      }
      const raw = await fs.readFile(abs, "utf-8");
      const lines = raw.split("\n");
      const maxLines = (cfg && cfg.maxLinesForFullRead) || 500;
      const truncated = lines.length > maxLines;
      const content = truncated ? lines.slice(0, maxLines).join("\n") : raw;

      const redacted = redact(content);

      return {
        ok: true,
        result: {
          path: abs,
          totalLines: lines.length,
          returnedLines: truncated ? maxLines : lines.length,
          truncated,
          content: redacted.text,
          secretsRedacted: redacted.redactedCount,
        },
        meta: {
          bytes: s.size,
          redactedHits: redacted.hits,
        },
      };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  },
};
