// services/helperTools/tools/patchFile.js
// Edição cirúrgica: substitui oldText por newText ou edita um intervalo de linhas.
// Faz backup automático antes de editar. Restrito a paths do workspace.

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

function normalizeLineEndings(text, targetEnding) {
  const lf = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  if (targetEnding === "\r\n") {
    return lf.replace(/\n/g, "\r\n");
  }
  return lf;
}

module.exports = {
  name: "patchFile",
  description:
    "Substitui um trecho de texto ou um intervalo de linhas em um arquivo do workspace. Suporta busca por 'oldText' (com normalização de quebras de linha) ou substituição direta especificando 'startLine' e 'endLine'.",
  schema: {
    type: "object",
    properties: {
      path: { type: "string", description: "Caminho ABSOLUTO do arquivo." },
      oldText: { type: "string", description: "Texto exato a procurar e substituir. Se usar startLine/endLine, oldText é opcional e serve para validação extra." },
      newText: { type: "string", description: "Texto que substituirá o trecho editado." },
      startLine: { type: "integer", description: "(Opcional) Linha inicial do trecho a editar (1-indexed)." },
      endLine: { type: "integer", description: "(Opcional) Linha final do trecho a editar (1-indexed, inclusive)." }
    },
    required: ["path", "newText"],
    additionalProperties: false,
  },
  mutates: true,
  setConfirmer,
  setOnFileWritten,

  async run(args, ctx) {
    const target = args && args.path ? path.resolve(args.path) : "";
    if (!target) return { ok: false, error: "path obrigatório" };
    if (!workspace.isPathAllowed(target)) {
      return { ok: false, error: `path "${target}" fora do workspace` };
    }
    if (!fss.existsSync(target)) return { ok: false, error: "arquivo não existe" };
    if (typeof _confirmer !== "function") return { ok: false, error: "confirmer não registrado" };

    let original;
    try { original = await fs.readFile(target, "utf8"); }
    catch (e) { return { ok: false, error: "leitura falhou: " + e.message }; }

    const hasCrlf = original.includes("\r\n");
    const lineEnding = hasCrlf ? "\r\n" : "\n";

    let updated = "";
    let preview = "";
    const startLine = args.startLine !== undefined ? Number(args.startLine) : NaN;
    const endLine = args.endLine !== undefined ? Number(args.endLine) : NaN;

    if (!isNaN(startLine) && !isNaN(endLine)) {
      if (startLine < 1 || endLine < startLine) {
        return { ok: false, error: "startLine e endLine inválidos (startLine deve ser >= 1 e endLine >= startLine)" };
      }
      const lines = original.split(/\r?\n/);
      if (startLine > lines.length || endLine > lines.length) {
        return { ok: false, error: `Linhas fora do limite do arquivo. O arquivo tem apenas ${lines.length} linhas.` };
      }

      const targetSlice = lines.slice(startLine - 1, endLine).join(lineEnding);
      
      if (args.oldText) {
        const normalizedOld = normalizeLineEndings(String(args.oldText), lineEnding);
        const normalizedTargetSlice = normalizeLineEndings(targetSlice, lineEnding);
        
        const clean = (s) => s.replace(/\s+/g, " ").trim();
        if (clean(normalizedOld) !== clean(normalizedTargetSlice)) {
          return {
            ok: false,
            error: `O oldText fornecido não bate com o conteúdo das linhas ${startLine} a ${endLine}.\nEsperado (oldText):\n${args.oldText}\n\nEncontrado no arquivo:\n${targetSlice}`
          };
        }
      }

      const before = lines.slice(0, startLine - 1).join(lineEnding);
      const after = lines.slice(endLine).join(lineEnding);
      const normalizedNew = normalizeLineEndings(String(args.newText || ""), lineEnding);

      updated = (before ? before + lineEnding : "") + normalizedNew + (after ? lineEnding + after : "");
      preview = `- Linhas ${startLine}-${endLine}:\n${targetSlice.slice(0, 150)}…\n+ Substituído por:\n${normalizedNew.slice(0, 150)}…`;
    } else {
      const oldText = String(args.oldText || "");
      if (!oldText) {
        return { ok: false, error: "Se startLine/endLine não forem fornecidos, oldText é obrigatório." };
      }

      const normalizedOld = normalizeLineEndings(oldText, lineEnding);
      const normalizedNew = normalizeLineEndings(String(args.newText || ""), lineEnding);

      const occurrences = original.split(normalizedOld).length - 1;
      if (occurrences === 0) {
        const clean = (s) => s.replace(/\s+/g, " ").trim();
        const cleanOriginal = clean(original);
        const cleanOld = clean(normalizedOld);
        if (cleanOriginal.includes(cleanOld)) {
          return {
            ok: false,
            error: "oldText não encontrado literalmente, mas existe uma correspondência parecida (diferindo apenas em espaços/indentações). Verifique os espaços ou use startLine/endLine."
          };
        }
        return { ok: false, error: "oldText não encontrado no arquivo." };
      }
      if (occurrences > 1) {
        return { ok: false, error: `oldText aparece ${occurrences} vezes; precisa ser único no arquivo. Adicione mais linhas de contexto.` };
      }

      updated = original.replace(normalizedOld, normalizedNew);
      preview = `- ${oldText.split("\n").slice(0, 3).join("\\n").slice(0, 120)}…\n+ ${normalizedNew.split("\n").slice(0, 3).join("\\n").slice(0, 120)}…`;
    }

    let confirmed = false;
    if (ctx && ctx.force) {
      console.log(`[patchFile] force=true → ignorando confirmação visual para ${target}`);
      confirmed = true;
    } else {
      confirmed = await _confirmer({
        title: "Confirmação necessária",
        message: "A IA quer EDITAR o arquivo:",
        detail: `${target}\n\n${preview}`,
        confirmText: "Aplicar patch",
        cancelText: "Cancelar",
        timeoutMs: 30000,
      });
    }

    if (!confirmed) return { ok: true, result: { patched: false, reason: "cancelado" } };

    try {
      const backupAt = await _backup(target);
      await fs.writeFile(target, updated, "utf8");
      console.log(`[patchFile] ${target} backup=${backupAt}`);
      if (typeof _onFileWritten === "function") {
        try { _onFileWritten({ action: "patch", path: target, backupAt }); } catch (_) {}
      }
      return { ok: true, result: { patched: true, path: target, backupAt, bytesBefore: original.length, bytesAfter: updated.length } };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  },
};
