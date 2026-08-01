// Regressão do modo Ollama Local (offline).
//
// Cobre os três defeitos que faziam a resposta "começar e parar do nada" e o
// raciocínio não aparecer na janela:
//   1. message.thinking era descartado (só se lia message.content);
//   2. done_reason != "stop" (janela de contexto cheia) era tratado como fim
//      normal, então a resposta truncada sumia sem explicação;
//   3. num_ctx fixo em 4096, independente do tamanho do prompt.
// Mais o retry sem `think` pra modelo que não suporta raciocínio (400).
//
// Roda com: node scripts/test-ollama-local.js   (npm run test:ollama)

const http = require('http');

let falhas = 0;
const ok = (m) => console.log(`  ok   ${m}`);
const fail = (m) => { falhas++; console.error(`  FALHA ${m}`); };

// Cada cenário decide o que o "Ollama" responde.
let cenario = 'thinking';
const requisicoes = [];

function linha(obj) { return JSON.stringify(obj) + '\n'; }

const server = http.createServer((req, res) => {
  if (req.url.startsWith('/api/ps')) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ models: [{ name: 'modelo-teste' }] }));
    return;
  }
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    const parsed = JSON.parse(body || '{}');
    requisicoes.push(parsed);

    // Modelo sem suporte a raciocínio: o Ollama devolve 400 pra think=true.
    if (cenario === 'sem-think' && parsed.think) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'model does not support thinking' }));
      return;
    }

    res.writeHead(200, { 'Content-Type': 'application/x-ndjson' });
    if (cenario === 'truncado') {
      res.write(linha({ message: { role: 'assistant', content: 'Comecei a responder e' }, done: false }));
      res.write(linha({ message: { role: 'assistant', content: '' }, done: true, done_reason: 'length' }));
      res.end();
      return;
    }
    if (cenario === 'sem-think') {
      res.write(linha({ message: { role: 'assistant', content: 'Resposta simples.' }, done: false }));
      res.write(linha({ message: { role: 'assistant', content: '' }, done: true, done_reason: 'stop' }));
      res.end();
      return;
    }
    // Padrão: modelo pensante — raciocínio em campo próprio, depois a resposta.
    res.write(linha({ message: { role: 'assistant', thinking: 'Vou conferir o que ' }, done: false }));
    res.write(linha({ message: { role: 'assistant', thinking: 'foi perguntado.' }, done: false }));
    res.write(linha({ message: { role: 'assistant', content: 'Ola! ' }, done: false }));
    res.write(linha({ message: { role: 'assistant', content: 'Tudo certo.' }, done: false }));
    res.write(linha({ message: { role: 'assistant', content: '' }, done: true, done_reason: 'stop' }));
    res.end();
  });
});

function rodar(svc, texto, sessionId) {
  const texto_ = []; const pensamento = [];
  return new Promise((resolve) => {
    svc.responderStream(
      texto,
      (c) => {
        if (typeof c === 'object' && c && c.type === 'thinking') pensamento.push(c.text);
        else texto_.push(String(c));
      },
      () => resolve({ texto: texto_.join(''), pensamento: pensamento.join(''), erro: null }),
      (e) => resolve({ texto: texto_.join(''), pensamento: pensamento.join(''), erro: e.message }),
      { sessionId }
    );
  });
}

server.listen(0, async () => {
  const port = server.address().port;
  const svc = require('../services/ollamaLocalService');
  svc._host = () => `http://127.0.0.1:${port}`;
  svc._model = () => 'modelo-teste';

  console.log('1) modelo pensante — raciocínio precisa chegar na janela');
  cenario = 'thinking';
  let r = await rodar(svc, 'oi', 's1');
  if (r.erro) fail(`erro inesperado: ${r.erro}`);
  if (r.pensamento.includes('Vou conferir o que foi perguntado.')) ok('raciocínio (message.thinking) chegou como chunk de thinking');
  else fail(`raciocínio perdido — recebido: ${JSON.stringify(r.pensamento)}`);
  if (r.texto.includes('Ola! Tudo certo.')) ok(`resposta correta: ${JSON.stringify(r.texto.trim())}`);
  else fail(`resposta inesperada: ${JSON.stringify(r.texto)}`);
  if (!r.texto.includes('Vou conferir')) ok('raciocínio não vazou pro texto da resposta');
  else fail('raciocínio vazou pro texto da resposta');
  if (requisicoes[requisicoes.length - 1].think === true) ok('pediu think=true');
  else fail('não pediu think=true');

  console.log('2) done_reason=length — corte precisa ser visível');
  cenario = 'truncado';
  r = await rodar(svc, 'me explica tudo', 's2');
  if (r.erro) fail(`erro inesperado: ${r.erro}`);
  if (/falta de contexto|num_ctx/i.test(r.texto)) ok('usuário foi avisado do corte por contexto');
  else fail(`corte silencioso — texto: ${JSON.stringify(r.texto)}`);
  if (r.texto.includes('Comecei a responder e')) ok('o texto parcial não foi descartado');
  else fail('texto parcial sumiu');

  console.log('3) modelo sem raciocínio — 400 vira retry sem think');
  cenario = 'sem-think';
  const antes = requisicoes.length;
  r = await rodar(svc, 'oi', 's3');
  if (r.erro) fail(`erro inesperado: ${r.erro}`);
  const doCaso = requisicoes.slice(antes);
  if (doCaso.length === 2 && doCaso[0].think === true && doCaso[1].think === undefined) ok('tentou com think, repetiu sem');
  else fail(`sequência inesperada: ${JSON.stringify(doCaso.map((x) => !!x.think))}`);
  if (r.texto.includes('Resposta simples.')) ok('resposta veio no retry');
  else fail(`resposta inesperada: ${JSON.stringify(r.texto)}`);
  // 2ª pergunta no mesmo modelo não deve tentar think de novo.
  const antes2 = requisicoes.length;
  await rodar(svc, 'de novo', 's4');
  const doCaso2 = requisicoes.slice(antes2);
  if (doCaso2.length === 1 && doCaso2[0].think === undefined) ok('lembrou que o modelo não suporta think (1 request só)');
  else fail(`repetiu a sondagem: ${JSON.stringify(doCaso2.map((x) => !!x.think))}`);

  console.log('4) num_ctx dimensionado por request (não é mais fixo em 4096)');
  cenario = 'thinking';
  svc._noThinking.clear();
  const antes3 = requisicoes.length;
  await rodar(svc, 'oi', 's5');
  const ctxCurto = requisicoes[antes3].options.num_ctx;
  const antes4 = requisicoes.length;
  await rodar(svc, 'x'.repeat(200000), 's6');
  const ctxLongo = requisicoes[antes4].options.num_ctx;
  if (ctxLongo > ctxCurto) ok(`cresceu com o prompt: ${ctxCurto} -> ${ctxLongo}`);
  else fail(`não cresceu: ${ctxCurto} -> ${ctxLongo}`);
  if (ctxCurto === 4096) ok(`prompt curto mantém o piso seguro de VRAM: num_ctx=${ctxCurto}`);
  else fail(`piso mudou sem querer: ${ctxCurto} (esperado 4096)`);

  console.log('5) HELPER_OLLAMA_MIN_CTX — o escape hatch que a mensagem de corte recomenda');
  process.env.HELPER_OLLAMA_MIN_CTX = '8192';
  const antes5 = requisicoes.length;
  await rodar(svc, 'oi', 's7');
  const ctxComEnv = requisicoes[antes5].options.num_ctx;
  delete process.env.HELPER_OLLAMA_MIN_CTX;
  if (ctxComEnv === 8192) ok(`piso subiu pelo env: num_ctx=${ctxComEnv}`);
  else fail(`env ignorado: num_ctx=${ctxComEnv} (esperado 8192)`);

  server.close();
  console.log(falhas === 0 ? '\nTUDO OK' : `\n${falhas} FALHA(S)`);
  process.exit(falhas === 0 ? 0 : 1);
});
