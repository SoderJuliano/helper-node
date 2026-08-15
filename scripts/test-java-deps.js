#!/usr/bin/env node
// Teste ponta a ponta do nó "Dependencies" (classpath Java) na árvore do modo
// IDE e da leitura de uma classe de dentro de um jar (caminho virtual
// <jar>!Classe.java, interceptado em read-file-content).
//
// Não depende de `mvn`/`gradle` instalados: a resolução real do classpath é
// testada só até confirmar que falha graciosamente (sem travar a árvore); a
// parte "abrir uma classe de dependência" é testada fim-a-fim com um jar
// fabricado na hora (zip mínimo escrito à mão, sem compressão).
//
// Roda com: node scripts/test-java-deps.js

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const http = require('http');

const PORT = 9900 + Math.floor(Math.random() * 400);
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

// ---------------------------------------------------------------------------
// Zip mínimo escrito à mão (método STORE, sem compressão) — só pra fabricar um
// "-sources.jar" de teste com entradas em '/' (igual jar/maven de verdade),
// sem depender de nenhuma ferramenta de zip do SO.
// ---------------------------------------------------------------------------
function crc32Of(buf) {
  let crc = ~0;
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i];
    for (let j = 0; j < 8; j++) {
      crc = (crc >>> 1) ^ (0xEDB88320 & -(crc & 1));
    }
  }
  return (~crc) >>> 0;
}

function writeMinimalZip(zipPath, entries) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  for (const { name, content } of entries) {
    const nameBuf = Buffer.from(name, 'utf8');
    const dataBuf = Buffer.from(content, 'utf8');
    const crc = crc32Of(dataBuf);

    const lfh = Buffer.alloc(30);
    lfh.writeUInt32LE(0x04034b50, 0);
    lfh.writeUInt16LE(20, 4);
    lfh.writeUInt16LE(0, 6);
    lfh.writeUInt16LE(0, 8); // método STORE
    lfh.writeUInt16LE(0, 10);
    lfh.writeUInt16LE(0, 12);
    lfh.writeUInt32LE(crc, 14);
    lfh.writeUInt32LE(dataBuf.length, 18);
    lfh.writeUInt32LE(dataBuf.length, 22);
    lfh.writeUInt16LE(nameBuf.length, 26);
    lfh.writeUInt16LE(0, 28);
    localParts.push(lfh, nameBuf, dataBuf);

    const cdh = Buffer.alloc(46);
    cdh.writeUInt32LE(0x02014b50, 0);
    cdh.writeUInt16LE(20, 4);
    cdh.writeUInt16LE(20, 6);
    cdh.writeUInt16LE(0, 8);
    cdh.writeUInt16LE(0, 10);
    cdh.writeUInt16LE(0, 12);
    cdh.writeUInt16LE(0, 14);
    cdh.writeUInt32LE(crc, 16);
    cdh.writeUInt32LE(dataBuf.length, 20);
    cdh.writeUInt32LE(dataBuf.length, 24);
    cdh.writeUInt16LE(nameBuf.length, 28);
    cdh.writeUInt16LE(0, 30);
    cdh.writeUInt16LE(0, 32);
    cdh.writeUInt16LE(0, 34);
    cdh.writeUInt16LE(0, 36);
    cdh.writeUInt32LE(0, 38);
    cdh.writeUInt32LE(offset, 42);
    centralParts.push(cdh, nameBuf);

    offset += lfh.length + nameBuf.length + dataBuf.length;
  }
  const centralStart = offset;
  const centralBuf = Buffer.concat(centralParts);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralBuf.length, 12);
  eocd.writeUInt32LE(centralStart, 16);
  eocd.writeUInt16LE(0, 20);
  fs.writeFileSync(zipPath, Buffer.concat([...localParts, centralBuf, eocd]));
}

// ---------------------------------------------------------------------------
// Projetos de teste
// ---------------------------------------------------------------------------
function montarProjetos() {
  const raiz = path.join(os.tmpdir(), 'helper-java-deps-test');
  fs.rmSync(raiz, { recursive: true, force: true });

  // Projeto A: Maven de verdade (tem pom.xml) — deve ganhar o nó "Dependencies".
  const projA = path.join(raiz, 'projeto-maven');
  fs.mkdirSync(path.join(projA, 'src', 'main', 'java', 'com', 'a'), { recursive: true });
  fs.writeFileSync(path.join(projA, 'pom.xml'), '<project></project>');
  fs.writeFileSync(path.join(projA, 'src', 'main', 'java', 'com', 'a', 'App.java'), 'package com.a;\npublic class App {}\n');

  // Projeto B: pasta comum, sem pom.xml/build.gradle — NÃO deve ganhar o nó.
  const projB = path.join(raiz, 'pasta-comum');
  fs.mkdirSync(path.join(projB, 'src'), { recursive: true });
  fs.writeFileSync(path.join(projB, 'src', 'index.js'), 'console.log(1);\n');

  return { raiz, projA, projB };
}

const WS_JSON = path.join(os.homedir(), '.config', 'helper-node', 'workspace.json');
function trocarWorkspace(dirPath) {
  const backup = fs.existsSync(WS_JSON) ? fs.readFileSync(WS_JSON, 'utf8') : null;
  const base = backup ? JSON.parse(backup) : { attachments: [] };
  const semDir = (base.attachments || []).filter(a => a.type !== 'dir');
  fs.mkdirSync(path.dirname(WS_JSON), { recursive: true });
  fs.writeFileSync(WS_JSON, JSON.stringify({
    ...base,
    attachments: [...semDir, { id: 'teste_dir', type: 'dir', path: dirPath, addedAt: new Date().toISOString(), ok: true }],
  }, null, 2));
  return backup;
}

// Sobe o app do zero com `dirPath` já como projeto aberto (workspace.json
// escrito ANTES do spawn — trocar o arquivo com o app já rodando não tem
// efeito, o workspace/store.js só lê do disco na inicialização), roda
// `testFn(cdp, logs)`, e derruba tudo depois. Uma instância por cenário
// porque não há IPC pra trocar de projeto sem o diálogo real do SO.
async function runScenario(dirPath, port, testFn) {
  const backupWs = trocarWorkspace(dirPath);
  const app = spawn(electronPath, [RAIZ, `--remote-debugging-port=${port}`], {
    cwd: RAIZ, env: { ...process.env, ELECTRON_ENABLE_LOGGING: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const logs = [];
  app.stdout.on('data', (c) => logs.push(String(c)));
  app.stderr.on('data', (c) => logs.push(String(c)));

  let cdp;
  try {
    const pagina = await acharPaginaEm(port);
    cdp = await conectar(pagina.webSocketDebuggerUrl);
    await sleep(2500);
    await testFn(cdp, logs);
  } catch (e) {
    fail('exceção: ' + e.message);
  } finally {
    try { cdp && cdp.ws.close(); } catch (_) {}
    try { app.kill(); } catch (_) {}
    await sleep(600);
    if (process.platform === 'win32' && app.pid) {
      try { require('child_process').spawnSync('taskkill', ['/PID', String(app.pid), '/T', '/F'], { stdio: 'ignore' }); } catch (_) {}
    } else { try { app.kill('SIGKILL'); } catch (_) {} }
    try {
      if (backupWs !== null) fs.writeFileSync(WS_JSON, backupWs);
      else fs.rmSync(WS_JSON, { force: true });
    } catch (e) { console.error('ATENÇÃO: falha ao restaurar workspace.json:', e.message); }
  }
}

async function acharPaginaEm(port, tentativas = 40) {
  for (let i = 0; i < tentativas; i++) {
    try {
      const alvos = await getJson(`http://127.0.0.1:${port}/json`);
      const p = alvos.find((t) => t.type === 'page' && /index\.html/.test(t.url || ''));
      if (p && p.webSocketDebuggerUrl) return p;
    } catch (_) {}
    await sleep(500);
  }
  throw new Error('janela principal não apareceu no debugger remoto');
}

function checaErrosRenderer(logs) {
  const erros = (logs.join('').match(/Uncaught (?:Reference|Type)Error[^"\n]*/g) || [])
    .filter(e => !/defineSimpleMode/.test(e));
  assert(erros.length === 0, `sem erro novo no renderer${erros.length ? ': ' + erros[0] : ''}`);
}

(async () => {
  const { raiz, projA, projB } = montarProjetos();

  // Jar de dependência fabricado à mão: bin jar (só precisa existir no disco)
  // + sources jar de verdade com uma classe .java dentro.
  const jarDir = path.join(raiz, 'fake-repo');
  fs.mkdirSync(jarDir, { recursive: true });
  const binJar = path.join(jarDir, 'acme-core-1.0.jar');
  fs.writeFileSync(binJar, 'não é um jar de verdade, só precisa existir para achar o -sources.jar irmão');
  const sourcesJar = path.join(jarDir, 'acme-core-1.0-sources.jar');
  writeMinimalZip(sourcesJar, [
    { name: 'com/acme/Widget.java', content: 'package com.acme;\n\npublic class Widget {\n    public void spin() {}\n}\n' },
  ]);
  console.log('projetos de teste em', raiz);

  console.log('\n=== Cenário A: pasta com pom.xml (' + projA + ') ===');
  await runScenario(projA, PORT, async (cdp, logs) => {
    console.log('\n1. pasta com pom.xml ganha o nó "Dependencies" na raiz da árvore');
    const treeA = await cdp.evaluate('window.electronAPI.getProjectTree()');
    const depsNode = (treeA.entries || []).find(e => e.synthetic === 'java-deps');
    assert(!!depsNode, `nó "Dependencies" presente na árvore do projeto Maven (entradas: ${(treeA.entries || []).map(e => e.name).join(',')})`);
    assert(depsNode && depsNode.depth === 0, `nó "Dependencies" fica na raiz (depth=0), veio depth=${depsNode && depsNode.depth}`);
    assert(depsNode && depsNode.javaType === 'maven', `tipo detectado corretamente como maven (veio ${depsNode && depsNode.javaType})`);

    console.log('\n2. expandir "Dependencies" sem mvn instalado não trava (falha graciosamente)');
    const jarsRes = await cdp.evaluate(`window.electronAPI.javaDepsListJars({ dirPath: ${JSON.stringify(projA)} })`);
    assert(jarsRes && (jarsRes.status === 'building' || jarsRes.status === 'error'), `status building/error sem crash (veio ${jarsRes && jarsRes.status})`);

    console.log('\n2b. clicar no nó "Dependencies" de verdade na árvore (UI) expande sem travar');
    await cdp.evaluate(`(async () => {
      const tg = document.getElementById('ws-tree-toggle');
      if (tg && tg.getAttribute('aria-expanded') !== 'true') tg.click();
      await new Promise(r => setTimeout(r, 800));
    })()`);
    const clickRes = await cdp.evaluate(`(async () => {
      const nodes = Array.from(document.querySelectorAll('#ws-tree .ws-tree-node'));
      const depsEl = nodes.find(n => n.querySelector('.ws-tree-label') && n.querySelector('.ws-tree-label').textContent === 'Dependencies');
      if (!depsEl) return { erro: 'nó Dependencies não achado no DOM' };
      depsEl.click();
      await new Promise(r => setTimeout(r, 4000));
      const depoisNodes = Array.from(document.querySelectorAll('#ws-tree .ws-tree-node'));
      const statusEl = depoisNodes.find(n => n.querySelector('.ws-tree-label') && /Resolvendo|Erro ao resolver|nenhuma dependência/.test(n.querySelector('.ws-tree-label').textContent));
      return { achouStatus: !!statusEl, textoStatus: statusEl && statusEl.querySelector('.ws-tree-label').textContent };
    })()`);
    assert(clickRes && clickRes.achouStatus, `clique real no nó expande e mostra status (veio ${JSON.stringify(clickRes)})`);

    console.log('\n3. abrir uma classe de dentro do jar (caminho virtual) via read-file-content');
    const virtualPath = binJar.replace(/\\/g, '/') + '!com/acme/Widget.java';
    const readRes = await cdp.evaluate(`window.electronAPI.readFileContent(${JSON.stringify(virtualPath)})`);
    assert(readRes && readRes.ok, `read-file-content resolveu o caminho virtual (veio ${JSON.stringify(readRes)})`);
    assert(readRes && readRes.content && readRes.content.includes('public class Widget'), 'conteúdo da classe do jar veio certo');

    console.log('\n4. tentar salvar em cima do caminho virtual é bloqueado (somente leitura)');
    const saveRes = await cdp.evaluate(`window.electronAPI.editorSaveFile({ path: ${JSON.stringify(virtualPath)}, content: 'x' })`);
    assert(saveRes && saveRes.ok === false, `save bloqueado pro caminho virtual (veio ${JSON.stringify(saveRes)})`);

    console.log('\n5. abrir a classe pelo EditorController real → aba somente leitura');
    await cdp.evaluate(`window.EditorController.openFile(${JSON.stringify(virtualPath)})`);
    await sleep(800);
    const editorState = await cdp.evaluate(`(() => {
      const cm = window.EditorController.getCm && window.EditorController.getCm();
      if (!cm) return { erro: 'sem cm' };
      return {
        readOnly: cm.getOption('readOnly'),
        value: cm.getValue(),
        lang: (document.getElementById('fv-lang') || {}).textContent,
      };
    })()`);
    assert(editorState && editorState.readOnly === true, `editor fica somente leitura na aba de dependência (veio ${editorState && editorState.readOnly})`);
    assert(editorState && editorState.value && editorState.value.includes('public class Widget'), 'conteúdo carregado no editor bate com o esperado');
    assert(editorState && /lib/.test(editorState.lang || ''), `badge de linguagem indica dependência (veio "${editorState && editorState.lang}")`);

    checaErrosRenderer(logs);
  });

  console.log('\n=== Cenário B: pasta comum sem pom.xml/build.gradle (' + projB + ') ===');
  await runScenario(projB, PORT + 1, async (cdp, logs) => {
    console.log('\n6. pasta comum NÃO ganha o nó "Dependencies"');
    const treeB = await cdp.evaluate('window.electronAPI.getProjectTree()');
    const depsNodeB = (treeB.entries || []).find(e => e.synthetic === 'java-deps');
    assert(!depsNodeB, 'pasta comum não ganhou nó "Dependencies"');
    checaErrosRenderer(logs);
  });

  try { fs.rmSync(raiz, { recursive: true, force: true }); } catch (_) {}

  console.log(falhas ? `\n${falhas} falha(s).` : '\ntudo ok.');
  process.exit(falhas ? 1 : 0);
})();
