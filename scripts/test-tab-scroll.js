#!/usr/bin/env node
// Teste automatizado do scroll horizontal por rodinha do mouse no header de abas de arquivos abertos.

const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn } = require('child_process');
const http = require('http');

const PORT = 9600 + Math.floor(Math.random() * 300);
const electronPath = require('electron');

let falhas = 0;
const ok = (m) => console.log(`  ok   ${m}`);
const fail = (m) => { falhas++; console.error(`  FALHA ${m}`); };
const assert = (cond, m) => (cond ? ok(m) : fail(m));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function getJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let b = '';
      res.on('data', (c) => (b += c));
      res.on('end', () => { try { resolve(JSON.parse(b)); } catch (e) { reject(e); } });
    }).on('error', reject);
  });
}

async function acharPagina() {
  for (let i = 0; i < 40; i++) {
    try {
      const alvos = await getJson(`http://127.0.0.1:${PORT}/json`);
      const p = alvos.find((t) => t.type === 'page' && /index\.html/.test(t.url || ''));
      if (p && p.webSocketDebuggerUrl) return p;
    } catch (_) {}
    await sleep(500);
  }
  throw new Error('Janela principal do Electron não encontrada via CDP');
}

function conectar(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    let id = 0;
    const pendentes = new Map();
    ws.addEventListener('message', (ev) => {
      let msg; try { msg = JSON.parse(ev.data); } catch (_) { return; }
      const p = pendentes.get(msg.id);
      if (p) { pendentes.delete(msg.id); p(msg); }
    });
    ws.addEventListener('error', reject);
    ws.addEventListener('open', () => {
      resolve({
        ws,
        async evaluate(expr) {
          const meu = ++id;
          const r = await new Promise((res) => {
            pendentes.set(meu, res);
            ws.send(JSON.stringify({
              id: meu, method: 'Runtime.evaluate',
              params: { expression: expr, awaitPromise: true, returnByValue: true },
            }));
          });
          const rr = r.result || {};
          if (rr.exceptionDetails) throw new Error(rr.exceptionDetails.exception?.description || 'erro no renderer');
          return rr.result ? rr.result.value : undefined;
        },
      });
    });
  });
}

async function runTest() {
  console.log('Iniciando teste de scroll da rodinha no header de abas de arquivos...');
  const tmpDir = path.join(os.tmpdir(), 'test-tab-scroll-' + Date.now());
  fs.mkdirSync(tmpDir, { recursive: true });

  // Cria 15 arquivos para estourar o tamanho do container de abas
  for (let i = 1; i <= 15; i++) {
    fs.writeFileSync(path.join(tmpDir, `ArquivoExtensoNumero${i}ServiceImplementation.java`), `// File ${i}\npublic class File${i} {}`);
  }

  const child = spawn(electronPath, ['.', `--remote-debugging-port=${PORT}`], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, NODE_ENV: 'test' },
    stdio: 'ignore',
  });

  try {
    const page = await acharPagina();
    const client = await conectar(page.webSocketDebuggerUrl);

    // Espera EditorController carregar
    for (let i = 0; i < 30; i++) {
      const ready = await client.evaluate(`typeof window.EditorController !== 'undefined' && typeof window.EditorController.openFile === 'function'`);
      if (ready) break;
      await sleep(300);
    }

    // Abre 15 arquivos no EditorController
    await client.evaluate(`
      (async () => {
        const files = ${JSON.stringify(fs.readdirSync(tmpDir).map(f => path.join(tmpDir, f)))};
        for (const f of files) {
          await window.EditorController.openFile(f);
        }
      })()
    `);
    await sleep(800);

    const initialScroll = await client.evaluate(`
      document.getElementById('fv-tabs-container').scrollLeft
    `);
    ok(`Tamanho do scroll inicial: ${initialScroll}`);

    // Simula evento wheel (rodinha para baixo, deltaY = 120) no fv-tabs-container
    const scrolledRight = await client.evaluate(`
      (() => {
        const container = document.getElementById('fv-tabs-container');
        const ev = new WheelEvent('wheel', { deltaY: 120, bubbles: true, cancelable: true });
        container.dispatchEvent(ev);
        return container.scrollLeft;
      })()
    `);
    assert(scrolledRight > 0, `Rodinha para baixo rolou abas para a direita (scrollLeft = ${scrolledRight})`);

    // Simula evento wheel (rodinha para cima, deltaY = -120) no fv-tabs-container
    const scrolledLeft = await client.evaluate(`
      (() => {
        const container = document.getElementById('fv-tabs-container');
        const ev = new WheelEvent('wheel', { deltaY: -120, bubbles: true, cancelable: true });
        container.dispatchEvent(ev);
        return container.scrollLeft;
      })()
    `);
    assert(scrolledLeft < scrolledRight, `Rodinha para cima rolou abas de volta para a esquerda (scrollLeft = ${scrolledLeft})`);

    // Simula evento wheel na barra fv-header (fora das abas diretas)
    const headerScroll = await client.evaluate(`
      (() => {
        const header = document.querySelector('.fv-header');
        const container = document.getElementById('fv-tabs-container');
        const ev = new WheelEvent('wheel', { deltaY: 150, bubbles: true, cancelable: true });
        header.dispatchEvent(ev);
        return container.scrollLeft;
      })()
    `);
    assert(headerScroll > scrolledLeft, `Rodinha sobre o header (.fv-header) rolou as abas (scrollLeft = ${headerScroll})`);

  } finally {
    child.kill();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }

  if (falhas > 0) {
    console.error(`\n${falhas} teste(s) falharam.`);
    process.exit(1);
  } else {
    console.log('\nTodos os testes de scroll do header de abas passaram!');
  }
}

runTest().catch((err) => {
  console.error('Erro fatal:', err);
  process.exit(1);
});
