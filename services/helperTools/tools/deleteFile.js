// services/helperTools/tools/deleteFile.js
// Apaga arquivo. Prefere `gio trash` (lixeira) sobre rm direto.

const fs = require("fs").promises;
const fss = require("fs");
const path = require("path");
const { exec } = require("child_process");
const util = require("util");
const execp = util.promisify(exec);
const workspace = require("../../workspace");
const policy = require("../policy");

let _confirmer = null;
function setConfirmer(fn) { _confirmer = fn; }
let _onFileWritten = null;
function setOnFileWritten(fn) { _onFileWritten = fn; }

async function _hasGioTrash() {
  try { await execp("command -v gio"); return true; } catch { return false; }
}

module.exports = {
  name: "deleteFile",
  description:
    "Apaga um arquivo do workspace. Prefere mandar pra lixeira (gio trash) quando possível. SEMPRE pede confirmação.",
  schema: {
    type: "object",
    properties: {
      path: { type: "string", description: "Caminho ABSOLUTO do arquivo a apagar." },
      reason: { type: "string", description: "(Opcional) Motivo curto." },
    },
    required: ["path"],
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
      return { ok: false, error: "arquivo não existe" };
    }
    const st = await fs.stat(target);
    if (st.isDirectory()) return { ok: false, error: "deleteFile não apaga diretórios. Use deletePath (não implementado) ou faça pelo shell." };
    
    let confirmed = false;
    if (ctx && ctx.force) {
      console.log(`[deleteFile] force=true → ignorando confirmação visual para ${target}`);
      confirmed = true;
    } else {
      if (typeof _confirmer !== "function") return { ok: false, error: "confirmer não registrado" };
      confirmed = await _confirmer({
        title: "⚠️ Confirmação necessária",
        message: "A IA quer APAGAR o arquivo:",
        detail: `${target}\n${args.reason || ""}\n\n${st.size} bytes${await _hasGioTrash() ? " · vai pra lixeira" : " · DELETE permanente (sem lixeira)"}`,
        confirmText: "Apagar",
        cancelText: "Cancelar",
        timeoutMs: 30000,
      });
    }

    if (!confirmed) return { ok: true, result: { deleted: false, reason: "cancelado" } };

    try {
      if (await _hasGioTrash()) {
        await execp(`gio trash "${target}"`, { timeout: 8000 });
        console.log(`[deleteFile] ${target} → lixeira (gio trash)`);
      } else {
        await fs.unlink(target);
        console.log(`[deleteFile] ${target} → unlink`);
      }
      if (typeof _onFileWritten === "function") {
        try { _onFileWritten({ action: "delete", path: target }); } catch (_) {}
      }
      return { ok: true, result: { deleted: true, path: target } };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  },
};
