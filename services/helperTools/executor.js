// services/helperTools/executor.js
// Despacha uma chamada de tool (nome + args) para o handler certo.
// Valida policy, executa, audita, retorna objeto padronizado.
//
// Formato de retorno: { ok: bool, result?: any, error?: string, meta?: {...} }

const audit = require("./audit");
const registry = require("./registry");

async function execute(toolName, args, ctx) {
  // ctx: { cfg, requestId? }
  const tool = registry.get(toolName);
  if (!tool) {
    const err = { ok: false, error: `Tool desconhecida: "${toolName}".` };
    audit.logToolCall(toolName, args, err);
    return err;
  }
  try {
    const t0 = Date.now();
    const res = await tool.run(args || {}, ctx);
    const elapsed = Date.now() - t0;
    const safe = res && typeof res === "object" ? res : { ok: false, error: "Retorno inválido" };
    safe.meta = { ...(safe.meta || {}), elapsedMs: elapsed };
    audit.logToolCall(toolName, args, safe);
    return safe;
  } catch (e) {
    const err = { ok: false, error: e.message || String(e) };
    audit.logToolCall(toolName, args, err);
    return err;
  }
}

module.exports = { execute };
