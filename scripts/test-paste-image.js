#!/usr/bin/env node
// Teste ponta a ponta do anexo de imagem colada (Ctrl+V) no modo IDE.
//
// Este fluxo já quebrou duas vezes por motivos que NENHUMA análise estática
// pega, os dois no renderer:
//   1. o evento `paste` do Chromium só dispara com campo editável em foco — na
//      tela hero não há, e o Ctrl+V "não fazia nada";
//   2. inserir <img> data-URL antes de um `await` congelava o event loop e a
//      pergunta nunca era enviada.
// Por isso o teste sobe o app de verdade e dirige o renderer por CDP.
//
// Roda com: node scripts/test-paste-image.js   (npm run test:paste)

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const http = require('http');

// Porta fixa vira flake: se uma execução anterior deixar o socket pendurado, a
// próxima sobe o app sem debugger e o teste trava esperando uma página que
// nunca aparece. Sorteia uma alta e confere que está livre.
const PORT = 9400 + Math.floor(Math.random() * 400);
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
      const pagina = alvos.find((t) => t.type === 'page' && /index\.html/.test(t.url || ''));
      if (pagina && pagina.webSocketDebuggerUrl) return pagina;
    } catch (_) {}
    await sleep(500);
  }
  throw new Error('janela principal não apareceu no debugger remoto');
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
          const resposta = await new Promise((res) => {
            pendentes.set(meu, res);
            ws.send(JSON.stringify({
              id: meu,
              method: 'Runtime.evaluate',
              params: { expression: expr, awaitPromise: true, returnByValue: true },
            }));
          });
          const r = resposta.result || {};
          if (r.exceptionDetails) {
            throw new Error(r.exceptionDetails.exception?.description || 'erro no renderer');
          }
          return r.result ? r.result.value : undefined;
        },
      });
    });
  });
}

const PNG_1X1 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

// Põe uma imagem de verdade no clipboard do Windows. Sem isso o teste do
// Ctrl+V não tem o que colar e passaria sem provar nada.
function porImagemNoClipboard(arquivo) {
  const ps = `Add-Type -AssemblyName System.Windows.Forms,System.Drawing; `
    + `$img = [System.Drawing.Image]::FromFile("${arquivo.replace(/\\/g, '\\\\')}"); `
    + `[System.Windows.Forms.Clipboard]::SetImage($img); Write-Output "ok"`;
  const r = require('child_process').spawnSync(
    'powershell', ['-STA', '-NoProfile', '-Command', ps],
    { encoding: 'utf8' }
  );
  return /ok/.test(r.stdout || '');
}

(async () => {
  console.log('subindo o app com o debugger remoto...');
  const imgTeste = path.join(RAIZ, 'assets', 'linux.png');
  if (!porImagemNoClipboard(imgTeste)) {
    console.error('não consegui pôr imagem no clipboard — teste de Ctrl+V seria inconclusivo.');
    process.exit(1);
  }
  console.log(`imagem no clipboard: ${path.basename(imgTeste)}`);
  const app = spawn(electronPath, [RAIZ, `--remote-debugging-port=${PORT}`], {
    cwd: RAIZ,
    env: { ...process.env, ELECTRON_ENABLE_LOGGING: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const logs = [];
  app.stdout.on('data', (c) => logs.push(String(c)));
  app.stderr.on('data', (c) => logs.push(String(c)));

  let cdp;
  try {
    const pagina = await acharPagina();
    cdp = await conectar(pagina.webSocketDebuggerUrl);
    await sleep(2500);

    console.log('\n1. API exposta no preload');
    assert(await cdp.evaluate('typeof window.electronAPI.isIdeProjectMode === "function"'),
      'isIdeProjectMode disponível');
    assert(await cdp.evaluate('typeof window.electronAPI.readClipboardImage === "function"'),
      'readClipboardImage disponível (fallback de Ctrl+V sem foco)');
    assert(await cdp.evaluate('typeof window.electronAPI.onImageAttached === "function"'),
      'onImageAttached disponível');

    console.log('\n2. Ctrl+V com imagem real no clipboard, sem campo focado');
    // Testa pelo EFEITO, não espionando o electronAPI: o objeto do
    // contextBridge é congelado, então stub nele não cola (silenciosamente) e
    // o teste passaria/falharia por motivo errado.
    //
    // Este é o bug histórico nº 1: na tela hero nada está focado, o evento
    // `paste` do Chromium não dispara, e o Ctrl+V não fazia nada.
    assert(await cdp.evaluate('document.activeElement === document.body'),
      'tela sem campo focado (é o cenário do bug)');

    const antesLista = await cdp.evaluate('window.electronAPI.workspaceList()') || [];
    const antesColadas = antesLista.filter(a => a.origin === 'paste').length;

    await cdp.evaluate(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'v', ctrlKey: true, bubbles: true }))`);
    await sleep(3000);

    const depoisLista = await cdp.evaluate('window.electronAPI.workspaceList()') || [];
    const coladas = depoisLista.filter(a => a.origin === 'paste');
    assert(coladas.length === antesColadas + 1, 'Ctrl+V sem foco anexou a imagem do clipboard');

    const nova = coladas[coladas.length - 1];
    if (nova) {
      assert(fs.existsSync(nova.path), `imagem gravada em disco (${path.basename(nova.path)})`);
      assert(/pasted-images/.test(nova.path), 'gravada na pasta do app, não dentro do projeto');
      // Limpa: o teste não pode deixar lixo no workspace real do usuário.
      await cdp.evaluate(`window.electronAPI.workspaceRemove(${JSON.stringify(nova.id)})`);
      await sleep(400);
      assert(!fs.existsSync(nova.path), 'remover o chip apaga o arquivo');
    }

    console.log('\n3. modo IDE decide o comportamento');
    const ideMode = await cdp.evaluate('window.electronAPI.isIdeProjectMode()');
    console.log(`     (modo IDE atual: ${ideMode})`);
    assert(typeof ideMode === 'boolean', 'isIdeProjectMode responde booleano');

    console.log('\n4. nenhum data-URL entra no DOM pelo caminho de anexo');
    // A regra de ouro do freeze: no modo IDE a imagem NÃO vira <img> no
    // transcript. Simula o paste e confere que nada com src=data: apareceu.
    const antes = await cdp.evaluate('document.querySelectorAll(\'img[src^="data:"]\').length');
    await cdp.evaluate(`window.electronAPI.processPastedImage(${JSON.stringify(PNG_1X1)})`);
    await sleep(2500);
    const depois = await cdp.evaluate('document.querySelectorAll(\'img[src^="data:"]\').length');
    if (ideMode) {
      assert(depois === antes, 'modo IDE não injeta <img> data-URL no DOM');
    } else {
      ok('fora do modo IDE — fluxo antigo, checagem de data-URL não se aplica');
    }
    // Este passo também anexa: limpar, senão o teste vai acumulando imagem no
    // workspace REAL do usuário a cada execução.
    for (const a of (await cdp.evaluate('window.electronAPI.workspaceList()') || [])) {
      if (a.origin === 'paste' && !antesLista.some(x => x.id === a.id)) {
        await cdp.evaluate(`window.electronAPI.workspaceRemove(${JSON.stringify(a.id)})`);
      }
    }
    await sleep(400);
    const sobrou = (await cdp.evaluate('window.electronAPI.workspaceList()') || [])
      .filter(a => a.origin === 'paste' && !antesLista.some(x => x.id === a.id));
    assert(sobrou.length === 0, 'teste não deixou anexo órfão no workspace');

    console.log('\n5. renderer vivo (sem freeze)');
    const vivo = await cdp.evaluate('(() => { const t0 = Date.now(); return Date.now() - t0 >= 0; })()');
    assert(vivo === true, 'renderer responde depois do paste');

    const erros = logs.join('').match(/Uncaught (?:Reference|Type)Error[^"\n]*/g) || [];
    const meus = erros.filter(e => !/defineSimpleMode/.test(e)); // ruído conhecido do CodeMirror via CDN
    assert(meus.length === 0, `sem ReferenceError/TypeError novos no renderer${meus.length ? ': ' + meus[0] : ''}`);

  } catch (e) {
    fail('exceção: ' + e.message);
  } finally {
    try { cdp && cdp.ws.close(); } catch (_) {}
    // O Electron abre vários processos filhos; matar só o pai deixa o socket do
    // debugger pendurado e trava a execução seguinte. No Windows, /T mata a árvore.
    try { app.kill(); } catch (_) {}
    await sleep(600);
    if (process.platform === 'win32' && app.pid) {
      try {
        require('child_process').spawnSync('taskkill', ['/PID', String(app.pid), '/T', '/F'], { stdio: 'ignore' });
      } catch (_) {}
    } else {
      try { app.kill('SIGKILL'); } catch (_) {}
    }
  }

  console.log(falhas ? `\n${falhas} falha(s).` : '\ntudo ok.');
  process.exit(falhas ? 1 : 0);
})();
