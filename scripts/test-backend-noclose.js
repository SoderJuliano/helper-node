// Regressão: o /chat do pikachu é SSE e NÃO fecha a conexão no fim
// (ModelController.chat chama startAsync() com timeout de 10min e nunca chama
// asyncContext.complete()). Este teste sobe um servidor com esse comportamento
// exato e cobra que BackendService.responder() volte na hora — e não só quando
// o timeout do cliente estourar, que era o bug dos "7 minutos sem resposta".
//
// Roda com: node scripts/test-backend-noclose.js  (npm run test:noclose)

const http = require('http');

const GERACAO_MS = 300;   // quanto o "modelo" leva pra gerar
const LIMITE_MS = 5000;   // acima disso, o cliente está esperando o close

let falhas = 0;
const ok = (m) => console.log(`  ok   ${m}`);
const fail = (m) => { falhas++; console.error(`  FALHA ${m}`); };

const server = http.createServer((req, res) => {
  if (req.url.startsWith('/models')) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ models: [{ name: 'qwen3.6:35b' }] }));
    return;
  }
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
    setTimeout(() => {
      res.write('event: thinking-start\ndata: start\n\n');
      res.write('data: {"thinking":"o usuario disse oi, vou cumprimentar"}\n\n');
      res.write('event: thinking-end\ndata: done\n\n');
      res.write('event: message\ndata: start\n\n');
      res.write('data: {"response":"Ola! "}\n\n');
      res.write('data: {"response":"Como posso ajudar?"}\n\n');
      res.write('event: end\ndata: done\n\n');
      // De propósito: sem res.end(). É o que o pikachu faz hoje.
    }, GERACAO_MS);
  });
});

server.listen(0, async () => {
  const port = server.address().port;
  process.env.HELPER_BACKEND_URL = `http://127.0.0.1:${port}`;

  const BackendService = require('../services/backendService');

  console.log('1) responder() num /chat SSE que nunca fecha');
  const t0 = Date.now();
  let resposta;
  try {
    resposta = await BackendService.responder('oi', { sessionId: 'test-noclose' });
  } catch (e) {
    fail(`responder() lançou: ${e.message}`);
  }
  const dt = Date.now() - t0;
  if (dt < LIMITE_MS) ok(`voltou em ${dt}ms (< ${LIMITE_MS}ms)`);
  else fail(`levou ${dt}ms — ainda está esperando o close da conexão`);

  if (resposta === 'Ola! Como posso ajudar?') ok(`texto correto: ${JSON.stringify(resposta)}`);
  else fail(`texto inesperado: ${JSON.stringify(resposta)}`);

  if (resposta && !/raciocin|vou cumprimentar/i.test(resposta)) ok('raciocínio não vazou pra resposta');
  else fail('raciocínio vazou pra resposta');

  console.log('2) responderStream() no mesmo servidor (não deve regredir)');
  const t1 = Date.now();
  let streamado = '';
  await new Promise((resolve) => {
    BackendService.responderStream(
      'oi',
      (c) => { if (typeof c === 'string') streamado += c; },
      resolve,
      (e) => { fail(`responderStream onError: ${e.message}`); resolve(); },
      { sessionId: 'test-noclose-stream' }
    );
  });
  const dt1 = Date.now() - t1;
  if (dt1 < LIMITE_MS) ok(`voltou em ${dt1}ms`);
  else fail(`levou ${dt1}ms`);
  if (streamado === 'Ola! Como posso ajudar?') ok(`streamou correto: ${JSON.stringify(streamado)}`);
  else fail(`streamou inesperado: ${JSON.stringify(streamado)}`);

  server.close();
  console.log(falhas === 0 ? '\nTUDO OK' : `\n${falhas} FALHA(S)`);
  process.exit(falhas === 0 ? 0 : 1);
});
