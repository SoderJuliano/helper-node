#!/usr/bin/env node
// Testes da DESCOBERTA DE URL do backend. Roda offline: npm run test:url
//
// Os dois bugs que originaram este arquivo:
//
// 1. Localhost nunca era tentado. No server Linux o app roda na MESMA máquina
//    do pikachu, mas a descoberta só olhava o túnel do abra-api e, no fallback,
//    montava `http://<IP PÚBLICO>:8080` (api.ipify.org) — que esbarra em
//    NAT/firewall. Na máquina onde o backend é LOCAL, os dois caminhos
//    testados eram justamente os que não funcionam.
//
// 2. Falha transitória apagava a URL boa: o catch fazia `apiUrl = ""`, então um
//    timeout de 5s no abra-api derrubava o backend no envio seguinte.
//
// O túnel é sempre injetado (stub) para o teste dar o mesmo resultado com e sem
// internet — senão o túnel real vence e não estamos testando nada.

const http = require('http');
const path = require('path');
const { looksLikePikachu, createUrlDiscovery, LOCAL_BACKEND } =
  require(path.join(__dirname, '..', 'services', 'backendUrlDiscovery'));

let falhas = 0;
const ok = (cond, msg) => {
  if (!cond) falhas++;
  console.log(`${cond ? 'PASS' : 'FALHA'}  ${msg}`);
};

// Responde /models como o pikachu responde.
function fakePikachu() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      if (req.url.startsWith('/models')) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ models: [{ name: 'qwen3.6:35b' }] }));
        return;
      }
      res.writeHead(404); res.end();
    });
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

// Responde 200 mas NÃO é o pikachu (outro serviço ocupando a porta).
function fakeIntruso() {
  return new Promise((resolve) => {
    const server = http.createServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end('<html>outro servico</html>');
    });
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

(async () => {
  console.log('\n── identidade do backend (probe real de /models) ──');
  const pikachu = await fakePikachu();
  const urlPikachu = `http://127.0.0.1:${pikachu.address().port}`;
  ok(await looksLikePikachu(urlPikachu), 'reconhece o pikachu por /models');

  const intruso = await fakeIntruso();
  const urlIntruso = `http://127.0.0.1:${intruso.address().port}`;
  ok(!(await looksLikePikachu(urlIntruso)),
    'NAO aceita outro servico que responde 200 na porta');
  ok(!(await looksLikePikachu('http://127.0.0.1:1', 500)),
    'porta fechada e recusada rapido');

  console.log('\n── localhost e tentado (o caso do server Linux) ──');
  // O probe injetado finge que o pikachu está no LOCAL_BACKEND.
  const soLocal = createUrlDiscovery({
    fetchTunnelUrl: async () => null,
    looksLikePikachu: async (u) => u === LOCAL_BACKEND,
  });
  ok((await soLocal.discover()) === LOCAL_BACKEND,
    'adota o backend LOCAL quando ele responde e nao ha tunel');

  console.log('\n── tunel usado quando nao ha backend local ──');
  const tunelUrl = 'https://tunel-de-teste.example';
  const soTunel = createUrlDiscovery({
    fetchTunnelUrl: async () => tunelUrl,
    looksLikePikachu: async (u) => u === tunelUrl,
  });
  ok((await soTunel.discover()) === tunelUrl, 'cai pro tunel quando o local nao responde');

  console.log('\n── localhost tem prioridade sobre o tunel ──');
  const ambos = createUrlDiscovery({
    fetchTunnelUrl: async () => tunelUrl,
    looksLikePikachu: async () => true,   // os dois respondem
  });
  ok((await ambos.discover()) === LOCAL_BACKEND,
    'com os dois no ar, prefere o local (mais rapido, sem depender do tunel)');

  console.log('\n── falha transitoria NAO apaga a URL boa ──');
  let noAr = true;
  const instavel = createUrlDiscovery({
    fetchTunnelUrl: async () => (noAr ? tunelUrl : null),
    looksLikePikachu: async (u) => noAr && u === tunelUrl,
  });
  ok((await instavel.discover()) === tunelUrl, 'primeiro achou a URL boa');
  noAr = false;                 // rede caiu
  instavel.lastFetch = 0;       // expira o cache pra forçar nova descoberta
  const depois = await instavel.discover();
  ok(depois === tunelUrl, `mantem a ultima URL boa quando nada responde (deu ${depois})`);

  console.log('\n── sem candidato nenhum ──');
  const vazio = createUrlDiscovery({
    fetchTunnelUrl: async () => null,
    looksLikePikachu: async () => false,
  });
  ok((await vazio.discover()) === null, 'sem nada no ar devolve null');

  console.log('\n── override manual HELPER_BACKEND_URL ──');
  process.env.HELPER_BACKEND_URL = 'http://override.example/';
  const comOverride = createUrlDiscovery({
    fetchTunnelUrl: async () => tunelUrl,
    looksLikePikachu: async () => true,
  });
  ok((await comOverride.discover()) === 'http://override.example',
    'override vence tudo e perde a barra final');
  delete process.env.HELPER_BACKEND_URL;

  console.log('\n── cache evita tempestade de probes ──');
  let probes = 0;
  const comCache = createUrlDiscovery({
    fetchTunnelUrl: async () => tunelUrl,
    looksLikePikachu: async () => { probes++; return true; },
  });
  await comCache.discover();
  const antes = probes;
  await comCache.discover();
  ok(probes === antes, 'segunda chamada dentro do TTL nao refaz o probe');

  await new Promise(r => pikachu.close(r));
  await new Promise(r => intruso.close(r));
  console.log(falhas ? `\n${falhas} falha(s).` : '\nTudo ok.');
  process.exitCode = falhas ? 1 : 0;
})();
