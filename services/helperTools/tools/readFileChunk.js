// services/helperTools/tools/readFileChunk.js
const fs = require("fs/promises");
const policy = require("../policy");
const { redact } = require("../secretRedactor");

module.exports = {
  name: "readFileChunk",
  description:
    "Lê um intervalo de linhas de um arquivo grande. Use após fileInfo identificar arquivo > 500 linhas. Retorna content com numeração de linha. Segredos são redactados.",
  schema: {
    type: "object",
    properties: {
      path: { type: "string" },
      lineStart: { type: "number", description: "Linha inicial (1-based, inclusive)." },
      lineEnd: { type: "number", description: "Linha final (1-based, inclusive). Max 500 linhas por chunk." },
    },
    required: ["path", "lineStart", "lineEnd"],
  },
  mutates: false,

  async run(args, ctx) {
    const cfg = ctx && ctx.cfg;
    const check = policy.checkRead(args.path, cfg);
    if (!check.ok) return check;
    const abs = check.abs;
    const lineStart = Math.max(1, Number(args.lineStart) || 1);
    let lineEnd = Math.max(lineStart, Number(args.lineEnd) || lineStart);
    if (lineEnd - lineStart > 500) lineEnd = lineStart + 500;

    try {
      const raw = await fs.readFile(abs, "utf-8");
      const lines = raw.split("\n");
      const slice = lines.slice(lineStart - 1, lineEnd);
      const numbered = slice
        .map((l, i) => `${String(lineStart + i).padStart(5, " ")}  ${l}`)
        .join("\n");
      const redacted = redact(numbered);
      return {
        ok: true,
        result: {
          path: abs,
          totalLines: lines.length,
          lineStart,
          lineEnd: Math.min(lineEnd, lines.length),
          content: redacted.text,
          secretsRedacted: redacted.redactedCount,
        },
      };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  },
};
