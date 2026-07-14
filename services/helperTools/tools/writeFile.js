// services/helperTools/tools/writeFile.js
// Escreve conteúdo em arquivo. EXIGE confirmação do usuário e faz backup
// automático antes de sobrescrever. Restrito a paths do workspace.

const fs = require("fs").promises;
const fss = require("fs");
const path = require("path");
const os = require("os");
const workspace = require("../../workspace");
const policy = require("../policy");

const BACKUP_ROOT = path.join(os.homedir(), ".config", "helper-node", "backups");
const MAX_BYTES = 5 * 1024 * 1024; // 5MB

let _confirmer = null;
function setConfirmer(fn) { _confirmer = fn; }
let _onFileWritten = null;
function setOnFileWritten(fn) { _onFileWritten = fn; }

async function _backup(absPath) {
  if (!fss.existsSync(absPath)) return null;
  const date = new Date().toISOString().slice(0, 10);
  const dir = path.join(BACKUP_ROOT, date);
  await fs.mkdir(dir, { recursive: true });
  const stamp = Date.now();
  const target = path.join(dir, `${stamp}_${path.basename(absPath)}`);
  await fs.copyFile(absPath, target);
  return target;
}

module.exports = {
  name: "writeFile",
  description:
    "Cria ou SOBRESCREVE um arquivo no workspace anexado. Faz backup automático antes de sobrescrever. SEMPRE pede confirmação visual ao usuário. Use quando o usuário pedir explicitamente para criar/atualizar um arquivo.",
  schema: {
    type: "object",
    properties: {
      path: { type: "string", description: "Caminho ABSOLUTO do arquivo. Deve estar dentro de um anexo do workspace." },
      content: { type: "string", description: "Conteúdo completo do arquivo (texto)." },
      reason: { type: "string", description: "(Opcional) Motivo curto exibido na confirmação." },
    },
    required: ["path", "content"],
    additionalProperties: false,
  },
  mutates: true,
  setConfirmer,
  setOnFileWritten,

  async run(args, ctx) {
    const target = args && args.path ? policy.resolveAbs(args.path) : "";
    const content = String(args && args.content || "");
    if (!target) return { ok: false, error: "path obrigatório" };
    if (Buffer.byteLength(content) > MAX_BYTES) {
      return { ok: false, error: `conteúdo > ${MAX_BYTES} bytes` };
    }
    if (!workspace.isPathAllowed(target)) {
      return { ok: false, error: `path "${target}" não está em nenhum anexo do workspace. Adicione a pasta/arquivo primeiro.` };
    }
    const existed = fss.existsSync(target);
    const action = existed ? "SOBRESCREVER" : "CRIAR";
    
    let confirmed = false;
    if (ctx && ctx.force) {
      console.log(`[writeFile] force=true → ignorando confirmação visual para ${target}`);
      confirmed = true;
    } else {
      if (typeof _confirmer !== "function") {
        return { ok: false, error: "confirmer não registrado" };
      }
      confirmed = await _confirmer({
        title: "Confirmação necessária",
        message: `A IA quer ${action} o arquivo:`,
        detail: `${target}\n${args.reason || ""}\n\n${content.length} bytes${existed ? " · backup automático antes" : ""}`,
        confirmText: existed ? "Sobrescrever" : "Criar",
        cancelText: "Cancelar",
        timeoutMs: 30000,
      });
    }

    if (!confirmed) return { ok: true, result: { written: false, reason: "cancelado pelo usuário" } };

    try {
      let backupAt = null;
      if (existed) backupAt = await _backup(target);
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(target, content, "utf8");
      console.log(`[writeFile] ${target} (${content.length} chars)${backupAt ? " backup=" + backupAt : ""}`);
      if (typeof _onFileWritten === "function") {
        try { _onFileWritten({ action: existed ? "edit" : "create", path: target, backupAt }); } catch (_) {}
      }
      return { ok: true, result: { written: true, path: target, action: existed ? "overwritten" : "created", backupAt, bytes: content.length } };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  },
};
