// services/helperTools/tools/listDesktopApps.js
// Lista apps GUI instalados via .desktop files (XDG Desktop Entry Specification).
//
// MUITO MAIS UTIL que listPackages pra perguntas tipo "quais editores de texto
// tenho instalados?" — pacotes nao tem 'editor' no nome (gedit, code, vim,
// kate, etc), mas .desktop files tem Categories=TextEditor e Name="Text Editor".
//
// Lugares varridos:
//   /usr/share/applications/         (apps do sistema)
//   /var/lib/flatpak/exports/share/applications/  (flatpaks)
//   ~/.local/share/applications/     (apps do usuario)
//   ~/.local/share/flatpak/exports/share/applications/
//
// Args:
//   pattern    — substring case-insensitive em Name/Comment/Exec/Categories
//   category   — filtra por XDG Category (TextEditor, WebBrowser, Development,
//                AudioVideo, Game, Office, Network, Graphics, System, Utility…)

const fs = require("fs/promises");
const path = require("path");
const os = require("os");

const APP_DIRS_STATIC = [
  "/usr/share/applications",
  "/usr/local/share/applications",
  "/var/lib/flatpak/exports/share/applications",
  "/var/lib/snapd/desktop/applications",
  path.join(os.homedir(), ".local/share/applications"),
  path.join(os.homedir(), ".local/share/flatpak/exports/share/applications"),
];

/**
 * Constroi a lista final de diretorios a varrer, incluindo XDG_DATA_DIRS
 * dinamico (ambientes/distros customizadas podem ter outros caminhos).
 */
function buildAppDirs() {
  const dirs = new Set(APP_DIRS_STATIC);
  const xdg = process.env.XDG_DATA_DIRS;
  if (xdg) {
    for (const d of xdg.split(":")) {
      if (d) dirs.add(path.join(d, "applications"));
    }
  }
  const xdgHome = process.env.XDG_DATA_HOME || path.join(os.homedir(), ".local/share");
  dirs.add(path.join(xdgHome, "applications"));
  return Array.from(dirs);
}

const MAX_RESULTS = 300;
const TIMEOUT_MS = 8000;

function parseDesktopFile(content) {
  // Pega so a secao [Desktop Entry]; ignora [Desktop Action xxx]
  const lines = content.split("\n");
  const entry = {};
  let inEntry = false;
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    if (line.startsWith("[")) {
      inEntry = line === "[Desktop Entry]";
      continue;
    }
    if (!inEntry) continue;
    const eq = line.indexOf("=");
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    const val = line.slice(eq + 1).trim();
    // Ignora localizacoes (Name[pt_BR]=…) — pega so Name= default
    if (key.includes("[")) continue;
    entry[key] = val;
  }
  return entry;
}

async function _scanDir(dir) {
  let names;
  try {
    names = await fs.readdir(dir);
  } catch {
    return [];
  }
  const apps = [];
  await Promise.all(
    names
      .filter((n) => n.endsWith(".desktop"))
      .map(async (n) => {
        const full = path.join(dir, n);
        try {
          const content = await fs.readFile(full, "utf8");
          const e = parseDesktopFile(content);
          if (!e.Type || e.Type !== "Application") return;
          if (e.NoDisplay === "true" || e.Hidden === "true") return;
          apps.push({
            id: n.replace(/\.desktop$/, ""),
            name: e.Name || n,
            comment: e.Comment || "",
            exec: (e.Exec || "").replace(/\s+%[fFuU]\s*$/, "").trim(),
            categories: (e.Categories || "")
              .split(";")
              .map((s) => s.trim())
              .filter(Boolean),
            tryExec: e.TryExec || "",
            source: dir,
          });
        } catch {
          /* ignore unreadable */
        }
      })
  );
  return apps;
}

module.exports = {
  name: "listDesktopApps",
  description:
    "Lista apps GUI instalados via arquivos .desktop (XDG). Bem mais util que listPackages quando o user pergunta 'quais editores tenho', 'quais navegadores', 'quais apps de audio', porque .desktop files tem nome legivel + categoria. Filtre com `pattern` (substring em Name/Comment/Exec/Categories) ou `category` (XDG: TextEditor, WebBrowser, Development, AudioVideo, Office, Graphics, Network, Game, System, Utility, Settings…).",
  schema: {
    type: "object",
    properties: {
      pattern: {
        type: "string",
        description:
          "Filtro substring case-insensitive em Name, Comment, Exec e Categories. Ex: 'editor', 'browser', 'code'.",
      },
      category: {
        type: "string",
        description:
          "Filtra por XDG Category exato. Exemplos: TextEditor, WebBrowser, Development, AudioVideo, Office, Graphics, Network, Game, System, Utility, Settings, IDE, Terminal.",
      },
    },
  },
  mutates: false,

  async run(args = {}) {
    const pattern = typeof args.pattern === "string" && args.pattern.trim()
      ? args.pattern.trim().toLowerCase()
      : null;
    const category = typeof args.category === "string" && args.category.trim()
      ? args.category.trim()
      : null;

    const APP_DIRS = buildAppDirs();
    const all = (await Promise.race([
      Promise.all(APP_DIRS.map(_scanDir)),
      new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), TIMEOUT_MS)),
    ]).catch(() => [])).flat();

    // Dedupe por id (~/.local sobrescreve /usr/share)
    const byId = new Map();
    for (const app of all) {
      // prioridade: ~/.local > flatpak > /usr/local > /usr/share
      const prio = app.source.startsWith(os.homedir())
        ? 3
        : app.source.includes("flatpak")
        ? 2
        : app.source.includes("/usr/local")
        ? 1
        : 0;
      const cur = byId.get(app.id);
      if (!cur || prio > cur._prio) {
        byId.set(app.id, { ...app, _prio: prio });
      }
    }
    let apps = Array.from(byId.values());

    if (category) {
      apps = apps.filter((a) => a.categories.includes(category));
    }
    if (pattern) {
      apps = apps.filter((a) => {
        const hay = [
          a.name,
          a.comment,
          a.exec,
          a.id,
          a.categories.join(" "),
        ]
          .join(" ")
          .toLowerCase();
        return hay.includes(pattern);
      });
    }

    // Ordena por name pra output determinístico
    apps.sort((a, b) => a.name.localeCompare(b.name));

    const total = apps.length;
    const truncated = apps.length > MAX_RESULTS;
    if (truncated) apps = apps.slice(0, MAX_RESULTS);

    // Limpa _prio do output
    apps = apps.map(({ _prio, ...rest }) => rest);

    return {
      ok: true,
      result: {
        pattern: pattern || null,
        category: category || null,
        total,
        truncated,
        scannedDirs: APP_DIRS,
        apps,
      },
    };
  },
};
