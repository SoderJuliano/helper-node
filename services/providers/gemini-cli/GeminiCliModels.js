// Lista de modelos do Antigravity CLI (agy) — 100% dinâmica, lida do binário.
//
// FONTE: `agy models`, um ID por linha.
//
// NADA de lista escrita à mão aqui. A versão anterior tinha um KNOWN_MODELS com
// 11 nomes fixos que servia de FALLBACK quando o `agy` não respondia — e o
// resultado era a UI oferecendo 11 modelos de um CLI que podia nem estar
// instalado. Se o usuário escolhesse um, o envio quebrava depois, longe da
// causa. Nome de modelo escrito à mão envelhece sozinho e mente na tela.
//
// Se a sondagem falhar, devolvemos LISTA VAZIA — a UI avisa que não conseguiu
// listar, em vez de inventar. Mesmo contrato do CopilotCliModels/ClaudeCliModels.

const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const { resolveBinary } = require('./GeminiCliProcess');

// Sem modelo padrão escrito à mão: string vazia faz o GeminiCliProcess omitir
// o `--model` (ele só empurra a flag `if (model)`), e o próprio CLI escolhe.
const DEFAULT_MODEL = '';

const MEMORY_TTL = 5 * 60 * 1000;
const PROBE_TIMEOUT = 2500;

const DEFAULT_AGY_MODELS = [
  { id: 'gemini-2.5-flash', value: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash' },
  { id: 'gemini-2.5-pro', value: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro' },
  { id: 'claude-3-7-sonnet', value: 'claude-3-7-sonnet', label: 'Claude 3.7 Sonnet' },
  { id: 'gemini-2.5-ultra', value: 'gemini-2.5-ultra', label: 'Gemini 2.5 Ultra' }
];

let cachedModels = null;
let lastFetchTime = 0;
let inFlight = null;

function cacheFile() {
  try {
    const { app } = require('electron');
    return path.join(app.getPath('userData'), 'gemini-cli-models.json');
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
    console.warn('[GeminiCliModels] não consegui gravar cache:', e.message);
  }
}

function runAgy(bin, args, timeoutMs) {
  return new Promise((resolve) => {
    // Args são literais fixos, sem espaço nem aspas — aqui o shell do shim .cmd
    // não corrompe nada (diferente do prompt do usuário, ver CopilotCliProcess).
    const useShell = process.platform === 'win32' && /\.(cmd|bat)$/i.test(bin);
    const child = execFile(
      bin,
      args,
      { timeout: timeoutMs, windowsHide: true, shell: useShell, maxBuffer: 4 * 1024 * 1024 },
      (_err, stdout, stderr) => resolve(((stdout || '') + '\n' + (stderr || '')).trim())
    );
    // Sem isso o processo pode ficar esperando entrada e só sair no timeout.
    try { child.stdin && child.stdin.end(); } catch (_) {}
  });
}

// Converte o ID cru do CLI num rótulo legível ("gemini-3.5-flash-medium" →
// "Gemini 3.5 Flash (Medium)"). É só formatação do que o CLI devolveu: nenhum
// modelo é criado aqui, e ID desconhecido aparece cru, sem chute.
// Exportada para teste sem spawnar o binário.
function labelFromId(id) {
  const parts = String(id).split('-');
  const BRANDS = { gemini: 'Gemini', claude: 'Claude', gpt: 'GPT', grok: 'Grok', kimi: 'Kimi' };
  const brand = BRANDS[parts[0]];
  if (!brand) return id;

  const TIERS = new Set(['high', 'medium', 'low', 'thinking', 'fast', 'mini']);
  const tier = [];
  while (parts.length > 1 && TIERS.has(parts[parts.length - 1].toLowerCase())) {
    tier.unshift(parts.pop());
  }

  const cap = (w) => w.charAt(0).toUpperCase() + w.slice(1);
  let label = [brand, ...parts.slice(1).map(cap)].join(' ');
  if (tier.length) label += ` (${tier.map(cap).join(' ')})`;
  return label;
}

// Uma linha por modelo: extrai o ID (primeiro token) e o rótulo (se houver após espaço/tab).
// Exportada para teste sem spawnar o binário.
function parseModelIds(out) {
  if (!out) return [];
  const results = [];
  const seen = new Set();
  const cleaned = out.replace(/\x1B\[[0-9;]*[a-zA-Z]/g, '').replace(/\[[0-9;]*[a-zA-Z]/g, '');
  for (const raw of cleaned.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;

    const parts = line.split(/\s+/);
    const id = parts[0];

    if (!/^[a-z0-9][a-z0-9._-]*$/i.test(id)) continue;
    if (/^(fetching|available|loading|error|warning|models|usage)$/i.test(id)) continue;
    if (seen.has(id)) continue;
    seen.add(id);

    const rawLabel = parts.slice(1).join(' ').trim();
    const label = rawLabel || labelFromId(id);

    results.push({ id, value: id, label });
  }
  return results;
}

async function fetchModels() {
  const bin = await resolveBinary();
  if (!bin) return null;

  const out = await runAgy(bin, ['models'], PROBE_TIMEOUT);
  const models = parseModelIds(out);
  if (!models.length) return null;

  return models;
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
      console.warn('[GeminiCliModels] falha ao listar modelos do CLI:', e.message);
      return null;
    })
    .finally(() => { inFlight = null; });
  return inFlight;
}

async function getModels(force = false) {
  if (!force && cachedModels && Date.now() - lastFetchTime < MEMORY_TTL) return cachedModels;

  const disk = readDiskCache();
  if (disk && !cachedModels) {
    cachedModels = disk;
    lastFetchTime = Date.now();
    if (force) refresh();
    return disk;
  }

  if (cachedModels) return cachedModels;

  // Serve catálogo padrão instantaneamente (0ms) e revalida em segundo plano
  cachedModels = DEFAULT_AGY_MODELS;
  lastFetchTime = Date.now();
  refresh();
  return DEFAULT_AGY_MODELS;
}

function getDefaultModel() {
  return DEFAULT_MODEL;
}

module.exports = { DEFAULT_MODEL, getModels, getDefaultModel, refresh, parseModelIds, labelFromId };
