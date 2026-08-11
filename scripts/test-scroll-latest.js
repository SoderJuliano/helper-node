#!/usr/bin/env node
// Teste ponta a ponta da seta "ir para a mensagem mais recente".
//
// Restaurar um histórico grande deixa o usuário no topo da conversa
// (restoreConversation chama scrollTranscriptionToBottom('auto'), que não rola
// porque acabou de anexar tudo e não está perto do fim). A seta é a saída — e
// precisa aparecer só quando há conversa abaixo, sumir ao chegar no fim, e
// nunca cobrir os outros ícones da topbar.
//
// Roda com: node scripts/test-scroll-latest.js   (npm run test:scroll)

const { spawn } = require('child_process');
const path = require('path');
const http = require('http');

const PORT = 9500 + Math.floor(Math.random() * 400);
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

// Reproduz o que restoreConversation faz: anexa N blocos de uma vez e chama
// scrollTranscriptionToBottom('auto') — que é justamente o que NÃO rola.
const restaurarHistoricoGrande = (n) => `(async () => {
  const el = document.getElementById('transcription');
  const hero = document.getElementById('welcome-hero');
  if (hero) hero.classList.add('hidden');
  el.innerHTML = '';
  for (let i = 0; i < ${n}; i++) {
    const b = document.createElement('div');
    b.className = 'interaction-block';
    const q = document.createElement('span');
    q.className = 'question-text';
    q.textContent = 'Pergunta ' + (i + 1);
    const r = document.createElement('div');
    r.className = 'ia-response';
    r.innerText = 'Resposta ' + (i + 1) + '\\n'.repeat(3);
    b.appendChild(q); b.appendChild(r);
    el.appendChild(b);
  }
  document.getElementById('copy-all-btn').style.display = 'block';
  window.scrollTranscriptionToBottom('auto');
  await new Promise(r => setTimeout(r, 400));
  return { scrollTop: el.scrollTop, scrollHeight: el.scrollHeight, clientHeight: el.clientHeight };
})()`;

const estadoSeta = `(() => {
  const b = document.getElementById('scroll-to-latest');
  const el = document.getElementById('transcription');
  if (!b) return { existe: false };
  const cs = getComputedStyle(b);
  return {
    existe: true,
    visivel: b.classList.contains('visible') && cs.display !== 'none',
    display: cs.display,
    distDoFim: el.scrollHeight - el.scrollTop - el.clientHeight,
  };
})()`;

(async () => {
  console.log('subindo o app com o debugger remoto...');
  const app = spawn(electronPath, [RAIZ, `--remote-debugging-port=${PORT}`], {
    cwd: RAIZ, env: { ...process.env, ELECTRON_ENABLE_LOGGING: '1' },
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

    console.log('\n1. conversa curta: a seta não aparece');
    await cdp.evaluate(`(async () => {
      const el = document.getElementById('transcription');
      const hero = document.getElementById('welcome-hero');
      if (hero) hero.classList.add('hidden');
      el.innerHTML = '<div class="interaction-block"><span class="question-text">oi</span></div>';
      await new Promise(r => setTimeout(r, 400));
    })()`);
    let s = await cdp.evaluate(estadoSeta);
    assert(s.existe, 'botão existe no DOM');
    assert(!s.visivel, `seta escondida sem conteúdo pra rolar (display=${s.display})`);

    console.log('\n2. histórico grande restaurado: cai no topo e a seta aparece');
    const dim = await cdp.evaluate(restaurarHistoricoGrande(60));
    assert(dim.scrollHeight > dim.clientHeight, `conversa não cabe na tela (${dim.scrollHeight}px em ${dim.clientHeight}px)`);
    assert(dim.scrollTop < 50, `restaurar deixou o usuário no topo (scrollTop=${dim.scrollTop})`);
    s = await cdp.evaluate(estadoSeta);
    assert(s.visivel, `seta apareceu (dist. do fim: ${Math.round(s.distDoFim)}px)`);

    console.log('\n3. a seta não cobre os outros ícones da topbar');
    const geo = await cdp.evaluate(`(() => {
      const r = (sel) => { const e = document.querySelector(sel); if (!e) return null;
        const b = e.getBoundingClientRect(); return { l: b.left, r: b.right, t: b.top, b: b.bottom, w: b.width }; };
      return { seta: r('#scroll-to-latest'), copiar: r('#copy-all-btn'), janela: r('.win-controls-overlay') };
    })()`);
    const cruza = (a, b) => !!a && !!b && a.l < b.r && b.l < a.r && a.t < b.b && b.t < a.b;
    assert(geo.seta && geo.seta.w > 0, `seta renderizada (${Math.round(geo.seta && geo.seta.w)}px de largura)`);
    assert(!cruza(geo.seta, geo.copiar), 'não sobrepõe o "Copiar tudo"');
    assert(!cruza(geo.seta, geo.janela), 'não sobrepõe os controles de janela');
    assert(!geo.copiar || geo.seta.r <= geo.copiar.l + 1, 'seta fica à esquerda do "Copiar tudo"');

    console.log('\n4. clicar rola até o fim e a seta some');
    await cdp.evaluate(`(async () => {
      document.getElementById('scroll-to-latest').click();
      await new Promise(r => setTimeout(r, 1500));
    })()`);
    s = await cdp.evaluate(estadoSeta);
    assert(s.distDoFim < 5, `scroll chegou no fim de verdade (faltam ${Math.round(s.distDoFim)}px)`);
    assert(!s.visivel, 'seta sumiu ao chegar no fim');

    console.log('\n5. rolar pra cima de novo traz a seta de volta');
    await cdp.evaluate(`(async () => {
      document.getElementById('transcription').scrollTop = 0;
      await new Promise(r => setTimeout(r, 400));
    })()`);
    s = await cdp.evaluate(estadoSeta);
    assert(s.visivel, 'seta reapareceu depois de rolar pra cima');

    console.log('\n6. sem erro novo no renderer');
    const erros = logs.join('').split('\n').filter(l =>
      /ReferenceError|TypeError|is not defined|Uncaught/.test(l) && /scrollToLatest|scroll-to-latest/.test(l));
    assert(erros.length === 0, `nenhum erro ligado ao módulo novo${erros.length ? ': ' + erros[0] : ''}`);
  } catch (e) {
    fail(`exceção: ${e.message}`);
    console.error(logs.join('').slice(-3000));
  } finally {
    if (cdp && cdp.ws) try { cdp.ws.close(); } catch (_) {}
    try { app.kill(); } catch (_) {}
    await sleep(600);
  }

  console.log(falhas ? `\n${falhas} falha(s).` : '\ntudo ok.');
  process.exit(falhas ? 1 : 0);
})();
