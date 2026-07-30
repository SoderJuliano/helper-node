#!/usr/bin/env node
process.env.TESTING = 'true';
// Teste do stream do OllamaLocalService.
// Roda com: node ./scripts/test-ollama-stream.js

const http = require('http');
const path = require('path');
const configService = require(path.join(__dirname, '..', 'services', 'configService'));
const OllamaLocalService = require(path.join(__dirname, '..', 'services', 'ollamaLocalService'));

// Mock config functions
let testHost = 'http://localhost:11434';
configService.getOllamaLocalHost = () => testHost;
configService.getOllamaLocalModel = () => 'test-model';

let requestCount = 0;
const server = http.createServer((req, res) => {
  if (req.url.endsWith('/api/ps')) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ models: [] }));
    return;
  }
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    requestCount++;
    res.writeHead(200, { 'Content-Type': 'application/x-ndjson' });

    const sendChunk = (obj) => res.write(JSON.stringify(obj) + '\n');

    if (requestCount === 1) {
      // Stream round 1: includes think block and a tool call
      sendChunk({ message: { role: 'assistant', content: '<think>' } });
      sendChunk({ message: { role: 'assistant', content: 'Pensando se chamo ferramenta...\n' } });
      sendChunk({ message: { role: 'assistant', content: 'Sim, vou ler o arquivo.' } });
      sendChunk({ message: { role: 'assistant', content: '</think>' } });
      sendChunk({ message: { role: 'assistant', content: 'TOOL_CALL: {"name":"readFile","args":{"path":"/tmp/config.json"}}' } });
    } else {
      // Stream round 2: regular response text
      sendChunk({ message: { role: 'assistant', content: 'O arquivo de configuração está correto.' } });
    }
    
    // Send final marker with done: true
    sendChunk({ done: true });
    res.end();
  });
});

server.listen(0, '127.0.0.1', async () => {
  const port = server.address().port;
  testHost = `http://127.0.0.1:${port}`;

  const executedTools = [];
  const thinkingChunks = [];
  const visibleChunks = [];

  const fakeTools = [
    { function: { name: 'readFile', description: 'le arquivo', parameters: { properties: { path: { type: 'string' } } } } }
  ];

  try {
    await OllamaLocalService.responderStream(
      'verifica o config',
      (chunk) => {
        if (chunk && typeof chunk === 'object' && chunk.type === 'thinking') {
          thinkingChunks.push(chunk.text);
        } else if (typeof chunk === 'string') {
          visibleChunks.push(chunk);
        }
      },
      () => {
        // onComplete
      },
      (e) => {
        console.error('Erro na resposta:', e);
      },
      {
        tools: fakeTools,
        onToolCall: async (name, args) => {
          executedTools.push({ name, args });
          return { ok: true, content: '{"status":"ok"}' };
        },
        sessionId: 'test-stream-' + Date.now(),
        maxToolCalls: 5,
      }
    );
  } catch (err) {
    console.error('Erro no teste:', err);
  }

  const visibleText = visibleChunks.join('');
  const thinkingText = thinkingChunks.join('');
  let failures = 0;

  const assert = (cond, msg) => {
    if (!cond) failures++;
    console.log(`${cond ? 'PASS' : 'FAIL'}  ${msg}`);
  };

  console.log('\n--- RESULTADOS ---');
  console.log('Tools executadas:', JSON.stringify(executedTools));
  console.log('Texto visível:', JSON.stringify(visibleText));
  console.log('Thinking recebido:', JSON.stringify(thinkingText));
  console.log('------------------\n');

  assert(executedTools.length === 1, 'Executou exatamente 1 ferramenta');
  assert(executedTools[0] && executedTools[0].name === 'readFile', 'Executou readFile');
  assert(thinkingText.includes('Pensando se chamo ferramenta'), 'Thinking extraído e recebido');
  assert(!visibleText.includes('TOOL_CALL'), 'JSON do TOOL_CALL não vazou para a UI');
  assert(visibleText.includes('configuração está correto'), 'Texto final chegou à UI');
  assert(requestCount === 2, 'Iterou o loop de ferramentas');

  process.exitCode = failures ? 1 : 0;
  server.close();
});
