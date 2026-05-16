// services/helperTools/registry.js
// Catálogo de tools. Cada tool é { name, description, schema, run, mutates }.
// `mutates: true` indica que tool altera estado (write/exec) → exige
// confirmação. Read-only tools rodam sem perguntar.

const tools = new Map();

function register(tool) {
  if (!tool || !tool.name || typeof tool.run !== "function") {
    throw new Error("registry.register: tool inválida (precisa de name + run)");
  }
  tools.set(tool.name, tool);
}

function get(name) {
  return tools.get(name);
}

function list() {
  return Array.from(tools.values());
}

function clear() {
  tools.clear();
}

// Carrega tools built-in. Idempotente.
let _loaded = false;
function loadBuiltins() {
  if (_loaded) return;
  const builtins = [
    require("./tools/listDir"),
    require("./tools/fileInfo"),
    require("./tools/readFile"),
    require("./tools/readFileChunk"),
    require("./tools/searchInFiles"),
    require("./tools/findFiles"),
    require("./tools/detectShellConfig"),
    require("./tools/listPackages"),
    require("./tools/listDesktopApps"),
  ];
  for (const t of builtins) register(t);
  _loaded = true;
}

module.exports = { register, get, list, clear, loadBuiltins };
