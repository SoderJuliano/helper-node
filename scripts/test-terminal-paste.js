#!/usr/bin/env node
// Teste automatizado de colagem (Ctrl+V) no terminal embutido.

const path = require('path');
const http = require('http');
const { spawn } = require('child_process');

const PORT = 9444;
const RAIZ = path.join(__dirname, '..');
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

async function acharPagina(tentativas = 40) {
  for (let i = 0; i < tentativas; i++) {
    try {
      const alvos = await getJson(`http://127.0.0.1:${PORT}/json`);
      const p = alvos.find((t) => t.type === 'page' && /index\.html/.test(t.url || ''));
      if (p && p.webSocketDebuggerUrl) return p;
    } catch (_) {}
    await sleep(500);
  }
  throw new Error('Janela principal não apareceu no debugger remoto');
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

(async () => {
  console.log('Iniciando teste de colagem (Ctrl+V) no terminal...');
  const app = spawn(electronPath, [RAIZ, `--remote-debugging-port=${PORT}`], {
    cwd: RAIZ,
    env: { ...process.env, ELECTRON_ENABLE_LOGGING: '1' },
    stdio: 'ignore',
  });

  try {
    const page = await acharPagina();
    const cdp = await conectar(page.webSocketDebuggerUrl);

    // Espera a aba do terminal estar disponível
    for (let i = 0; i < 40; i++) {
      const pronto = await cdp.evaluate("document.readyState === 'complete' && !!document.getElementById('tab-btn-terminal')");
      if (pronto) break;
      await sleep(500);
    }

    // Abre a aba do terminal
    await cdp.evaluate("document.getElementById('tab-btn-terminal').click()");
    await sleep(2500);

    const montou = await cdp.evaluate("!!window._term");
    assert(montou, 'xterm.js montou no painel');

    const textoTeste = 'echo "TEXTO_TESTE_PASTE_TERMINAL"';

    // Copia o texto para o clipboard usando a API nativa da aplicação
    await cdp.evaluate(`window.electronAPI.copyToClipboard(${JSON.stringify(textoTeste)})`);
    await sleep(500);

    const clipText = await cdp.evaluate(`window.electronAPI.readClipboardText()`);
    ok(`Conteúdo do clipboard lido: "${clipText}"`);

    // Dispara a colagem e aguarda a promessa terminar
    await cdp.evaluate(`
      (async () => {
        if (window._colarTextoNoTerminal) {
          await window._colarTextoNoTerminal();
        } else {
          const ev = new KeyboardEvent('keydown', {
            key: 'v',
            code: 'KeyV',
            ctrlKey: true,
            bubbles: true,
            cancelable: true
          });
          window._term._core._customKeyEventHandler(ev);
        }
      })()
    `);
    await sleep(1500);

    // Lê o conteúdo do buffer do terminal
    const bufferText = await cdp.evaluate(`
      (() => {
        const buf = window._term.buffer.active;
        let text = '';
        for (let i = 0; i < buf.length; i++) {
          const l = buf.getLine(i);
          if (l) text += l.translateToString(true) + '\\n';
        }
        return text;
      })()
    `);

    assert(bufferText.includes('TEXTO_TESTE_PASTE_TERMINAL'), 'Texto do clipboard foi colado no terminal com sucesso');
    assert(!bufferText.includes('ctrl+v') && !bufferText.includes('^V'), 'Não imprimiu "ctrl+v" ou "^V" literalmente');

  } finally {
    app.kill();
  }

  if (falhas > 0) {
    console.error(`\n${falhas} teste(s) falharam.`);
    process.exit(1);
  } else {
    console.log('\nTodos os testes de colagem no terminal passaram!');
  }
})().catch((err) => {
  console.error('Erro fatal:', err);
  process.exit(1);
});
