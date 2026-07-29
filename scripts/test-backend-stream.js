#!/usr/bin/env node
// Teste do loop de ferramentas do responderStream, simulando o SSE do pikachu.
// Roda com: npm run test:stream   (não precisa do backend no ar)
//
// O cenário existe por causa de um bug real: com modelo que raciocina
// (qwen3.6), o parser de TOOL_CALL enxergava o raciocínio junto da resposta e
// executava ferramenta que o modelo tinha apenas COGITADO e descartado.
// Aqui o modelo "pensa" em apagar um arquivo, desiste, e só então pede leitura.
// Se o teste falhar em "NAO executou o deleteFile", a separação quebrou.

const http = require('http');
const path = require('path');
const BackendService = require(path.join(__dirname, '..', 'services', 'backendService'));

let hit = 0;
const server = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    hit++;
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    const send = (o) => res.write(`data: ${JSON.stringify(o)}\n\n`);

    if (hit === 1) {
      // Fase de raciocínio — inclui uma tool call que o modelo NÃO quer executar.
      res.write('event: thinking-start\ndata: start\n\n');
      send({ thinking: 'Hmm, eu poderia fazer TOOL_CALL: {"name":"deleteFile","args":{"path":"/tmp/NAO_APAGAR"}} ' });
      send({ thinking: 'mas nao, apagar seria errado. Melhor ler o arquivo.' });
      res.write('event: thinking-end\ndata: done\n\n');
      // Resposta de verdade: a tool call que vale.
      send({ response: 'TOOL_CALL: {"name":"readFile","args":{"path":"/tmp/alvo.js"}}' });
    } else {
      send({ response: 'O arquivo tem uma funcao soma. ' });
      send({ response: 'Nada a corrigir.' });
    }
    res.write('event: end\ndata: done\n\n');
    res.end();
  });
});

server.listen(0, async () => {
  const port = server.address().port;
  BackendService._cachedApiUrl = `http://127.0.0.1:${port}`;
  BackendService._lastUrlFetch = Date.now();

  const executed = [];
  const thinking = [];
  const visible = [];

  const fakeTools = [
    { function: { name: 'readFile', description: 'le arquivo', parameters: { properties: { path: { type: 'string' } } } } },
    { function: { name: 'deleteFile', description: 'apaga arquivo', parameters: { properties: { path: { type: 'string' } } } } },
  ];

  await BackendService.responderStream(
    'analisa o /tmp/alvo.js',
    (chunk) => {
      if (chunk && typeof chunk === 'object' && chunk.type === 'thinking') thinking.push(chunk.text);
      else if (typeof chunk === 'string') visible.push(chunk);
    },
    () => {},
    (e) => console.log('ERRO:', e.message),
    {
      tools: fakeTools,
      onToolCall: async (name, args) => {
        executed.push({ name, args });
        return { ok: true, content: 'function soma(a,b){return a+b}' };
      },
      sessionId: 'test-' + Date.now(),
      maxToolCalls: 5,
    }
  );

  const vis = visible.join('');
  const thk = thinking.join('');
  let falhas = 0;
  const ok = (cond, msg) => {
    if (!cond) falhas++;
    console.log(`${cond ? 'PASS' : 'FALHA'}  ${msg}`);
  };

  console.log('\ntools executadas :', JSON.stringify(executed));
  console.log('texto visivel    :', JSON.stringify(vis));
  console.log('thinking recebido:', thk ? `${thk.length} chars` : '(nenhum)');
  console.log('');
  ok(executed.length === 1, 'executou exatamente 1 tool');
  ok(executed[0] && executed[0].name === 'readFile', 'executou readFile com o path certo');
  ok(!executed.some((e) => e.name === 'deleteFile'), 'NAO executou o deleteFile que so foi cogitado no raciocinio');
  ok(thk.includes('apagar seria errado'), 'thinking chegou na UI');
  ok(!/TOOL_CALL/i.test(vis), 'JSON do TOOL_CALL nao vazou pro texto visivel');
  ok(/Nada a corrigir/.test(vis), 'resposta final chegou na UI');
  ok(hit === 2, `tool loop iterou (2 requisicoes) — fez ${hit}`);

  // process.exit() aqui dispara um assert do libuv no Windows enquanto o
  // socket ainda fecha. exitCode deixa o Node sair sozinho, limpo.
  process.exitCode = falhas ? 1 : 0;
  server.close();
});
