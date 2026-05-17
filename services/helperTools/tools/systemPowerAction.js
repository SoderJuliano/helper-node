// services/helperTools/tools/systemPowerAction.js
// Aciona acoes de energia do sistema (desligar, reiniciar, suspender, bloquear,
// fazer logout). EXIGE CONFIRMACAO do usuario via janela overlay antes de
// executar — nunca dispara sem clique humano (mutates: true).
//
// Usa loginctl (systemd-logind) que funciona SEM sudo em sessoes graficas
// modernas (GNOME/COSMIC/KDE/Hyprland). Lock usa loginctl lock-session
// quando disponivel, com fallback pra xdg-screensaver/cosmic-greeter/swaylock.
//
// Whitelist rigorosa: NADA fora dessas 5 acoes. Nenhuma exec arbitraria.

const { exec, spawn } = require("child_process");
const { promisify } = require("util");
const execAsync = promisify(exec);

const ALLOWED = {
  poweroff: { label: "DESLIGAR o computador", cmd: ["loginctl", "poweroff"] },
  reboot:   { label: "REINICIAR o computador", cmd: ["loginctl", "reboot"] },
  suspend:  { label: "SUSPENDER (sleep) o computador", cmd: ["loginctl", "suspend"] },
  lock:     { label: "BLOQUEAR a tela", cmd: null /* tratamento especial */ },
  logout:   { label: "FAZER LOGOUT da sessao atual", cmd: ["loginctl", "terminate-user", String(process.getuid && process.getuid() || "")] },
};

// Setter injetado pelo main.js (ver helperTools/index.js -> registerConfirmer)
let _confirmer = null;
function setConfirmer(fn) { _confirmer = fn; }

async function _runLock() {
  // Ordem de tentativa: loginctl lock-session (mais portatil),
  // depois fallbacks por DE.
  const candidates = [
    ["loginctl", ["lock-session"]],
    ["cosmic-greeter", ["lock"]],
    ["gnome-screensaver-command", ["-l"]],
    ["xdg-screensaver", ["lock"]],
    ["swaylock", []],
    ["i3lock", []],
  ];
  for (const [bin, args] of candidates) {
    try {
      await execAsync(`command -v ${bin}`);
      await new Promise((resolve, reject) => {
        const p = spawn(bin, args, { detached: true, stdio: "ignore" });
        p.on("error", reject);
        p.unref();
        setTimeout(resolve, 300); // assume sucesso se nao crashou em 300ms
      });
      return { ok: true, result: { action: "lock", ran: `${bin} ${args.join(" ")}` } };
    } catch (_) { /* tenta o proximo */ }
  }
  return { ok: false, error: "Nenhum comando de lock disponivel (loginctl/cosmic-greeter/gnome-screensaver/xdg-screensaver/swaylock/i3lock)" };
}

module.exports = {
  name: "systemPowerAction",
  description:
    "Executa uma acao de energia do sistema operacional: desligar, reiniciar, suspender, bloquear tela ou logout. SEMPRE pede confirmacao visual ao usuario antes de executar — nao ha como pular essa confirmacao. Use quando o usuario pedir explicitamente para 'desligar o pc', 'reiniciar', 'suspender/dormir o pc', 'bloquear a tela', 'fazer logout'.",
  schema: {
    type: "object",
    properties: {
      action: {
        type: "string",
        enum: Object.keys(ALLOWED),
        description: "A acao a executar. Apenas valores da whitelist sao aceitos.",
      },
      reason: {
        type: "string",
        description: "(Opcional) Motivo curto que sera exibido na confirmacao para o usuario, ex.: 'usuario pediu para encerrar o dia'.",
      },
    },
    required: ["action"],
    additionalProperties: false,
  },
  mutates: true,

  setConfirmer,

  async run(args /*, ctx */) {
    const action = (args && args.action || "").toLowerCase();
    const spec = ALLOWED[action];
    if (!spec) {
      return { ok: false, error: `Acao "${action}" nao permitida. Use uma de: ${Object.keys(ALLOWED).join(", ")}` };
    }

    // Confirmacao obrigatoria
    if (typeof _confirmer !== "function") {
      return { ok: false, error: "Confirmer nao registrado no main process — nao posso confirmar acoes destrutivas com seguranca." };
    }
    let confirmed = false;
    try {
      confirmed = await _confirmer({
        title: "Confirmacao necessaria",
        message: `A IA quer ${spec.label}.`,
        detail: args.reason || "",
        action,
        confirmText: action === "poweroff" ? "Desligar" :
                     action === "reboot"   ? "Reiniciar" :
                     action === "suspend"  ? "Suspender" :
                     action === "lock"     ? "Bloquear" :
                     action === "logout"   ? "Sair" : "Confirmar",
        cancelText: "Cancelar",
        timeoutMs: 20000, // se ninguem responder em 20s, cancela
      });
    } catch (e) {
      return { ok: false, error: "Confirmacao falhou: " + (e.message || String(e)) };
    }

    if (!confirmed) {
      return { ok: true, result: { action, executed: false, reason: "Usuario cancelou ou timeout." } };
    }

    // Executa
    try {
      if (action === "lock") return await _runLock();
      const [bin, ...rest] = spec.cmd;
      await new Promise((resolve, reject) => {
        const p = spawn(bin, rest, { detached: true, stdio: "ignore" });
        p.on("error", reject);
        p.unref();
        setTimeout(resolve, 500); // poweroff/reboot vao matar a sessao, nao esperamos exit
      });
      return { ok: true, result: { action, executed: true, ran: spec.cmd.join(" ") } };
    } catch (e) {
      return { ok: false, error: `Falha ao executar ${action}: ${e.message || String(e)}` };
    }
  },
};
