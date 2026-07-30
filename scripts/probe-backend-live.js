#!/usr/bin/env node
// PROBE AO VIVO — não é teste, é diagnóstico. Roda o MESMO backendService que o
// app roda, contra o servidor real, imprimindo timestamp em cada etapa.
//
// Existe porque "no terminal responde em 4s, no app nunca responde" só se
// resolve medindo o caminho do app, não o do curl. Uso:
//   node scripts/probe-backend-live.js            # só o classificador da KB
//   node scripts/probe-backend-live.js stream      # + o responderStream do modo IDE
//
// Stuba o 'electron' para o configService achar o config.json real do usuário
// (headless ele cai nos defaults e o probe mediria outra config).

const path = require('path');
const Module = require('module');

const userData = path.join(process.env.APPDATA, 'meu-electron-app');
const origResolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
  if (request === 'electron') return 'electron-stub';
  return origResolve.call(this, request, ...rest);
};
require.cache['electron-stub'] = {
  id: 'electron-stub',
  filename: 'electron-stub',
  loaded: true,
  exports: { app: { getPath: () => userData, getName: () => 'meu-electron-app' } },
};

const configService = require(path.join(__dirname, '..', 'services', 'configService'));
const BackendService = require(path.join(__dirname, '..', 'services', 'backendService'));

const t0 = Date.now();
const log = (...a) => console.log(`[+${((Date.now() - t0) / 1000).toFixed(1)}s]`, ...a);

async function main() {
  log('CONFIG REAL LIDA:');
  log('  aiModel            =', configService.getAiModel());
  log('  backendModel       =', configService.getBackendModel && configService.getBackendModel());
  log('  helperToolsEnabled =', configService.getHelperToolsEnabled && configService.getHelperToolsEnabled());
  log('  workspaceAccess    =', configService.getWorkspaceAccessEnabled && configService.getWorkspaceAccessEnabled());
  log('  knowledgeBase      =', JSON.stringify(configService.getKnowledgeBaseConfig()));
  log('  promptInstruction  =', (configService.getPromptInstruction() || '').length, 'chars');

  const url = await BackendService.getLastEnvUrl();
  log('URL do backend       =', url);

  // ── ETAPA 1: o classificador da knowledge base ────────────────────────────
  // helpers.ollamaNeedsKnowledge faz ISTO antes de qualquer stream, nos DOIS
  // modos (backend e ollama local). Se travar aqui, a tela fica vazia sem erro.
  const pergunta = 'leia o diretorio do projeto e me diga o que ele faz';
  log('ETAPA 1 — classificador KB (BackendService.responder) começando...');
  try {
    const r = await BackendService.responder(
      `Pergunta do candidato/interlocutor: "${pergunta}"\n\n` +
      `Responda APENAS com SIM ou NAO: essa fala precisa de informação ATUALIZADA ` +
      `sobre tecnologias, versões de libs/frameworks ou mercado recente pra ser bem respondida?`,
      { sessionId: 'kb-classifier', instruction: 'Você é um classificador binário. Responda SOMENTE com SIM ou NAO, nada mais.' }
    );
    log('ETAPA 1 OK — resposta:', JSON.stringify(String(r).slice(0, 200)));
  } catch (e) {
    log('ETAPA 1 FALHOU:', e.message);
  }

  if (process.argv[2] !== 'stream') { log('FIM (passe "stream" pra medir a etapa 2)'); return; }

  // ── ETAPA 2: o stream do modo IDE com ferramentas ─────────────────────────
  const tools = [
    { function: { name: 'listDir', description: 'lista pasta', parameters: { properties: { path: { type: 'string' } } } } },
    { function: { name: 'readFile', description: 'le arquivo', parameters: { properties: { path: { type: 'string' } } } } },
  ];
  log('ETAPA 2 — responderStream (modo IDE, com tools) começando...');
  let primeiroChunk = null;
  await new Promise((resolve) => {
    BackendService.responderStream(
      pergunta,
      (chunk) => {
        if (primeiroChunk === null) { primeiroChunk = Date.now(); log('1º CHUNK recebido'); }
        const txt = typeof chunk === 'string' ? chunk : `[${chunk.type}] ${chunk.text}`;
        process.stdout.write(String(txt).slice(0, 120));
      },
      () => { log('\nETAPA 2 COMPLETA'); resolve(); },
      (err) => { log('\nETAPA 2 ERRO:', err && err.message); resolve(); },
      {
        sessionId: 'probe-ide',
        tools,
        // Resultado REAL (não stub): com stub o modelo não tem como progredir e
        // repetir a chamada seria culpa do probe, não do app.
        onToolCall: async (name, args) => {
          const fs = require('fs');
          let alvo = String((args && (args.path || args.dir)) || process.cwd());
          alvo = alvo.replace(/^\/([A-Za-z]:)/, '$1'); // "/C:/x" → "C:/x"
          log(`  → tool ${name}(${alvo})`);
          try {
            if (name === 'listDir') {
              return { ok: true, path: alvo, entries: fs.readdirSync(alvo).slice(0, 40) };
            }
            if (name === 'readFile') {
              return { ok: true, path: alvo, content: fs.readFileSync(alvo, 'utf8').slice(0, 2000) };
            }
            return { ok: false, error: `probe nao implementa ${name}` };
          } catch (e) {
            return { ok: false, error: e.message };
          }
        },
        maxToolCalls: 6,
      }
    );
  });
}

main().catch((e) => { log('EXPLODIU:', e && e.stack); process.exit(1); });
