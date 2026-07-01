// services/helperTools/tools/appendToFile.js
const fs = require("fs").promises;
const fss = require("fs");
const path = require("path");
const workspace = require("../../workspace");
const policy = require("../policy");

let _confirmer = null;
function setConfirmer(fn) { _confirmer = fn; }
let _onFileWritten = null;
function setOnFileWritten(fn) { _onFileWritten = fn; }

module.exports = {
  name: "appendToFile",
  description:
    "Adiciona conteúdo ao FIM de um arquivo existente no workspace. Pede confirmação. Use pra logs ou completar arquivos sem sobrescrever.",
  schema: {
    type: "object",
    properties: {
      path: { type: "string", description: "Caminho ABSOLUTO." },
      content: { type: "string", description: "Texto a adicionar ao fim." },
      addNewline: { type: "boolean", description: "(Opcional) Adicionar \\n no início. Default: true." },
    },
    required: ["path", "content"],
    additionalProperties: false,
  },
  mutates: true,
  setConfirmer,
  setOnFileWritten,

  async run(args, ctx) {
    const target = args && args.path ? policy.resolveAbs(args.path) : "";
    if (!target) return { ok: false, error: "path obrigatório" };
    if (!workspace.isPathAllowed(target)) {
      return { ok: false, error: `path "${target}" fora do workspace` };
    }
    if (!fss.existsSync(target)) {
      return { ok: false, error: "arquivo não existe (use writeFile pra criar)" };
    }
    if (typeof _confirmer !== "function") return { ok: false, error: "confirmer não registrado" };

    const addNl = args.addNewline !== false;
    const toAppend = (addNl ? "\n" : "") + String(args.content || "");

    let confirmed = false;
    if (ctx && ctx.force) {
      console.log(`[appendToFile] force=true → ignorando confirmação visual para ${target}`);
      confirmed = true;
    } else {
      if (typeof _confirmer !== "function") return { ok: false, error: "confirmer não registrado" };
      confirmed = await _confirmer({
        title: "Confirmação necessária",
        message: "A IA quer ADICIONAR conteúdo ao arquivo:",
        detail: `${target}\n\n+${toAppend.length} bytes no fim`,
        confirmText: "Adicionar",
        cancelText: "Cancelar",
        timeoutMs: 20000,
      });
    }

    if (!confirmed) return { ok: true, result: { appended: false, reason: "cancelado" } };

    try {
      await fs.appendFile(target, toAppend, "utf8");
      console.log(`[appendToFile] ${target} +${toAppend.length} bytes`);
      if (typeof _onFileWritten === "function") {
        try { _onFileWritten({ action: "append", path: target }); } catch (_) {}
      }
      return { ok: true, result: { appended: true, path: target, bytes: toAppend.length } };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  },
};
