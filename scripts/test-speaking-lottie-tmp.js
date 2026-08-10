#!/usr/bin/env node
// Teste manual e temporário: sobe o app de verdade, abre a janela da Nexa,
// dispara um "play-tts-audio" real (tom de 4s gerado via ffmpeg) e observa
// via CDP se a animação speaking_lottie entra em loop e para no fim.
// NAO é parte da suite permanente — apagar depois de validar.

const { spawn } = require('child_process');
const path = require('path');
const http = require('http');
const fs = require('fs');

const PORT = 9333;
const RAIZ = path.join(__dirname, '..');
const electronPath = require('electron');
const toneMp3 = 'C:\\Users\\soder\\AppData\\Local\\Temp\\nexa-test\\tone.mp3';

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

async function acharAlvo(regex, tentativas = 40) {
  for (let i = 0; i < tentativas; i++) {
    try {
      const alvos = await getJson(`http://127.0.0.1:${PORT}/json`);
      const alvo = alvos.find((t) => t.type === 'page' && regex.test(t.url || ''));
      if (alvo && alvo.webSocketDebuggerUrl) return alvo;
    } catch (_) {}
    await sleep(500);
  }
  return null;
}

function conectar(url, onConsole) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    let id = 0;
    const pendentes = new Map();
    ws.addEventListener('message', (ev) => {
      let msg; try { msg = JSON.parse(ev.data); } catch (_) { return; }
      if (msg.method === 'Runtime.consoleAPICalled' && onConsole) {
        const args = (msg.params.args || []).map(a => a.value !== undefined ? a.value : a.description).join(' ');
        onConsole(args);
      }
      const p = pendentes.get(msg.id);
      if (p) { pendentes.delete(msg.id); p(msg); }
    });
    ws.addEventListener('error', reject);
    ws.addEventListener('open', () => {
      const api = {
        ws,
        send(method, params = {}) {
          const meu = ++id;
          return new Promise((res) => {
            pendentes.set(meu, res);
            ws.send(JSON.stringify({ id: meu, method, params }));
          });
        },
        async evaluate(expr) {
          const resposta = await api.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
          const r = resposta.result || {};
          if (r.exceptionDetails) {
            throw new Error(r.exceptionDetails.exception?.description || 'erro no renderer');
          }
          return r.result ? r.result.value : undefined;
        },
      };
      resolve(api);
    });
  });
}

(async () => {
  console.log('gerando base64 do tom de teste...');
  const audioBase64 = fs.readFileSync(toneMp3).toString('base64');
  console.log('tamanho base64:', audioBase64.length);

  console.log('subindo o app com o debugger remoto...');
  const app = spawn(electronPath, [RAIZ, `--remote-debugging-port=${PORT}`], {
    cwd: RAIZ,
    env: { ...process.env, ELECTRON_ENABLE_LOGGING: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const mainLogs = [];
  app.stdout.on('data', (d) => { const s = d.toString(); mainLogs.push(s); });
  app.stderr.on('data', (d) => { const s = d.toString(); mainLogs.push(s); });

  try {
    console.log('\n1) esperando janela principal (index.html)...');
    const principal = await acharAlvo(/index\.html/);
    if (!principal) throw new Error('janela principal não apareceu');
    const cdpPrincipal = await conectar(principal.webSocketDebuggerUrl);
    for (let i = 0; i < 40; i++) {
      const pronto = await cdpPrincipal.evaluate("document.readyState === 'complete' && !!window.electronAPI");
      if (pronto) break;
      await sleep(300);
    }
    console.log('   ok, index.html pronta');

    console.log('\n2) abrindo config.html (nodeIntegration=true) para ter acesso a ipcRenderer...');
    await cdpPrincipal.evaluate("window.electronAPI.openConfig(); 'ok'");
    const config = await acharAlvo(/config\.html/);
    if (!config) throw new Error('config.html não apareceu');
    const cdpConfig = await conectar(config.webSocketDebuggerUrl);
    for (let i = 0; i < 40; i++) {
      const pronto = await cdpConfig.evaluate("document.readyState === 'complete' && typeof require === 'function'");
      if (pronto) break;
      await sleep(300);
    }
    console.log('   ok, config.html pronta com require() disponível');

    console.log('\n3) abrindo a janela da Nexa via ipcRenderer.invoke("nexa:toggle")...');
    await cdpConfig.evaluate("require('electron').ipcRenderer.invoke('nexa:toggle')");
    const nexa = await acharAlvo(/nexa\.html/);
    if (!nexa) throw new Error('nexa.html não apareceu');
    console.log('   ok, nexa.html apareceu:', nexa.url);

    console.log('\n4) conectando ao devtools da janela da Nexa e habilitando Runtime/Page...');
    const logs = [];
    const cdpNexa = await conectar(nexa.webSocketDebuggerUrl, (line) => { logs.push(line); console.log('   [nexa console]', line); });
    await cdpNexa.send('Runtime.enable');
    await cdpNexa.send('Page.enable');
    for (let i = 0; i < 40; i++) {
      const pronto = await cdpNexa.evaluate("document.readyState === 'complete' && !!document.getElementById('lottieContainer')");
      if (pronto) break;
      await sleep(300);
    }
    console.log('   ok, canvas/lottieContainer da Nexa prontos');
    await sleep(1500); // deixa a intro/idle assentar

    console.log('\n5) disparando play-tts-audio real via ipcRenderer.send a partir do config.html...');
    await cdpConfig.evaluate(`require('electron').ipcRenderer.send('play-tts-audio', ${JSON.stringify({ audioBase64 })})`);

    console.log('\n6) aguardando 1.5s e tirando screenshot da Nexa falando (deve estar em loop)...');
    await sleep(1500);
    const shot1 = await cdpNexa.send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(RAIZ, 'scripts', '_nexa_speaking_1.png'), Buffer.from(shot1.result.data, 'base64'));
    console.log('   screenshot salvo em scripts/_nexa_speaking_1.png');

    await sleep(1500);
    const shot2 = await cdpNexa.send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(RAIZ, 'scripts', '_nexa_speaking_2.png'), Buffer.from(shot2.result.data, 'base64'));
    console.log('   screenshot 2 salvo em scripts/_nexa_speaking_2.png (compare com o 1 para ver se avançou o loop)');

    console.log('\n7) aguardando o fim do áudio (~4s totais) e verificando se a animação parou...');
    await sleep(3000);
    const shot3 = await cdpNexa.send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(RAIZ, 'scripts', '_nexa_speaking_3_after.png'), Buffer.from(shot3.result.data, 'base64'));
    console.log('   screenshot 3 (pós áudio) salvo em scripts/_nexa_speaking_3_after.png');

    console.log('\n=== LOGS RELEVANTES CAPTURADOS (devtools da Nexa) ===');
    logs.filter(l => /SPEAKING|fala|Transicionando|Parando|Animação/i.test(l)).forEach(l => console.log(' -', l));

    console.log('\n=== LOGS DO PROCESSO MAIN (stdout/stderr) ===');
    const mainText = mainLogs.join('');
    mainText.split('\n').filter(l => /Nexa|TTS|tts|SPEAKING|play-tts/i.test(l)).forEach(l => console.log(' -', l));

  } catch (e) {
    console.error('ERRO NO TESTE:', e.message);
    process.exitCode = 1;
  } finally {
    console.log('\nencerrando o app...');
    app.kill();
  }
})();
