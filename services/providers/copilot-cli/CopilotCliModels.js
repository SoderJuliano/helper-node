// Lista dinâmica de modelos da GitHub Copilot CLI.
//
// A sondagem é feita passando uma flag de modelo inválida (`--model __probe_invalid_model__`).
// O binário da Copilot CLI v1.0.77+ imprime a lista/tabela de modelos disponíveis para a conta
// do usuário:
//
//   Model                        Context    Reasoning
// ❯ Auto                         —          —
//   Claude Sonnet 5 (default) ✓  264K       Medium
//   Claude Sonnet 4.6            264K       Medium
//   Claude Sonnet 4.5            —          —
//   Claude Haiku 4.5             —          —
//   GPT-5.6 Terra                400K       Medium
//   GPT-5.6 Luna                 328K       Medium
//
// A função `parseCopilotModels` extrai essas linhas, mantendo o label e gerando os IDs limpos.
// Resultados são salvos no cache em disco (`copilot-cli-models.json`).

const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const { resolveBinary, getEnrichedEnv } = require('./CopilotCliProcess');

const FALLBACK_MODELS = [
  { id: 'auto',              label: 'Auto' },
  { id: 'claude-sonnet-5',   label: 'Claude Sonnet 5 (default)' },
  { id: 'claude-sonnet-4.6', label: 'Claude Sonnet 4.6' },
  { id: 'claude-sonnet-4.5', label: 'Claude Sonnet 4.5' },
  { id: 'claude-haiku-4.5',  label: 'Claude Haiku 4.5' },
  { id: 'gpt-5.6-terra',     label: 'GPT-5.6 Terra' },
  { id: 'gpt-5.6-luna',      label: 'GPT-5.6 Luna' },
];

const DEFAULT_MODEL = 'auto';

const MEMORY_TTL = 5 * 60 * 1000;
const PROBE_TIMEOUT = 15000;

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

function runCopilotProbe(bin) {
  return new Promise((resolve) => {
    const useShell = process.platform === 'win32' && /\.(cmd|bat)$/i.test(bin);
    const env = getEnrichedEnv ? getEnrichedEnv() : process.env;
    const child = execFile(
      bin,
      ['--model', '__probe_invalid_model__'],
      { timeout: PROBE_TIMEOUT, windowsHide: true, shell: useShell, maxBuffer: 1024 * 1024, env },
      (_err, stdout, stderr) => resolve(((stdout || '') + '\n' + (stderr || '')).trim())
    );
    try { child.stdin && child.stdin.end(); } catch (_) {}
  });
}

function parseCopilotModels(stdout) {
  if (!stdout) return [];
  const lines = stdout.split(/\r?\n/);
  const models = [];
  const seen = new Set();
  
  let inTable = false;
  for (let line of lines) {
    const cleanLine = line.replace(/\u001b\[[0-9;]*[a-zA-Z]/g, '').trimEnd();
    
    if (/Model\s+Context\s+Reasoning/i.test(cleanLine)) {
      inTable = true;
      continue;
    }
    
    if (inTable) {
      const trimmed = cleanLine.trim();
      if (!trimmed || /^───|^===|^╭|^╰/.test(trimmed)) {
        if (models.length > 0) inTable = false;
        continue;
      }
      
      let content = cleanLine.replace(/^[❯\s]+/, '').trim();
      if (!content) continue;
      
      const parts = content.split(/\s{2,}/);
      if (parts.length >= 1) {
        const rawModelCol = parts[0].trim();
        if (!rawModelCol || /^Model$/i.test(rawModelCol)) continue;
        
        const label = rawModelCol.replace(/✓/g, '').trim();
        let id = rawModelCol
          .replace(/\(default\)/gi, '')
          .replace(/✓/g, '')
          .trim()
          .toLowerCase()
          .replace(/\s+/g, '-');
          
        if (id && !seen.has(id)) {
          seen.add(id);
          models.push({ id, label });
        }
      }
    }
  }
  
  return models;
}

async function fetchModels() {
  const bin = await resolveBinary();
  if (!bin) return null;

  const output = await runCopilotProbe(bin);
  const models = parseCopilotModels(output);
  
  if (models && models.length > 0) {
    return models;
  }
  return null;
}

async function getModels() {
  if (cachedModels && Date.now() - lastFetchTime < MEMORY_TTL) return cachedModels;

  const disk = readDiskCache();
  if (disk && !cachedModels) {
    cachedModels = disk;
    lastFetchTime = Date.now();
    refresh();
    return disk;
  }

  return (await refresh()) || cachedModels || disk || FALLBACK_MODELS;
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
      console.warn('[CopilotCliModels] falha ao sondar modelos do CLI:', e.message);
      return null;
    })
    .finally(() => { inFlight = null; });
  return inFlight;
}

function getDefaultModel() {
  return DEFAULT_MODEL;
}

module.exports = { DEFAULT_MODEL, getModels, getDefaultModel, refresh, parseCopilotModels };
