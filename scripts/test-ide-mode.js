#!/usr/bin/env node
// Testes do MODO IDE com backend. Roda offline: npm run test:ide
//
// O bug que originou este arquivo: o modo IDE mandava pro modelo o prompt de
// copiloto de tela ("máximo 65 palavras", OCR, entrevista) EMPILHADO com o addon
// de ferramentas. Um modelo com raciocínio visível passava o turno tentando
// conciliar as contradições ("me disseram que tenho acesso, mas não tenho";
// "preciso responder em 65 palavras, impossível se eu for ler o repositório")
// até o stream cair com "terminated".
//
// Aqui os testes olham o PROMPT que sai pela rede, não só o resultado.

const http = require('http');
const path = require('path');
const BackendService = require(path.join(__dirname, '..', 'services', 'backendService'));
const { capToolResult, capPrompt, MAX_TOOL_RESULT_CHARS, MAX_PROMPT_CHARS } =
  require(path.join(__dirname, '..', 'services', 'toolLoop'));
const { buildIdeAgentPrompt } = require(path.join(__dirname, '..', 'services', 'idePrompt'));

let falhas = 0;
const ok = (cond, msg) => {
  if (!cond) falhas++;
  console.log(`${cond ? 'PASS' : 'FALHA'}  ${msg}`);
};

const fakeTools = [
  { function: { name: 'readFile', description: 'le arquivo', parameters: { properties: { path: { type: 'string' } } } } },
  { function: { name: 'listDir', description: 'lista pasta', parameters: { properties: { path: { type: 'string' } } } } },
  { function: { name: 'writeFile', description: 'escreve arquivo', parameters: { properties: { path: { type: 'string' }, content: { type: 'string' } } } } },
];

// ── 1. O prompt do modo IDE é coerente ───────────────────────────────────────
function testPromptCoerente() {
  console.log('\n── prompt do modo IDE ──');
  const p = buildIdeAgentPrompt({ toolsSchema: fakeTools, wsPaths: ['C:/proj/alvo'] });

  ok(!/65\s*palavras/i.test(p), 'NAO tem limite de 65 palavras');
  ok(!/\bOCR\b/i.test(p), 'NAO fala de OCR');
  ok(!/entrevistador/i.test(p), 'NAO fala de entrevista');
  ok(!/na tela/i.test(p) || /NÃO está analisando print/.test(p),
    'NAO manda descrever/analisar a tela');
  ok(/IGNORE qualquer limite anterior/i.test(p) === false,
    'NAO tem "ignore a regra anterior" (nao ha regra anterior pra ignorar)');
  ok(/FATOS DESTE AMBIENTE/.test(p), 'declara os fatos do ambiente');
  ok(/C:\/proj\/alvo/.test(p), 'lista o diretorio liberado');
  ok(/TOOL_CALL/.test(p), 'inclui o protocolo de TOOL_CALL');
  ok(/readFile\(/.test(p) && /writeFile\(/.test(p), 'lista as ferramentas disponiveis');
  ok(/NÃO alterar nada ainda/.test(p),
    'trata "nao escreva nada ainda" como escopo, e nao como contradicao');
  ok(/pensou o mesmo pensamento duas vezes/.test(p), 'tem regra anti-loop de raciocinio');

  // Sem workspace anexado o prompt não pode prometer diretório nenhum.
  const semWs = buildIdeAgentPrompt({ toolsSchema: fakeTools, wsPaths: [] });
  ok(/NENHUMA pasta foi anexada/.test(semWs), 'sem anexo, avisa que nao ha pasta');
}

// ── 2. Tetos de tamanho ──────────────────────────────────────────────────────
function testCaps() {
  console.log('\n── tetos de tamanho ──');
  const grande = 'x'.repeat(MAX_TOOL_RESULT_CHARS * 3);
  const cortado = capToolResult(grande);
  ok(cortado.length < grande.length, 'capToolResult corta resultado grande');
  ok(/truncado/.test(cortado), 'capToolResult explica que truncou');
  ok(capToolResult('curto') === 'curto', 'capToolResult nao mexe em resultado pequeno');

  const cabeca = 'INSTRUCOES-DE-SISTEMA';
  const cauda = 'ULTIMO-TOOL-RESULT';
  const promptGrande = cabeca + 'y'.repeat(MAX_PROMPT_CHARS * 2) + cauda;
  const capped = capPrompt(promptGrande);
  ok(capped.length <= MAX_PROMPT_CHARS + 300, 'capPrompt respeita o teto');
  ok(capped.startsWith(cabeca), 'capPrompt preserva o COMECO (instrucoes + pedido)');
  ok(capped.endsWith(cauda), 'capPrompt preserva o FIM (tool results recentes)');
  ok(/omitidos/.test(capped), 'capPrompt avisa o que foi omitido');
}

// ── 3. Prompt que sai pela rede + retry de conexão derrubada ─────────────────
function testNaRede() {
  return new Promise((resolve) => {
    console.log('\n── requisicao real (servidor fake) ──');
    const prompts = [];
    let hit = 0;

    const server = http.createServer((req, res) => {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        hit++;
        try { prompts.push(JSON.parse(body).prompt); } catch (_) { prompts.push(body); }

        // 1ª tentativa: derruba o socket ANTES de qualquer token. É o cenário do
        // "Erro: terminated" — o cliente deve tentar de novo, sozinho.
        if (hit === 1) {
          req.socket.destroy();
          return;
        }

        res.writeHead(200, { 'Content-Type': 'text/event-stream' });
        const send = (o) => res.write(`data: ${JSON.stringify(o)}\n\n`);
        if (hit === 2) {
          send({ response: 'TOOL_CALL: {"name":"listDir","args":{"path":"C:/proj/alvo"}}' });
        } else {
          send({ response: 'O projeto e um app Electron. ' });
          send({ response: 'Li o package.json.' });
        }
        res.write('event: end\ndata: done\n\n');
        res.end();
      });
    });

    server.listen(0, async () => {
      BackendService._cachedApiUrl = `http://127.0.0.1:${server.address().port}`;
      BackendService._lastUrlFetch = Date.now();

      const visible = [];
      const executed = [];
      let erro = null;

      await BackendService.responderStream(
        'me diz que projeto e esse, nao altera nada ainda',
        (chunk) => { if (typeof chunk === 'string') visible.push(chunk); },
        () => {},
        (e) => { erro = e; },
        {
          tools: fakeTools,
          onToolCall: async (name, args) => {
            executed.push(name);
            // Resultado deliberadamente enorme: o teto tem que aparecer.
            return { ok: true, content: 'z'.repeat(MAX_TOOL_RESULT_CHARS * 2) };
          },
          sessionId: 'test-ide-' + Date.now(),
          maxToolCalls: 5,
        }
      );

      ok(!erro, `nao deu erro${erro ? ` (${erro.message})` : ''}`);
      ok(hit === 3, `retry apos socket derrubado + tool loop = 3 requisicoes (fez ${hit})`);
      ok(/Li o package\.json/.test(visible.join('')), 'resposta final chegou na UI');
      ok(executed.includes('listDir'), 'executou a tool pedida');

      const primeiro = prompts[1] || '';
      ok(!/65\s*palavras/i.test(primeiro), 'prompt na rede NAO tem o limite de 65 palavras');
      ok(/FATOS DESTE AMBIENTE/.test(primeiro), 'prompt na rede e o do modo IDE');
      ok(!/copiloto que ASSISTE/.test(primeiro), 'prompt de copiloto de tela ficou fora');

      const segundo = prompts[2] || '';
      ok(/TOOL_RESULT: listDir/.test(segundo), 'TOOL_RESULT voltou pro modelo');
      ok(/truncado/.test(segundo), 'TOOL_RESULT gigante entrou truncado no prompt');
      ok(segundo.length < MAX_PROMPT_CHARS + 1000, 'prompt acumulado ficou dentro do teto');

      server.close();
      resolve();
    });
  });
}

(async () => {
  testPromptCoerente();
  testCaps();
  await testNaRede();
  console.log(falhas ? `\n${falhas} falha(s).` : '\nTudo ok.');
  process.exitCode = falhas ? 1 : 0;
})();
