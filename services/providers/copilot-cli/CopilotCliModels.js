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

function formatCopilotLabel(id) {
  if (!id) return '';
  if (id === 'auto') return 'auto';
  const KNOWN_LABELS = {
    'claude-opus-5': 'Claude Opus 5',
    'claude-sonnet-5': 'Claude Sonnet 5',
    'claude-fable-5': 'Claude Fable 5',
    'claude-opus-4.8': 'Claude Opus 4.8',
    'claude-opus-4.8-fast': 'Claude Opus 4.8 Fast',
    'claude-opus-4.7': 'Claude Opus 4.7',
    'claude-sonnet-4.6': 'Claude Sonnet 4.6',
    'claude-opus-4.6': 'Claude Opus 4.6',
    'claude-sonnet-4.5': 'Claude Sonnet 4.5',
    'claude-opus-4.5': 'Claude Opus 4.5',
    'claude-haiku-4.5': 'Claude Haiku 4.5',
    'gpt-5.6-terra': 'GPT-5.6 Terra',
    'gpt-5.6-sol': 'GPT-5.6 Sol',
    'gpt-5.6-luna': 'GPT-5.6 Luna',
    'gpt-5.5': 'GPT-5.5',
    'gpt-5.4': 'GPT-5.4',
    'gpt-5.4-mini': 'GPT-5.4 Mini',
    'gpt-5.3-codex': 'GPT-5.3 Codex',
    'gpt-5-mini': 'GPT-5 Mini',
    'gemini-3.7-flash': 'Gemini 3.7 Flash',
    'gemini-3.6-flash': 'Gemini 3.6 Flash',
    'gemini-3.5-flash': 'Gemini 3.5 Flash',
    'gemini-3.1-pro-preview': 'Gemini 3.1 Pro Preview',
    'grok-4.6': 'Grok 4.6',
    'grok-4.5': 'Grok 4.5',
    'kimi-k3': 'Kimi K3',
    'kimi-k2.7-code': 'Kimi K2.7 Code',
    'mai-code-1.1-flash': 'MAI-Code-1.1-Flash',
    'mai-code-1-flash-picker': 'MAI-Code-1.1-Flash',
  };
  if (KNOWN_LABELS[id]) return KNOWN_LABELS[id];
  return id
    .split('-')
    .map((p) => {
      const low = p.toLowerCase();
      if (low === 'gpt') return 'GPT';
      if (low === 'mai') return 'MAI';
      return p.charAt(0).toUpperCase() + p.slice(1);
    })
    .join(' ');
}

function toModels(ids) {
  return ids.map((id) => ({ id, label: formatCopilotLabel(id) }));
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
  if (!models.some((m) => m.id === 'auto')) {
    models.unshift({ id: 'auto', label: 'auto' });
  }
  return models;
}

// O cache (memória e disco) guarda sempre o CATÁLOGO CRU. A filtragem por
// conta é aplicada na saída, nunca no que é gravado — assim um modelo que a
// org libere depois volta sozinho quando o registro expira, sem precisar
// invalidar o cache do catálogo.
async function getModels(force = false) {
  return modelAccess.filterModels(await getCatalog(force));
}

const DEFAULT_COPILOT_CATALOG = [
  { id: 'auto', label: 'auto' },
  { id: 'claude-opus-5', label: 'Claude Opus 5' },
  { id: 'claude-sonnet-5', label: 'Claude Sonnet 5' },
  { id: 'claude-fable-5', label: 'Claude Fable 5' },
  { id: 'claude-opus-4.8', label: 'Claude Opus 4.8' },
  { id: 'claude-opus-4.8-fast', label: 'Claude Opus 4.8 Fast' },
  { id: 'claude-opus-4.7', label: 'Claude Opus 4.7' },
  { id: 'claude-sonnet-4.6', label: 'Claude Sonnet 4.6' },
  { id: 'claude-opus-4.6', label: 'Claude Opus 4.6' },
  { id: 'claude-sonnet-4.5', label: 'Claude Sonnet 4.5' },
  { id: 'claude-opus-4.5', label: 'Claude Opus 4.5' },
  { id: 'claude-haiku-4.5', label: 'Claude Haiku 4.5' },
  { id: 'gpt-5.6-terra', label: 'GPT-5.6 Terra' },
  { id: 'gpt-5.6-sol', label: 'GPT-5.6 Sol' },
  { id: 'gpt-5.6-luna', label: 'GPT-5.6 Luna' },
  { id: 'gpt-5.5', label: 'GPT-5.5' },
  { id: 'gpt-5.4', label: 'GPT-5.4' },
  { id: 'gpt-5.4-mini', label: 'GPT-5.4 Mini' },
  { id: 'gpt-5.3-codex', label: 'GPT-5.3 Codex' },
  { id: 'gpt-5-mini', label: 'GPT-5 Mini' },
  { id: 'gemini-3.7-flash', label: 'Gemini 3.7 Flash' },
  { id: 'gemini-3.6-flash', label: 'Gemini 3.6 Flash' },
  { id: 'gemini-3.5-flash', label: 'Gemini 3.5 Flash' },
  { id: 'gemini-3.1-pro-preview', label: 'Gemini 3.1 Pro Preview' },
  { id: 'grok-4.6', label: 'Grok 4.6' },
  { id: 'grok-4.5', label: 'Grok 4.5' },
  { id: 'kimi-k3', label: 'Kimi K3' },
  { id: 'kimi-k2.7-code', label: 'Kimi K2.7 Code' },
  { id: 'mai-code-1.1-flash', label: 'MAI-Code-1.1-Flash' },
  { id: 'mai-code-1-flash-picker', label: 'MAI-Code-1.1-Flash' },
];

// Catálogo sem filtro (o que o binário conhece). Usado pelo seletor via
// getModels e pelo diagnóstico scripts/probe-copilot-models.js.
async function getCatalog(force = false) {
  if (!force && cachedModels && Date.now() - lastFetchTime < MEMORY_TTL) return cachedModels;

  const disk = readDiskCache();
  if (disk && !cachedModels && !force) {
    // Serve o último resultado bom na hora e revalida em segundo plano.
    cachedModels = disk;
    lastFetchTime = Date.now();
    refresh();
    return disk;
  }

  // Se force foi pedido ou não há cache, tenta buscar na hora
  if (force || (!disk && !cachedModels)) {
    try {
      const live = await refresh();
      if (live && live.length) return live;
    } catch (_) {}
  }

  if (cachedModels) return cachedModels;

  cachedModels = DEFAULT_COPILOT_CATALOG;
  lastFetchTime = Date.now();
  refresh();
  return DEFAULT_COPILOT_CATALOG;
}

function refresh() {
  if (inFlight) return inFlight;
  inFlight = fetchModels()
    .then((models) => {
      if (models && models.length) {
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
  parseModelIdsFromHelpConfig, formatCopilotLabel,
};
