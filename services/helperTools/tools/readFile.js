// services/helperTools/tools/readFile.js
const fs = require("fs/promises");
const policy = require("../policy");
const { redact } = require("../secretRedactor");

module.exports = {
  name: "readFile",
  description:
    "Lê um arquivo de texto inteiro (até ~1000 linhas). O resultado é truncado se for muito grande. Segredos (chaves, tokens, senhas) viram [REDACTED]. ARQUIVO GRANDE: não leia em fatias sequenciais às cegas — use searchInFiles pra achar a linha do que você procura e readFileChunk em volta dela. Sai em 1 rodada em vez de 8.",
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
      const maxLines = (cfg && cfg.maxLinesForFullRead) || 1000;
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
          truncatedNote: truncated ? `Arquivo tem ${lines.length} linhas. Retornadas apenas as primeiras ${maxLines}. Para buscar algo específico no arquivo inteiro, use searchInFiles. Para ler outro trecho, use readFileChunk com lineStart/lineEnd.` : undefined,
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
