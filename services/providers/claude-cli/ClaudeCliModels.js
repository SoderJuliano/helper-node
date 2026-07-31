// Lista de modelos do Claude Code CLI.
//
// NADA aqui é hardcoded: a lista é sempre a que o próprio binário `claude`
// reporta na máquina do usuário. São dois passos, ambos via slash command:
//
//   1) `claude --print "/model"`        -> "Usage: /model <name>. Available: sonnet, opus, ..."
//   2) `claude --print "/model <alias>" -> "Set model to Opus 5 for this session only"
//
// O passo 2 é o que dá o nome de exibição real ("Opus 5", "Haiku 4.5"), ou seja,
// exatamente o que aparece no seletor `/model` do terminal.
//
// Armadilhas que já quebraram isso antes (não regredir):
//   - Montar o comando como string e rodar via `cmd.exe /c "... \"/model x\" ..."`:
//     o cmd.exe não trata `\"` como escape, o argumento chega partido e o CLI
//     interpreta `/model x` como PROMPT, respondendo em prosa. Nenhum regex casa
//     e o label degrada para o alias cru. Por isso aqui é execFile + argv.
//   - stdin aberto: sem `--print` lendo EOF o processo fica pendurado. Fechamos stdin.
//   - Timeout curto + N spawns simultâneos: o binário tem ~265 MB e demora ~1,7 s por
//     chamada; disparar 10 de uma vez estoura o timeout e some com a lista.
const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const { resolveBinary } = require('./ClaudeCliProcess');

// Só usado quando o binário não responde e não existe cache em disco. São aliases,
// não nomes de modelo — nunca inventamos versão ("Sonnet 5") que o CLI não confirmou.
const FALLBACK_ALIASES = ['sonnet', 'opus', 'haiku'];
const DEFAULT_MODEL = 'sonnet';

const MEMORY_TTL = 5 * 60 * 1000;
const LIST_TIMEOUT = 20000;
const RESOLVE_TIMEOUT = 20000;
const CONCURRENCY = 3;

let cachedModels = null;
let lastFetchTime = 0;
let inFlight = null;

function cacheFile() {
  try {
    const { app } = require('electron');
    return path.join(app.getPath('userData'), 'claude-cli-models.json');
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
    console.warn('[ClaudeCliModels] não consegui gravar cache:', e.message);
  }
}

// execFile com argv: o alias viaja como UM argumento, sem passar por parser de shell.
function runClaude(bin, promptArg, timeoutMs) {
  return new Promise((resolve) => {
    // Shim .cmd/.bat do npm precisa de shell; instalação nativa (.exe) roda direto.
    const useShell = process.platform === 'win32' && /\.(cmd|bat)$/i.test(bin);
    const child = execFile(
      bin,
      ['--print', promptArg],
      { timeout: timeoutMs, windowsHide: true, shell: useShell, maxBuffer: 1024 * 1024 },
      (_err, stdout, stderr) => resolve(((stdout || '') + (stderr || '')).trim())
    );
    // Sem isso o CLI pode ficar esperando entrada e só sair no timeout.
    try { child.stdin && child.stdin.end(); } catch (_) {}
  });
}

function parseAliases(stdout) {
  const match = stdout.match(/Available:\s*(.+)$/m);
  if (!match) return [];
  return match[1]
    .replace(/\bor\s+a\s+full\s+model\s+ID\.?/i, '')
    .split(',')
    .map(s => s.trim().replace(/[.\s]+$/, ''))
    .filter(Boolean);
}

// Extrai o nome de exibição a partir da resposta do slash command.
// Retorna null quando o alias não está disponível na conta ou a saída não é
// reconhecível (ex.: o CLI respondeu em prosa porque o argumento chegou torto).
function parseModelName(out) {
  if (!out) return null;
  if (/is not available for your account/i.test(out)) return null;

  // "Set model to Opus 5 for this session only" / "... Sonnet 5 (default) ..."
  const set = out.match(/Set model to\s+(.+?)\s+for this session/i);
  if (set) return set[1].trim();

  // "Fable 5 uses usage credits and needs a one-time consent · ..."
  const credits = out.match(/^(.+?)\s+uses usage credits/i);
  if (credits) return credits[1].trim();

  return null;
}

// O seletor `/model` do terminal lista só os modelos "simples". Aliases compostos
// de roteamento (ex.: "Opus in plan mode, else Sonnet") ficam de fora. Detectamos
// pela forma do nome que o próprio CLI devolveu, sem lista fixa de exclusão.
function isPlainModelName(name) {
  if (/\s(in|else|then)\s/i.test(name)) return false;
  return name.replace(/\(default\)/i, '').trim().split(/\s+/).length <= 3;
}

async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (i < items.length) {
        const idx = i++;
        out[idx] = await fn(items[idx]);
      }
    })
  );
  return out;
}

async function fetchModels() {
  const bin = await resolveBinary();
  if (!bin) return null;

  const aliases = parseAliases(await runClaude(bin, '/model', LIST_TIMEOUT));
  if (!aliases.length) return null;

  // Variantes de contexto estendido (`sonnet[1m]`) não aparecem no seletor do CLI.
  const candidates = aliases.filter(a => !a.includes('['));

  const resolved = await mapLimit(candidates, CONCURRENCY, async (id) => {
    const name = parseModelName(await runClaude(bin, `/model ${id}`, RESOLVE_TIMEOUT));
    return name ? { id, label: name } : null;
  });

  const models = [];
  const seen = new Set();
  for (const m of resolved) {
    if (!m || !isPlainModelName(m.label)) continue;
    // `default` é uma entrada própria no seletor do CLI ("Default (recommended)"),
    // mesmo apontando para o mesmo modelo que outro alias — não pode cair na dedup.
    if (m.id !== 'default') {
      // Já `best` resolve para o mesmo modelo de outro alias e o seletor mostra só uma vez.
      const key = m.label.replace(/\s*\(default\)/i, '').toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
    }
    models.push(m);
  }

  if (!models.length) return null;

  // Mesma ordem do seletor: o padrão primeiro.
  models.sort((a, b) => (b.id === 'default' ? 1 : 0) - (a.id === 'default' ? 1 : 0));
  return models;
}

async function getModels() {
  if (cachedModels && Date.now() - lastFetchTime < MEMORY_TTL) return cachedModels;

  const disk = readDiskCache();
  if (disk && !cachedModels) {
    // Serve o último resultado bom na hora e revalida em segundo plano, para a
    // primeira abertura das Configurações não travar ~10 s esperando o CLI.
    cachedModels = disk;
    lastFetchTime = Date.now();
    refresh();
    return disk;
  }

  return (await refresh()) || cachedModels || disk || FALLBACK_ALIASES.map(id => ({ id, label: id }));
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
      console.warn('[ClaudeCliModels] falha ao listar modelos do CLI:', e.message);
      return null;
    })
    .finally(() => { inFlight = null; });
  return inFlight;
}

function getDefaultModel() {
  return DEFAULT_MODEL;
}

module.exports = { DEFAULT_MODEL, getModels, getDefaultModel, refresh };
