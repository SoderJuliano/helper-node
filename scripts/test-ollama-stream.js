#!/usr/bin/env node
process.env.TESTING = 'true';
// Regressão do MODO IDE offline (Ollama Local com ferramentas).
//
// Cobre o que o modo offline não tinha e por isso não funcionava:
//   1. TOOL CALLING NATIVO — tools[] no /api/chat e message.tool_calls tipado,
//      quando o /api/show diz que o modelo suporta. Antes só existia o
//      protocolo de TEXTO, que é o que faz o modelo pensante ensaiar a chamada
//      no raciocínio e nunca emitir.
//   2. FALLBACK — modelo sem a capability continua no protocolo de texto.
//   3. PROMPT ÚNICO — em modo IDE vai o prompt de agente (idePrompt.js), e NÃO
//      o prompt de copiloto de tela empilhado com o addon de ferramentas.
//   4. GATE DE ESCRITA POR TAMANHO — 7B não recebe writeFile; 35B recebe.
//
// Roda com: node ./scripts/test-ollama-stream.js   (npm run test:ollama:ide)

const http = require('http');
const path = require('path');
const configService = require(path.join(__dirname, '..', 'services', 'configService'));
const caps = require(path.join(__dirname, '..', 'services', 'ollamaLocalCaps'));
const OllamaLocalService = require(path.join(__dirname, '..', 'services', 'ollamaLocalService'));

let testHost = 'http://localhost:11434';
let modelo = 'test-model';
configService.getOllamaLocalHost = () => testHost;
configService.getOllamaLocalModel = () => modelo;
// O turno não pode depender do config real da máquina de quem roda o teste.
configService.getWorkspaceAccessEnabled = () => true;
configService.getPromptInstruction = () => 'PROMPT DE COPILOTO DE TELA: no máximo 65 palavras, não descreva a tela.';

// O que o "Ollama" responde neste cenário.
let cenario = 'texto';
let suportaTools = false;
let tamanho = '7.6B';
const chats = [];   // corpos dos POST /api/chat

const linha = (o) => JSON.stringify(o) + '\n';

const server = http.createServer((req, res) => {
  if (req.url.endsWith('/api/ps')) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ models: [] }));
    return;
  }

  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    if (req.url.endsWith('/api/show')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        capabilities: suportaTools ? ['completion', 'tools', 'thinking'] : ['completion', 'thinking'],
        details: { parameter_size: tamanho },
      }));
      return;
    }

    const parsed = JSON.parse(body || '{}');
    chats.push(parsed);
    const rodada = chats.length;
    res.writeHead(200, { 'Content-Type': 'application/x-ndjson' });

    if (cenario === 'nativo') {
      if (rodada === 1) {
        res.write(linha({ message: { role: 'assistant', thinking: 'Preciso ver o config.' } }));
        res.write(linha({ message: { role: 'assistant', content: 'Vou ler o arquivo de configuração.' } }));
        res.write(linha({
          message: {
            role: 'assistant',
            tool_calls: [{ function: { name: 'readFile', arguments: { path: '/tmp/config.json' } } }],
          },
        }));
      } else {
        res.write(linha({ message: { role: 'assistant', content: 'O arquivo de configuração está correto.' } }));
      }
    } else if (rodada === 1) {
      res.write(linha({ message: { role: 'assistant', content: '<think>' } }));
      res.write(linha({ message: { role: 'assistant', content: 'Pensando se chamo ferramenta...\n' } }));
      res.write(linha({ message: { role: 'assistant', content: 'Sim, vou ler o arquivo.' } }));
      res.write(linha({ message: { role: 'assistant', content: '</think>' } }));
      res.write(linha({ message: { role: 'assistant', content: 'TOOL_CALL: {"name":"readFile","args":{"path":"/tmp/config.json"}}' } }));
    } else {
      res.write(linha({ message: { role: 'assistant', content: 'O arquivo de configuração está correto.' } }));
    }

    res.write(linha({ done: true, done_reason: 'stop' }));
    res.end();
  });
});

const ferramentas = [
  { function: { name: 'readFile', description: 'le arquivo', parameters: { properties: { path: { type: 'string' } } } } },
  { function: { name: 'writeFile', description: 'escreve arquivo', parameters: { properties: { path: { type: 'string' } } } } },
  { function: { name: 'runCommand', description: 'roda comando', parameters: { properties: { cmd: { type: 'string' } } } } },
];

function rodar(texto, opts = {}) {
  const executadas = [];
  const pensamento = [];
  const visivel = [];
  return new Promise((resolve) => {
    OllamaLocalService.responderStream(
      texto,
      (chunk) => {
        if (chunk && typeof chunk === 'object' && chunk.type === 'thinking') pensamento.push(chunk.text);
        else if (typeof chunk === 'string') visivel.push(chunk);
      },
      () => resolve({ executadas, pensamento: pensamento.join(''), visivel: visivel.join('') }),
      (e) => { console.error('  (onError):', e.message.slice(0, 200)); resolve({ executadas, pensamento: pensamento.join(''), visivel: visivel.join(''), erro: e.message }); },
      {
        tools: ferramentas,
        onToolCall: async (name, args) => { executadas.push({ name, args }); return { ok: true, result: '{"status":"ok"}' }; },
        sessionId: 'ide-' + Math.random(),
        maxToolCalls: 5,
        ...opts,
      }
    );
  });
}

let falhas = 0;
const assert = (cond, msg) => {
  if (!cond) falhas++;
  console.log(`  ${cond ? 'ok  ' : 'FALHA'} ${msg}`);
};

server.listen(0, '127.0.0.1', async () => {
  testHost = `http://127.0.0.1:${server.address().port}`;

  console.log('1) modelo COM tools nativas (qwen3.6:35b) — protocolo tipado');
  cenario = 'nativo'; suportaTools = true; tamanho = '35.2B'; modelo = 'qwen3.6:35b';
  caps.invalidate();
  chats.length = 0;
  let r = await rodar('verifica o config');
  assert(!r.erro, `sem erro (${r.erro || 'ok'})`);
  assert(chats.length === 2, `iterou o tool loop (rodadas=${chats.length})`);
  assert(Array.isArray(chats[0].tools) && chats[0].tools.length === 3, `mandou tools[] no /api/chat (${chats[0].tools ? chats[0].tools.length : 0})`);
  assert(r.executadas.length === 1 && r.executadas[0].name === 'readFile', `executou readFile (${JSON.stringify(r.executadas)})`);
  assert(r.executadas[0] && r.executadas[0].args.path === '/tmp/config.json', 'argumentos tipados chegaram inteiros');
  assert(r.pensamento.includes('Preciso ver o config'), 'raciocínio (message.thinking) foi pra tela');
  assert(r.visivel.includes('Vou ler o arquivo'), 'texto do modelo apareceu ANTES da ferramenta rodar');
  assert(r.visivel.includes('configuração está correto'), 'resposta final chegou à tela');
  assert(!/configuração está correto[\s\S]*configuração está correto/.test(r.visivel), `resposta final não saiu duplicada (${JSON.stringify(r.visivel)})`);
  // A 2ª rodada precisa carregar o resultado como mensagem de papel "tool".
  const msgs2 = chats[1].messages;
  assert(msgs2.some((m) => m.role === 'tool'), 'resultado voltou como role:"tool"');
  assert(msgs2.some((m) => m.role === 'assistant' && Array.isArray(m.tool_calls)), 'a chamada ficou no histórico como tool_calls');

  console.log('2) prompt do modo IDE (não é o copiloto de tela empilhado)');
  const sistema = chats[0].messages[0];
  assert(sistema.role === 'system', 'primeira mensagem é o system');
  assert(/AGENTE DE CODIFICAÇÃO/.test(sistema.content), 'usou o prompt de agente (idePrompt.js)');
  assert(!/65 palavras/.test(sistema.content), 'o prompt de copiloto de tela NÃO foi empilhado');
  assert(!/TOOL_CALL:/.test(sistema.content), 'no modo nativo o protocolo de texto sai do prompt');

  console.log('3) escrita liberada em modelo grande, bloqueada em modelo pequeno');
  assert(chats[0].tools.some((t) => (t.function || t).name === 'writeFile'), '35B recebeu writeFile');

  cenario = 'texto'; suportaTools = false; tamanho = '7.6B'; modelo = 'qwen2.5-coder:7b';
  caps.invalidate();
  chats.length = 0;
  r = await rodar('verifica o config');
  assert(!r.erro, `sem erro (${r.erro || 'ok'})`);
  const nomes = (chats[0].messages[0].content.match(/- (\w+)\(/g) || []).join(' ');
  assert(!/writeFile/.test(nomes), `7B NÃO recebeu writeFile (schema em texto: ${nomes.trim()})`);

  console.log('4) modelo SEM tools nativas — cai no protocolo de texto');
  assert(chats[0].tools === undefined, 'não mandou tools[] pra modelo sem a capability');
  assert(/TOOL_CALL/.test(chats[0].messages[0].content), 'o protocolo de texto entrou no prompt');
  assert(chats.length === 2, `iterou o tool loop (rodadas=${chats.length})`);
  assert(r.executadas.length === 1 && r.executadas[0].name === 'readFile', `executou readFile (${JSON.stringify(r.executadas)})`);
  assert(r.pensamento.includes('Pensando se chamo ferramenta'), '<think> inline virou raciocínio na tela');
  assert(!r.visivel.includes('TOOL_CALL'), 'o JSON da chamada não vazou pra tela');
  assert(r.visivel.includes('configuração está correto'), 'resposta final chegou à tela');

  server.close();
  console.log(falhas === 0 ? '\nTUDO OK' : `\n${falhas} FALHA(S)`);
  process.exit(falhas === 0 ? 0 : 1);
});
