// services/helperTools/tools/patchFile.js
// Edição cirúrgica: substitui oldText por newText. Não-fuzzy (literal).
// Pra edições mais complexas, IA usa writeFile com conteúdo completo.

const fs = require("fs").promises;
const fss = require("fs");
const path = require("path");
const os = require("os");
const workspace = require("../../workspace");

const BACKUP_ROOT = path.join(os.homedir(), ".config", "helper-node", "backups");

let _confirmer = null;
function setConfirmer(fn) { _confirmer = fn; }
let _onFileWritten = null;
function setOnFileWritten(fn) { _onFileWritten = fn; }

async function _backup(absPath) {
  const date = new Date().toISOString().slice(0, 10);
  const dir = path.join(BACKUP_ROOT, date);
  await fs.mkdir(dir, { recursive: true });
  const target = path.join(dir, `${Date.now()}_${path.basename(absPath)}`);
  await fs.copyFile(absPath, target);
  return target;
}

module.exports = {
  name: "patchFile",
  description:
    "Substitui um trecho EXATO de texto em um arquivo do workspace. O oldText precisa bater LITERAL (com espaços e quebras). Pede confirmação. Use pra edits pontuais; pra reescrever arquivo inteiro use writeFile.",
  schema: {
    type: "object",
    properties: {
      path: { type: "string", description: "Caminho ABSOLUTO." },
      oldText: { type: "string", description: "Texto exato a procurar. Deve aparecer UMA única vez no arquivo." },
      newText: { type: "string", description: "Texto que substitui oldText." },
    },
    required: ["path", "oldText", "newText"],
    additionalProperties: false,
  },
  mutates: true,
  setConfirmer,
  setOnFileWritten,

  async run(args) {
    const target = args && args.path ? path.resolve(args.path) : "";
    if (!target) return { ok: false, error: "path obrigatório" };
    if (!workspace.isPathAllowed(target)) {
      return { ok: false, error: `path "${target}" fora do workspace` };
    }
    if (!fss.existsSync(target)) return { ok: false, error: "arquivo não existe" };
    const oldText = String(args.oldText || "");
    const newText = String(args.newText || "");
    if (!oldText) return { ok: false, error: "oldText vazio" };
    if (typeof _confirmer !== "function") return { ok: false, error: "confirmer não registrado" };

    let original;
    try { original = await fs.readFile(target, "utf8"); }
    catch (e) { return { ok: false, error: "leitura falhou: " + e.message }; }

    const occurrences = original.split(oldText).length - 1;
    if (occurrences === 0) return { ok: false, error: "oldText não encontrado. Verifique espaços/quebras exatos." };
    if (occurrences > 1) return { ok: false, error: `oldText aparece ${occurrences} vezes; precisa ser único. Inclua mais contexto.` };

    const updated = original.replace(oldText, newText);
    const preview = `- ${oldText.split("\n").slice(0, 3).join("\\n").slice(0, 120)}…\n+ ${newText.split("\n").slice(0, 3).join("\\n").slice(0, 120)}…`;

    const confirmed = await _confirmer({
      title: "Confirmação necessária",
      message: "A IA quer EDITAR o arquivo:",
      detail: `${target}\n\n${preview}`,
      confirmText: "Aplicar patch",
      cancelText: "Cancelar",
      timeoutMs: 30000,
    });
    if (!confirmed) return { ok: true, result: { patched: false, reason: "cancelado" } };

    try {
      const backupAt = await _backup(target);
      await fs.writeFile(target, updated, "utf8");
      console.log(`[patchFile] ${target} (-${oldText.length}/+${newText.length}) backup=${backupAt}`);
      if (typeof _onFileWritten === "function") {
        try { _onFileWritten({ action: "patch", path: target, backupAt }); } catch (_) {}
      }
      return { ok: true, result: { patched: true, path: target, backupAt, bytesBefore: original.length, bytesAfter: updated.length } };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  },
};
