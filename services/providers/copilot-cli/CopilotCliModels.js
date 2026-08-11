// Lista de modelos da GitHub Copilot CLI — 100% dinâmica, lida do binário.
//
// FONTE: `copilot help config`. A seção `model:` desse help imprime os IDs
// exatos que o `--model` aceita, um por linha entre aspas:
//
//   `model`: AI model to use for Copilot CLI; can be changed with /model ...
//     - "claude-sonnet-5"
//     - "claude-sonnet-4.6"
//     - "gpt-5.6-terra"
//     ...
//
// Por que essa fonte e não outra (sondado contra o binário v1.0.77 de verdade):
//   - `--model ?` NÃO lista nada: só entra na sessão normal com o aviso
//     'Model "?" ... is not available. Using "claude-sonnet-5" instead.'
//   - O seletor `/model` (que mostra a tabela bonita com Context/Reasoning)
//     só existe no TUI interativo e devolve NOMES DE EXIBIÇÃO ("Claude Sonnet
//     4.6"), não os IDs. Derivar ID a partir do nome seria adivinhação.
//   - `help config` roda non-interactive, não exige auth, e dá o ID cru.
//
// Nada aqui é hardcoded: se a GitHub adicionar/remover modelo, aparece sozinho.
// Se a sondagem falhar, retornamos LISTA VAZIA — nunca um nome inventado.
//
// ⚠️ LIMITE CONHECIDO: `help config` lista o catálogo que o binário conhece,
// que é MAIOR do que o que a sua conta/org liberou (o picker interativo mostra
// só o subconjunto liberado). Como o CLI não tem nenhum comando não-interativo
// que devolva a lista já filtrada, o que sai daqui passa pelo
// CopilotCliModelAccess, que esconde os modelos que a sua conta já recusou.
// Ver o cabeçalho daquele módulo antes de mexer.

const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const { resolveBinary, getEnrichedEnv } = require('./CopilotCliProcess');
const modelAccess = require('./CopilotCliModelAccess');

// 'auto' é aceito pelo --model (documentado no próprio --help: "use 'auto' to
// let Copilot pick automatically") e é o que o picker mostra como 1ª opção.
const DEFAULT_MODEL = 'auto';

const MEMORY_TTL = 5 * 60 * 1000;
const PROBE_TIMEOUT = 20000;

let cachedModels = null;
let lastFetchTime = 0;
let inFlight = null;

function cacheFile() {
  try {
    const { app } = require('electron');
    return path.join(app.getPath('userData'), 'copilot-cli-models.json');
  } catch (_) {
    return null;
  }
}

function readDiskCache() {
  const f = cacheFile();
  if (!f) return null;
  try {
    const raw = JSON.parse(fs.readFileSync(f, 'utf8'));
    if (Array.isArray(raw.models) && raw.models.length) return raw.models;
  } catch (_) {}
  return null;
}

function writeDiskCache(models) {
  const f = cacheFile();
  if (!f) return;
  try {
    fs.writeFileSync(f, JSON.stringify({ savedAt: Date.now(), models }, null, 2));
  } catch (e) {
    console.warn('[CopilotCliModels] não consegui gravar cache:', e.message);
  }
}

function runCopilot(bin, args, timeoutMs) {
  return new Promise((resolve) => {
    // Shim .cmd/.bat do npm precisa de shell; .exe roda direto.
    const useShell = process.platform === 'win32' && /\.(cmd|bat)$/i.test(bin);
    const child = execFile(
      bin,
      args,
      { timeout: timeoutMs, windowsHide: true, shell: useShell, maxBuffer: 4 * 1024 * 1024, env: getEnrichedEnv() },
      (_err, stdout, stderr) => resolve(((stdout || '') + '\n' + (stderr || '')).trim())
    );
    // Sem isso o processo pode ficar esperando entrada e só sair no timeout.
    try { child.stdin && child.stdin.end(); } catch (_) {}
  });
}

// Extrai os IDs da seção `model:` do `copilot help config`.
// Exportada para ser testável sem spawnar o binário (scripts/test-copilot-probe.js).
function parseModelIdsFromHelpConfig(out) {
  if (!out) return [];
  const lines = out.replace(/\[[0-9;]*[a-zA-Z]/g, '').split(/\r?\n/);

  // Acha a linha que abre a chave `model` (e não `modelXyz`/`providerModel`).
  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    if (/^\s*`model`\s*:/.test(lines[i])) { start = i; break; }
  }
  if (start === -1) return [];

  const ids = [];
  const seen = new Set();
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i];
    // Próxima chave de config (`contextTier`:, `logLevel`: ...) encerra a seção.
    if (/^\s*`[^`]+`\s*:/.test(line)) break;
    const m = line.match(/^\s*-\s*"([^"]+)"\s*$/);
    if (m) {
      const id = m[1].trim();
      if (id && !seen.has(id)) { seen.add(id); ids.push(id); }
      continue;
    }
    // Linha em branco no meio da lista é tolerada; texto solto encerra.
    if (line.trim() === '') continue;
    if (ids.length) break;
  }
  return ids;
}

// O CLI só devolve o ID; o label exibido é o próprio ID (nada de inventar
// "Claude Sonnet 4.6" a partir de "claude-sonnet-4.6" — o que a UI mostra é
// exatamente o que o --model aceita, então não há como divergir).
function toModels(ids) {
  return ids.map(id => ({ id, label: id }));
}

async function fetchModels() {
  const bin = await resolveBinary();
  if (!bin) return null;

  const out = await runCopilot(bin, ['help', 'config'], PROBE_TIMEOUT);
  const ids = parseModelIdsFromHelpConfig(out);
  if (!ids.length) return null;

  const models = toModels(ids);
  // 'auto' não aparece na lista do help config, mas é aceito pelo --model e é
  // a 1ª opção do picker do próprio CLI. Só entra se o CLI respondeu de fato.
  if (!models.some(m => m.id === 'auto')) {
    models.unshift({ id: 'auto', label: 'auto' });
  }
  return models;
}

// O cache (memória e disco) guarda sempre o CATÁLOGO CRU. A filtragem por
// conta é aplicada na saída, nunca no que é gravado — assim um modelo que a
// org libere depois volta sozinho quando o registro expira, sem precisar
// invalidar o cache do catálogo.
async function getModels() {
  return modelAccess.filterModels(await getCatalog());
}

// Catálogo sem filtro (o que o binário conhece). Usado pelo seletor via
// getModels e pelo diagnóstico scripts/probe-copilot-models.js.
async function getCatalog() {
  if (cachedModels && Date.now() - lastFetchTime < MEMORY_TTL) return cachedModels;

  const disk = readDiskCache();
  if (disk && !cachedModels) {
    // Serve o último resultado bom na hora e revalida em segundo plano.
    cachedModels = disk;
    lastFetchTime = Date.now();
    refresh();
    return disk;
  }

  // Sem fallback inventado: se nada resolver, a UI recebe [] e diz que não
  // conseguiu listar, em vez de mostrar modelo que pode não existir.
  return (await refresh()) || cachedModels || disk || [];
}

function refresh() {
  if (inFlight) return inFlight;
  inFlight = fetchModels()
    .then((models) => {
      if (models) {
        cachedModels = models;
        lastFetchTime = Date.now();
        writeDiskCache(models);
      }
      return models;
    })
    .catch((e) => {
      console.warn('[CopilotCliModels] falha ao listar modelos do CLI:', e.message);
      return null;
    })
    .finally(() => { inFlight = null; });
  return inFlight;
}

function getDefaultModel() {
  return DEFAULT_MODEL;
}

module.exports = {
  DEFAULT_MODEL, getModels, getCatalog, getDefaultModel, refresh,
  parseModelIdsFromHelpConfig,
};
