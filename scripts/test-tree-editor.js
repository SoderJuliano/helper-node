#!/usr/bin/env node
// Teste ponta a ponta da árvore de arquivos e dos realces do editor.
//
// Cobre defeitos que só aparecem com o app rodando:
//   1. clique em pasta "não fazia nada" — parte por truncagem no main (pasta
//      sem filho nenhum e sem marca de busca sob demanda), parte porque um
//      rebuild periódico da árvore destruía o nó entre o mousedown e o mouseup
//      e o navegador nunca emitia o `click`;
//   2. só a INTERFACE ganhava ícone de implementação, nunca os métodos dela;
//   3. selecionar palavra não acendia as ocorrências iguais.
//
// Roda com: node scripts/test-tree-editor.js   (npm run test:tree)

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
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

// Projeto Java sintético: interface com 3 métodos + implementação.
function montarProjeto() {
  const raiz = path.join(os.tmpdir(), 'helper-tree-editor-test');
  fs.rmSync(raiz, { recursive: true, force: true });
  const src = path.join(raiz, 'src', 'main', 'java', 'com', 'exemplo');
  fs.mkdirSync(src, { recursive: true });
  fs.writeFileSync(path.join(src, 'PagamentoService.java'),
    'package com.exemplo;\n\npublic interface PagamentoService {\n'
    + '    void processar(String id);\n    boolean validar(String id);\n'
    + '    void estornar(String id, double valor);\n}\n');
  fs.writeFileSync(path.join(src, 'PagamentoServiceImpl.java'),
    'package com.exemplo;\n\npublic class PagamentoServiceImpl implements PagamentoService {\n'
    + '    @Override\n    public void processar(String id) {\n        String pagamento = id;\n'
    + '        System.out.println(pagamento);\n    }\n\n'
    + '    @Override\n    public boolean validar(String id) {\n        return true;\n    }\n\n'
    + '    @Override\n    public void estornar(String id, double valor) {\n    }\n}\n');
  // Muitas pastas, pra exercitar expansão sob demanda.
  for (let i = 1; i <= 6; i++) {
    const d = path.join(raiz, 'modulo-' + i, 'src', 'main', 'java');
    fs.mkdirSync(d, { recursive: true });
    for (let c = 1; c <= 20; c++) fs.writeFileSync(path.join(d, 'C' + c + '.java'), 'class C{}');
  }
  return { raiz, iface: path.join(src, 'PagamentoService.java') };
}

// Não há IPC de "abrir projeto" sem diálogo (é por seleção do usuário), então o
// teste prepara o workspace.json antes de subir o app — e RESTAURA depois, pra
// não trocar o projeto do usuário.
const WS_JSON = path.join(os.homedir(), '.config', 'helper-node', 'workspace.json');
function trocarWorkspace(raiz) {
  const backup = fs.existsSync(WS_JSON) ? fs.readFileSync(WS_JSON, 'utf8') : null;
  const base = backup ? JSON.parse(backup) : { attachments: [] };
  const semDir = (base.attachments || []).filter(a => a.type !== 'dir');
  fs.mkdirSync(path.dirname(WS_JSON), { recursive: true });
  fs.writeFileSync(WS_JSON, JSON.stringify({
    ...base,
    attachments: [...semDir, { id: 'teste_dir', type: 'dir', path: raiz, addedAt: new Date().toISOString(), ok: true }],
  }, null, 2));
  return backup;
}

(async () => {
  const proj = montarProjeto();
  const backupWs = trocarWorkspace(proj.raiz);
  console.log('projeto de teste em', proj.raiz);
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

    console.log('\n1. árvore com vários projetos');
    const tree = await cdp.evaluate('window.electronAPI.getProjectTree()');
    const topo = (tree.entries || []).filter(e => e.depth === 0);
    assert(topo.length === 7, `todas as 7 pastas de topo na árvore (veio ${topo.length})`);
    const mudas = (tree.entries || []).filter(e =>
      e.isDir && !e.lazy && !(tree.entries || []).some(y => y.path.startsWith(e.path + path.sep)));
    assert(mudas.length === 0, `nenhuma pasta muda (clique sem efeito): ${mudas.length}`);

    console.log('\n2. expansão sob demanda é barata');
    const t0 = Date.now();
    const filhos = await cdp.evaluate(
      `window.electronAPI.getDirChildren(${JSON.stringify(path.join(proj.raiz, 'modulo-1', 'src', 'main', 'java'))})`);
    const ms = Date.now() - t0;
    assert(filhos && filhos.ok && filhos.entries.length === 20, `20 filhos imediatos (veio ${filhos && filhos.entries.length})`);
    assert(ms < 500, `expansão respondeu rápido (${ms}ms)`);

    console.log('\n3. árvore não é reconstruída sozinha (o que comia os cliques)');
    await cdp.evaluate(`(async () => {
      const tg = document.getElementById('ws-tree-toggle');
      if (tg && tg.getAttribute('aria-expanded') !== 'true') tg.click();
      await new Promise(r => setTimeout(r, 1200));
    })()`);
    let nosAntes = null;
    for (let i = 0; i < 12; i++) {
      nosAntes = await cdp.evaluate('(() => { const n = document.querySelectorAll("#ws-tree .ws-tree-node")[0]; if(!n) return null; n.dataset.marcaTeste = "1"; return document.querySelectorAll("#ws-tree .ws-tree-node").length; })()');
      if (nosAntes) break;
      await sleep(500);
    }
    if (nosAntes) {
      // 9s cobre o ciclo de 8s que antes fazia innerHTML='' e recriava tudo.
      await sleep(9500);
      const sobreviveu = await cdp.evaluate('!!document.querySelector("#ws-tree .ws-tree-node[data-marca-teste=\'1\']")');
      assert(sobreviveu, 'nó da árvore sobrevive ao ciclo de git status (não é recriado)');
    } else {
      fail('árvore não renderizou nós');
    }

    console.log('\n4. ícone de implementação por MÉTODO');
    // A indexação roda em segundo plano; perguntar antes dela terminar devolve
    // lista vazia por motivo legítimo. Espera o índice ficar pronto.
    let gutter = [];
    for (let i = 0; i < 25; i++) {
      gutter = await cdp.evaluate(
        `window.electronAPI.codeNavGetGutterInfo({ filePath: ${JSON.stringify(proj.iface)} })`) || [];
      if (gutter.length) break;
      await sleep(600);
    }
    const metodos = (gutter || []).filter(g => g.kind === 'interface-method');
    assert(metodos.length === 3, `3 ícones de método (veio ${metodos.length})`);
    const proc = metodos.find(m => m.symbol === 'processar');
    assert(proc && proc.target && proc.target.line === 5,
      `"processar" aponta pra linha do método na impl (veio ${proc && proc.target && proc.target.line})`);

    console.log('\n5. realce de ocorrências da palavra selecionada');
    await cdp.evaluate(`window.EditorController.openFile(${JSON.stringify(path.join(proj.raiz, 'src', 'main', 'java', 'com', 'exemplo', 'PagamentoServiceImpl.java'))})`);
    await sleep(1800);
    const realces = await cdp.evaluate(`(async () => {
      const cm = window.EditorController.getCm && window.EditorController.getCm();
      if (!cm) return { erro: 'sem cm' };
      window.CodeHighlight.attach(cm);
      // seleciona a palavra "pagamento" (aparece 2x no corpo do metodo)
      const texto = cm.getValue();
      const linhas = texto.split('\\n');
      let alvo = -1, ch = -1;
      for (let i = 0; i < linhas.length; i++) { const k = linhas[i].indexOf('pagamento'); if (k !== -1) { alvo = i; ch = k; break; } }
      if (alvo === -1) return { erro: 'palavra nao encontrada' };
      cm.setSelection({ line: alvo, ch }, { line: alvo, ch: ch + 'pagamento'.length });
      await new Promise(r => setTimeout(r, 400));
      return { marcas: document.querySelectorAll('.cm-occurrence-highlight').length };
    })()`);
    assert(realces && realces.marcas >= 2,
      `ocorrências iguais acendem juntas (${realces && (realces.marcas ?? realces.erro)})`);

    const limpou = await cdp.evaluate(`(async () => {
      const cm = window.EditorController.getCm();
      cm.setCursor({ line: 0, ch: 0 });
      await new Promise(r => setTimeout(r, 400));
      return document.querySelectorAll('.cm-occurrence-highlight').length;
    })()`);
    assert(limpou === 0, `realce some ao desselecionar (sobraram ${limpou})`);

    console.log('\n6. busca de usos sai do índice em memória (não do disco)');
    // Roda a cada hover sobre um identificador, no processo main. Quando relia
    // todo o projeto do disco levava 722ms num projeto de 2.000 arquivos — e o
    // app inteiro ficava parado nesse tempo.
    const tUso = Date.now();
    const usos = await cdp.evaluate(
      `window.electronAPI.codeNavFindUsages({ filePath: ${JSON.stringify(proj.iface)}, symbol: 'processar' })`);
    const msUso = Date.now() - tUso;
    assert(Array.isArray(usos), 'findUsages responde');
    assert(msUso < 300, `busca de usos rápida (${msUso}ms, era ~700ms relendo o disco)`);

    console.log('\n7. nome do arquivo cabe na aba');
    const aba = await cdp.evaluate(`(() => {
      const el = document.querySelector('.fv-tab.active .fv-tab-name') || document.querySelector('.fv-tab-name');
      if (!el) return null;
      const tab = el.closest('.fv-tab');
      return {
        texto: el.textContent,
        scrollW: el.scrollWidth, clientW: el.clientWidth,
        larguraAba: tab ? Math.round(tab.getBoundingClientRect().width) : null,
      };
    })()`);
    if (aba) {
      assert(aba.texto === 'PagamentoServiceImpl.java', `aba mostra o nome completo ("${aba.texto}")`);
      assert(aba.scrollW <= aba.clientW + 1,
        `nome não cortado (precisa ${aba.scrollW}px, tem ${aba.clientW}px; aba ${aba.larguraAba}px)`);
    } else {
      fail('nenhuma aba encontrada');
    }

    console.log('\n8. bloco de código grande na resposta do chat');
    // O parser de cerca antigo fechava o bloco na primeira crase tripla que
    // achasse EM QUALQUER LUGAR, inclusive no meio de uma linha de código. Um
    // bloco de 300 linhas virava 5 no <pre> (o resto virava texto solto, então
    // o usuário via tudo mas copiava só 5 linhas), e bloco sem fechamento não
    // gerava <pre> nenhum ("copiei a resposta e veio sem o bloco").
    const md = await cdp.evaluate(`(() => {
      var NL = String.fromCharCode(10), F = String.fromCharCode(96,96,96), D = String.fromCharCode(36);
      function corpo(n){var a=[];for(var i=1;i<=n;i++)a.push('  const linha'+i+' = v('+i+');');return a.join(NL);}
      function linhasNoPre(md){
        var d=document.createElement('div'); d.innerHTML=window.renderMarkdown(md,'t');
        var c=d.querySelector('pre code'); return c?c.textContent.split(NL).length:0;
      }
      return {
        normal:      linhasNoPre('x'+NL+NL+F+'js'+NL+corpo(300)+NL+F),
        meioDaLinha: linhasNoPre('x'+NL+NL+F+'js'+NL+corpo(5)+NL+'  log("'+F+'");'+NL+corpo(294)+NL+F),
        semFechar:   linhasNoPre('x'+NL+NL+F+'js'+NL+corpo(300)),
        cifrao:      linhasNoPre('x'+NL+NL+F+'js'+NL+'  s = "'+D+"'"+'";'+NL+corpo(299)+NL+F)
      };
    })()`);
    assert(md && md.normal === 300, `bloco normal íntegro (${md && md.normal}/300 linhas)`);
    assert(md && md.meioDaLinha === 300, `crase tripla no meio da linha não corta o bloco (${md && md.meioDaLinha}/300)`);
    assert(md && md.semFechar === 300, `bloco sem cerca de fechamento vira <pre> mesmo assim (${md && md.semFechar}/300)`);
    assert(md && md.cifrao === 300, `código com $' não corrompe o bloco (${md && md.cifrao}/300)`);

    console.log('\n9. entrada da Nexa fora da UI');
    const nexaNaUi = await cdp.evaluate(
      `!!document.body.innerHTML.match(/Nexa AI Assistant/)`);
    assert(!nexaNaUi, 'nenhum label da Nexa na interface');

    const erros = (logs.join('').match(/Uncaught (?:Reference|Type)Error[^"\n]*/g) || [])
      .filter(e => !/defineSimpleMode/.test(e));
    assert(erros.length === 0, `sem erro novo no renderer${erros.length ? ': ' + erros[0] : ''}`);

  } catch (e) {
    fail('exceção: ' + e.message);
  } finally {
    try { cdp && cdp.ws.close(); } catch (_) {}
    try { app.kill(); } catch (_) {}
    await sleep(600);
    if (process.platform === 'win32' && app.pid) {
      try { require('child_process').spawnSync('taskkill', ['/PID', String(app.pid), '/T', '/F'], { stdio: 'ignore' }); } catch (_) {}
    } else { try { app.kill('SIGKILL'); } catch (_) {} }
    // Devolve o projeto do usuário antes de qualquer coisa.
    try {
      if (backupWs !== null) fs.writeFileSync(WS_JSON, backupWs);
      else fs.rmSync(WS_JSON, { force: true });
      console.log('workspace do usuário restaurado.');
    } catch (e) { console.error('ATENÇÃO: falha ao restaurar workspace.json:', e.message); }
    try { fs.rmSync(proj.raiz, { recursive: true, force: true }); } catch (_) {}
  }

  console.log(falhas ? `\n${falhas} falha(s).` : '\ntudo ok.');
  process.exit(falhas ? 1 : 0);
})();
