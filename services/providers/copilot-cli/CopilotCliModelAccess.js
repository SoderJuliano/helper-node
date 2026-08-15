// Quais modelos do Copilot a SUA conta/organização não libera.
//
// O `copilot help config` (fonte da lista em CopilotCliModels.js) imprime o
// catálogo que o BINÁRIO conhece, não o que a sua conta pode usar — por isso o
// seletor mostrava dezenas de modelos que a org bloqueia. Não existe, no CLI
// 1.0.78/79, nenhum comando não-interativo que devolva a lista já filtrada
// (`copilot --help` não tem `models list`; o picker `/model` só existe no TUI).
//
// Então a filtragem é aprendida do próprio CLI: quando um modelo não está
// liberado, ele avisa no output e cai em outro —
//
//     Model "gpt-5.4" is not available. Using "claude-sonnet-5" instead.
//
// Esse aviso é registrado aqui e o modelo some do seletor daquele momento em
// diante. O modelo citado no "Using ... instead" é, pela mesma mensagem, um
// modelo LIBERADO — registramos como bom para nunca escondê-lo por engano.
//
// Os registros expiram (TTL): se o admin liberar um modelo depois, ele volta
// sozinho ao seletor em vez de ficar escondido pra sempre.
//
// ⚠️ Isto é reativo: um modelo bloqueado só some depois de ser tentado uma vez.
// A fonte autoritativa seria a sessão autenticada do `copilot --acp`, que
// devolveria a lista já filtrada sem tentativa e erro — ver
// scripts/probe-copilot-models.js, que verifica se essa versão do CLI expõe
// isso. Enquanto não confirmado contra um CLI logado, não dá pra escrever esse
// cliente sem adivinhar o schema.

const fs = require('fs');
const path = require('path');

// 30 dias: tempo de sobra pra não reperguntar toda hora, e curto o bastante
// pra que liberar um modelo na org apareça sem precisar limpar nada na mão.
const TTL_MS = 30 * 24 * 60 * 60 * 1000;

let cache = null; // { blocked: { id: ts }, allowed: { id: ts } }

function storeFile() {
  try {
    const { app } = require('electron');
    return path.join(app.getPath('userData'), 'copilot-cli-model-access.json');
  } catch (_) {
    return null;
  }
}

function load() {
  if (cache) return cache;
  cache = { blocked: {}, allowed: {} };
  const f = storeFile();
  if (!f) return cache;
  try {
    const raw = JSON.parse(fs.readFileSync(f, 'utf8'));
    if (raw && typeof raw === 'object') {
      cache.blocked = raw.blocked && typeof raw.blocked === 'object' ? raw.blocked : {};
      cache.allowed = raw.allowed && typeof raw.allowed === 'object' ? raw.allowed : {};
    }
  } catch (_) {}
  return cache;
}

function save() {
  const f = storeFile();
  if (!f || !cache) return;
  try {
    fs.writeFileSync(f, JSON.stringify(cache, null, 2));
  } catch (e) {
    console.warn('[CopilotCliModelAccess] não consegui gravar:', e.message);
  }
}

function fresh(ts) {
  return typeof ts === 'number' && Date.now() - ts < TTL_MS;
}

// Lê o aviso do CLI. Devolve { blocked, fallback } — qualquer um pode ser null.
// Exportada pra ser testável sem spawnar o binário.
//
// O texto vem com códigos ANSI quando o CLI acha que tem terminal; a limpeza
// tem que vir antes do regex, senão o aspas-id não casa.
function parseUnavailableNotice(text) {
  if (!text) return { blocked: null, fallback: null };
  const limpo = String(text).replace(/[[0-9;]*[a-zA-Z]/g, '');

  // Ancorado no par aspas+"is not available": é a frase exata do CLI. Um regex
  // mais frouxo pegaria a resposta do próprio modelo falando sobre modelos.
  const m = limpo.match(/Model\s+"([^"]+)"[^"\n]*?is not available/i);
  if (!m) return { blocked: null, fallback: null };

  const blocked = m[1].trim();
  const f = limpo.slice(m.index).match(/Using\s+"([^"]+)"\s+instead/i);
  const fallback = f ? f[1].trim() : null;
  return { blocked: blocked || null, fallback };
}

// Chamado com o output cru de cada execução do Copilot CLI.
// Devolve o que aprendeu, pra quem chamou poder reagir (ex.: trocar o modelo
// selecionado nas configurações).
function learnFromOutput(text) {
  const { blocked, fallback } = parseUnavailableNotice(text);
  if (!blocked && !fallback) return { blocked: null, fallback: null };

  const c = load();
  if (fallback) {
    // O CLI só cai num modelo que a conta pode usar — sinal positivo confiável.
    c.allowed[fallback] = Date.now();
    delete c.blocked[fallback];
  }
  // 'auto' nunca é bloqueado: é o próprio CLI escolhendo, e esconder o 'auto'
  // deixaria o usuário sem a opção segura.
  if (blocked && blocked !== 'auto' && blocked !== fallback) {
    c.blocked[blocked] = Date.now();
    delete c.allowed[blocked];
    console.log(`[CopilotCliModelAccess] "${blocked}" indisponível pra esta conta — escondendo do seletor.`);
  }
  save();
  return { blocked, fallback };
}

function blockedIds() {
  const c = load();
  return Object.keys(c.blocked).filter((id) => fresh(c.blocked[id]));
}

// Tira do catálogo os modelos que a conta recusou.
// NUNCA devolve lista vazia: se o filtro comeria tudo (registro estragado,
// catálogo trocado), devolve o catálogo cru — melhor mostrar demais do que
// deixar o usuário sem nenhum modelo pra escolher.
function filterModels(models) {
  if (!Array.isArray(models) || !models.length) return models;
  const bloqueados = new Set(blockedIds());
  if (!bloqueados.size) return models;
  const filtrados = models.filter((m) => !bloqueados.has(m && m.id));
  return filtrados.length ? filtrados : models;
}

function isBlocked(id) {
  return blockedIds().includes(id);
}

// Pro usuário poder desfazer (ex.: a org liberou e ele não quer esperar o TTL).
function reset() {
  cache = { blocked: {}, allowed: {} };
  save();
}

module.exports = {
  parseUnavailableNotice,
  learnFromOutput,
  filterModels,
  blockedIds,
  isBlocked,
  reset,
  TTL_MS,
};
