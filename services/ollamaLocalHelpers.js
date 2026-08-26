// services/ollamaLocalHelpers.js
const { stripToolCallBlocks } = require('./ollamaLocalParsing');

const DEFAULT_HOST = 'http://localhost:11434';
const SEM_TOOLS_NATIVAS = '__OLLAMA_SEM_TOOLS_NATIVAS__';

const DEFAULT_MIN_NUM_CTX = 4096;
const DEFAULT_MAX_NUM_CTX = 32768;
const CHARS_PER_TOKEN = 3.0;
const OUTPUT_HEADROOM_TOKENS = 2048;

function envCtx(nome, padrao) {
  const raw = parseInt(process.env[nome] || '', 10);
  return Number.isFinite(raw) && raw > 0 ? raw : padrao;
}

function resolveNumCtx(promptChars) {
  const floor = envCtx('HELPER_OLLAMA_MIN_CTX', DEFAULT_MIN_NUM_CTX);
  const cap = Math.max(envCtx('HELPER_OLLAMA_MAX_CTX', DEFAULT_MAX_NUM_CTX), floor);
  const estimated = Math.ceil((promptChars || 0) / CHARS_PER_TOKEN) + OUTPUT_HEADROOM_TOKENS;
  let ctx = floor;
  while (ctx < estimated && ctx < cap) ctx *= 2;
  return Math.min(ctx, cap);
}

function promptCharsOf(messages) {
  if (!Array.isArray(messages)) return 0;
  return messages.reduce((n, m) => n + String((m && m.content) || '').length, 0);
}

function normalizarChamadasNativas(toolCalls) {
  const out = [];
  for (const tc of toolCalls || []) {
    const fn = (tc && tc.function) || tc;
    if (!fn || !fn.name) continue;
    let args = fn.arguments != null ? fn.arguments : fn.args;
    if (typeof args === 'string') {
      try { args = JSON.parse(args); } catch (_) { args = {}; }
    }
    out.push({ name: fn.name, args: args || {} });
  }
  return out;
}

function normalizarChamadasTexto(calls) {
  return calls.map((c) => ({ name: c.obj.name, args: c.obj.args || c.obj.arguments || {} }));
}

function limparProtocolo(texto, nativeTools) {
  return nativeTools ? String(texto || '') : stripToolCallBlocks(texto);
}

const SUFIXO_FOLLOWUP =
  '\n\nCom base nos TOOL_RESULT acima, ou emita novos TOOL_CALL se precisar de ' +
  'mais info, ou escreva a RESPOSTA FINAL ao usuario (sem nenhum TOOL_CALL).';

function cobrancaRepeticao(chamadas, contagens) {
  let texto = '';
  for (const c of chamadas) {
    const assinatura = `${c.name}:${JSON.stringify(c.args || {})}`;
    const n = (contagens.get(assinatura) || 0) + 1;
    contagens.set(assinatura, n);
    if (n >= 3) {
      texto = `\n\nPARE. Você já chamou ${c.name} com esses mesmos argumentos ${n} vezes ` +
        `e o resultado está acima. NÃO repita essa chamada. Responda AGORA em texto ` +
        `normal, com o que você já descobriu.`;
    } else if (n === 2) {
      texto = '\n\nATENÇÃO: essa chamada é repetida — o resultado já está no histórico ' +
        'acima. Use o que já tem e dê o PRÓXIMO passo (outra ferramenta, outro path) ' +
        'ou responda em texto.';
    }
  }
  return texto;
}

function classifyOllamaError(err, model) {
  const code = err && err.code;
  const status = err && err.response && err.response.status;
  const body = err && err.response && err.response.data;
  if (code === 'ECONNREFUSED' || code === 'ENOTFOUND' || code === 'EHOSTUNREACH') {
    return [
      '⚠️ **Ollama Local não está rodando.**',
      '',
      'Verifique se você instalou e iniciou o Ollama:',
      '',
      '```bash',
      '# Instalar (Linux):',
      'curl -fsSL https://ollama.com/install.sh | sh',
      '',
      '# Iniciar serviço:',
      'ollama serve',
      '',
      '# Ou em outro terminal, baixar o modelo selecionado:',
      `ollama pull ${model}`,
      '```',
      '',
      'Mais detalhes em: https://ollama.com/download',
      '',
      'Depois, volte e tente novamente. Se preferir, troque o provider em **Configurações** pra ChatGPT.',
    ].join('\n');
  }
  const msg = (body && (body.error || body.message)) || '';
  if (status === 404 || /not found|no such model|pull/i.test(String(msg))) {
    return [
      `⚠️ **Modelo \`${model}\` não está baixado localmente.**`,
      '',
      'Rode no terminal:',
      '',
      '```bash',
      `ollama pull ${model}`,
      '```',
      '',
      'O download pode demorar alguns minutos (4–9 GB dependendo do modelo).',
      'Você pode acompanhar o progresso no terminal.',
    ].join('\n');
  }
  if (code === 'ECONNABORTED' || /timeout/i.test(String(err && err.message))) {
    return [
      `⚠️ **Ollama Local demorou demais pra responder.**`,
      '',
      'Possíveis causas:',
      `- Modelo \`${model}\` muito pesado pra sua GPU/CPU`,
      '- Primeira execução (Ollama está carregando o modelo na RAM)',
      '',
      'Tente um modelo menor nas Configurações ou aguarde e refaça a pergunta.',
    ].join('\n');
  }
  return [
    '⚠️ **Erro ao chamar Ollama Local.**',
    '',
    `Detalhe: ${(err && err.message) || 'desconhecido'}${msg ? ` — ${msg}` : ''}`,
    '',
    'Verifique se `ollama serve` está rodando e tente novamente.',
  ].join('\n');
}

module.exports = {
  DEFAULT_HOST,
  SEM_TOOLS_NATIVAS,
  SUFIXO_FOLLOWUP,
  resolveNumCtx,
  promptCharsOf,
  normalizarChamadasNativas,
  normalizarChamadasTexto,
  limparProtocolo,
  cobrancaRepeticao,
  classifyOllamaError,
};
