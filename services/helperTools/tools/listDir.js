// services/helperTools/tools/listDir.js
const fs = require("fs/promises");
const path = require("path");
const policy = require("../policy");

module.exports = {
  name: "listDir",
  description:
    "Lista o conteúdo de um diretório. Retorna nome, tipo (file/dir/symlink), tamanho e mtime para cada entrada. Use antes de readFile quando não souber o caminho exato.",
  schema: {
    type: "object",
    properties: {
      path: { type: "string", description: "Caminho do diretório. ~ expande para home." },
      depth: { type: "number", description: "1 = só o diretório; 2 = subdirs imediatos. Max 3.", default: 1 },
      includeHidden: { type: "boolean", description: "Inclui arquivos começados com . Default false.", default: false },
    },
    required: ["path"],
  },
  mutates: false,

  async run(args, ctx) {
    const cfg = ctx && ctx.cfg;
    const rawPath = args.path;
    const depth = Math.min(3, Math.max(1, Number(args.depth) || 1));
    const includeHidden = !!args.includeHidden;

    const check = policy.checkRead(rawPath, cfg);
    if (!check.ok) return check;
    const abs = check.abs;

    try {
      const stat = await fs.stat(abs);
      if (!stat.isDirectory()) {
        return { ok: false, error: `Não é um diretório: ${abs}` };
      }
      const entries = await _walk(abs, depth, includeHidden);
      return {
        ok: true,
        result: { path: abs, entries },
        meta: { count: entries.length },
      };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  },
};

async function _walk(dir, depth, includeHidden, currentDepth = 1) {
  const out = [];
  let names;
  try {
    names = await fs.readdir(dir, { withFileTypes: true });
  } catch (e) {
    return [{ name: "<erro>", error: e.message, type: "error" }];
  }
  for (const d of names) {
    if (!includeHidden && d.name.startsWith(".")) continue;
    const full = path.join(dir, d.name);
    let s;
    try {
      s = await fs.lstat(full);
    } catch {
      continue;
    }
    const type = s.isSymbolicLink()
      ? "symlink"
      : s.isDirectory()
      ? "dir"
      : s.isFile()
      ? "file"
      : "other";
    const entry = {
      name: d.name,
      type,
      size: type === "file" ? s.size : null,
      mtime: s.mtimeMs ? new Date(s.mtimeMs).toISOString() : null,
    };
    out.push(entry);
    if (type === "dir" && currentDepth < depth) {
      const sub = await _walk(full, depth, includeHidden, currentDepth + 1);
      entry.children = sub;
    }
  }
  return out;
}
