// services/helperTools/tools/listPackages.js
// Lista pacotes instalados no sistema. Suporta varios gerenciadores em paralelo
// (alguns sistemas tem apt + flatpak + snap simultaneamente).
//
// Sem argumentos: tenta detectar o gerenciador nativo do SO e retorna a lista
// completa (TRUNCADA pra nao estourar contexto - max 500 itens por gerenciador).
//
// Com `pattern`: filtra por nome do pacote (case-insensitive, substring match).
// Recomendado quando a IA quer saber se um app especifico esta instalado.
//
// Com `manager`: forca um gerenciador especifico ("apt", "pacman", "dnf",
// "zypper", "apk", "brew", "flatpak", "snap"). Default: detecta o nativo +
// roda flatpak/snap se disponiveis.

const { exec } = require("child_process");
const { promisify } = require("util");
const platform = require("../platforms/detect");
const execAsync = promisify(exec);

const MAX_ITEMS_PER_MANAGER = 500;
const TIMEOUT_MS = 15000;

// Comando + parser por gerenciador. parser recebe stdout e retorna array de
// objetos { name, version } (version opcional).
const MANAGERS = {
  apt: {
    available: async () => _hasCmd("dpkg-query"),
    cmd: "dpkg-query -W -f='${Package}|${Version}\\n'",
    parse: (out) => out.split("\n").filter(Boolean).map((l) => {
      const [name, version] = l.split("|");
      return { name, version: version || "" };
    }),
  },
  pacman: {
    available: async () => _hasCmd("pacman"),
    cmd: "pacman -Q",
    parse: (out) => out.split("\n").filter(Boolean).map((l) => {
      const [name, version] = l.split(/\s+/);
      return { name, version: version || "" };
    }),
  },
  dnf: {
    available: async () => _hasCmd("rpm"),
    // rpm e' mais rapido que `dnf list installed`
    cmd: "rpm -qa --queryformat '%{NAME}|%{VERSION}-%{RELEASE}\\n'",
    parse: (out) => out.split("\n").filter(Boolean).map((l) => {
      const [name, version] = l.split("|");
      return { name, version: version || "" };
    }),
  },
  zypper: {
    available: async () => _hasCmd("rpm"),
    cmd: "rpm -qa --queryformat '%{NAME}|%{VERSION}-%{RELEASE}\\n'",
    parse: (out) => out.split("\n").filter(Boolean).map((l) => {
      const [name, version] = l.split("|");
      return { name, version: version || "" };
    }),
  },
  apk: {
    available: async () => _hasCmd("apk"),
    cmd: "apk info -v",
    parse: (out) => out.split("\n").filter(Boolean).map((l) => ({ name: l, version: "" })),
  },
  brew: {
    available: async () => _hasCmd("brew"),
    cmd: "brew list --versions",
    parse: (out) => out.split("\n").filter(Boolean).map((l) => {
      const parts = l.split(/\s+/);
      return { name: parts[0], version: parts.slice(1).join(" ") || "" };
    }),
  },
  flatpak: {
    available: async () => _hasCmd("flatpak"),
    cmd: "flatpak list --app --columns=application,version",
    parse: (out) => out.split("\n").filter(Boolean).map((l) => {
      // formato: "org.app.Name\t1.2.3" (algumas distros usam espacos largos)
      const parts = l.split(/\t|\s{2,}/);
      return { name: parts[0], version: (parts[1] || "").trim() };
    }),
  },
  snap: {
    available: async () => _hasCmd("snap"),
    cmd: "snap list",
    parse: (out) => {
      const lines = out.split("\n").filter(Boolean);
      // primeira linha e' header
      return lines.slice(1).map((l) => {
        const parts = l.split(/\s+/);
        return { name: parts[0], version: parts[1] || "" };
      });
    },
  },
};

async function _hasCmd(cmd) {
  try {
    await execAsync(`command -v ${cmd}`, { timeout: 2000 });
    return true;
  } catch {
    return false;
  }
}

async function _runManager(key, patternRe) {
  const m = MANAGERS[key];
  if (!m) return { manager: key, error: "gerenciador nao suportado" };
  try {
    const { stdout } = await execAsync(m.cmd, {
      timeout: TIMEOUT_MS,
      maxBuffer: 50 * 1024 * 1024,
    });
    let items = m.parse(stdout);
    const total = items.length;
    if (patternRe) {
      items = items.filter((it) => patternRe.test(it.name));
    }
    const matched = items.length;
    const truncated = items.length > MAX_ITEMS_PER_MANAGER;
    if (truncated) items = items.slice(0, MAX_ITEMS_PER_MANAGER);
    return { manager: key, total, matched, truncated, items };
  } catch (e) {
    return { manager: key, error: String(e && e.message || e) };
  }
}

module.exports = {
  name: "listPackages",
  description:
    "Lista pacotes/aplicativos instalados no sistema. Detecta o gerenciador nativo (apt/pacman/dnf/zypper/apk/brew) e tambem checa flatpak/snap se disponiveis. Use `pattern` (substring case-insensitive) para filtrar por nome — recomendado quando perguntam se um app especifico esta instalado. Sem `pattern`, lista TUDO (truncado em 500 por gerenciador).",
  schema: {
    type: "object",
    properties: {
      pattern: {
        type: "string",
        description:
          "Filtro substring case-insensitive aplicado ao NOME do pacote. Ex: 'docker', 'helper-node', 'chrome'. Recomendado sempre que possivel.",
      },
      manager: {
        type: "string",
        enum: ["apt", "pacman", "dnf", "zypper", "apk", "brew", "flatpak", "snap"],
        description:
          "Forca um gerenciador especifico. Sem isso, roda o nativo do SO + flatpak/snap se instalados.",
      },
    },
  },
  mutates: false,

  async run(args = {}) {
    const pattern = typeof args.pattern === "string" && args.pattern.trim()
      ? args.pattern.trim()
      : null;
    const patternRe = pattern
      ? new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i")
      : null;

    let managersToRun = [];
    if (args.manager) {
      managersToRun = [args.manager];
    } else {
      const p = platform.detect();
      // gerenciador nativo do SO
      if (p.pkg && MANAGERS[p.pkg]) managersToRun.push(p.pkg);
      // flatpak/snap rodam em paralelo se disponiveis (comum em Ubuntu/Pop/Fedora)
      for (const extra of ["flatpak", "snap"]) {
        if (managersToRun.includes(extra)) continue;
        if (await MANAGERS[extra].available()) managersToRun.push(extra);
      }
    }

    if (managersToRun.length === 0) {
      return {
        ok: false,
        error: "Nenhum gerenciador de pacotes detectado neste sistema.",
      };
    }

    const results = await Promise.all(managersToRun.map((k) => _runManager(k, patternRe)));

    // Sumario util pro modelo decidir prox passo
    const summary = results.map((r) => {
      if (r.error) return `${r.manager}: erro (${r.error})`;
      return `${r.manager}: ${r.matched}/${r.total}${r.truncated ? " (truncado)" : ""}`;
    }).join(" | ");

    return {
      ok: true,
      result: {
        platform: platform.detect().distro,
        pattern: pattern || null,
        summary,
        managers: results,
      },
    };
  },
};
