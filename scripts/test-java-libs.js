#!/usr/bin/env node
// Teste das bibliotecas externas Java: resolução no repositório local, leitura
// dos -sources.jar e "ir para a definição" de uma classe de biblioteca.
//
// Parte roda fora do Electron (serviço puro, multiplataforma) e parte no app
// real por CDP (nó "Bibliotecas" na árvore + IPC).
//
// Roda com: node scripts/test-java-libs.js   (npm run test:libs)

const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');

const RAIZ = path.join(__dirname, '..');
const PORT = 9800 + Math.floor(Math.random() * 200);
const electronPath = require('electron');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

let falhas = 0;
const ok = (m) => console.log(`  ok   ${m}`);
const fail = (m) => { falhas++; console.error(`  FALHA ${m}`); };
const assert = (c, m) => (c ? ok(m) : fail(m));

function getJson(u) {
  return new Promise((res, rej) => {
    http.get(u, r => { let b = ''; r.on('data', c => b += c); r.on('end', () => { try { res(JSON.parse(b)); } catch (e) { rej(e); } }); }).on('error', rej);
  });
}

// Projeto Maven sintético apontando pra artefatos que existam no repo local.
function montarProjeto(libDisponivel) {
  const raiz = path.join(os.tmpdir(), 'helper-libs-test');
  fs.rmSync(raiz, { recursive: true, force: true });
  const src = path.join(raiz, 'src', 'main', 'java', 'com', 'ex');
  fs.mkdirSync(src, { recursive: true });
  fs.writeFileSync(path.join(raiz, 'pom.xml'),
    '<project><modelVersion>4.0.0</modelVersion>\n'
    + '<groupId>com.ex</groupId><artifactId>teste</artifactId><version>1.0</version>\n'
    + '<properties><versao.lib>' + libDisponivel.version + '</versao.lib></properties>\n'
    + '<dependencies><dependency>\n'
    + `  <groupId>${libDisponivel.groupId}</groupId>\n`
    + `  <artifactId>${libDisponivel.artifactId}</artifactId>\n`
    + '  <version>${versao.lib}</version>\n'
    + '</dependency></dependencies></project>\n');
  fs.writeFileSync(path.join(src, 'Uso.java'),
    `package com.ex;\nimport ${libDisponivel.pacoteClasse}.${libDisponivel.classe};\n`
    + `public class Uso {\n    private ${libDisponivel.classe} campo;\n}\n`);
  return { raiz, arquivo: path.join(src, 'Uso.java') };
}

// Procura no ~/.m2 um artefato que tenha -sources.jar, pra o teste não depender
// de uma dependência específica estar baixada nesta máquina.
function acharLibComFonte() {
  const repo = path.join(os.homedir(), '.m2', 'repository');
  if (!fs.existsSync(repo)) return null;
  const pilha = [{ dir: repo, partes: [] }];
  while (pilha.length) {
    const { dir, partes } = pilha.pop();
    if (partes.length > 8) continue;
    let entradas = [];
    try { entradas = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { continue; }
    const fonte = entradas.find(e => e.isFile() && /-sources\.jar$/.test(e.name));
    if (fonte && partes.length >= 2) {
      const version = partes[partes.length - 1];
      const artifactId = partes[partes.length - 2];
      const groupId = partes.slice(0, -2).join('.');
      const zip = require(path.join(RAIZ, 'services', 'javaLibs', 'zipReader.js'));
      const java = zip.listarEntradas(path.join(dir, fonte.name)).filter(e => e.nome.endsWith('.java'));
      if (java.length) {
        const alvo = java.find(e => !/package-info|module-info/.test(e.nome)) || java[0];
        return {
          groupId, artifactId, version,
          classe: path.basename(alvo.nome, '.java'),
          pacoteClasse: path.dirname(alvo.nome).replace(/\//g, '.'),
          sourcesJar: path.join(dir, fonte.name),
        };
      }
    }
    for (const e of entradas) if (e.isDirectory()) pilha.push({ dir: path.join(dir, e.name), partes: [...partes, e.name] });
  }
  return null;
}

const WS_JSON = path.join(os.homedir(), '.config', 'helper-node', 'workspace.json');
function trocarWorkspace(raiz) {
  const backup = fs.existsSync(WS_JSON) ? fs.readFileSync(WS_JSON, 'utf8') : null;
  const base = backup ? JSON.parse(backup) : { attachments: [] };
  const semDir = (base.attachments || []).filter(a => a.type !== 'dir');
  fs.mkdirSync(path.dirname(WS_JSON), { recursive: true });
  fs.writeFileSync(WS_JSON, JSON.stringify({
    ...base,
    attachments: [...semDir, { id: 'teste_libs', type: 'dir', path: raiz, addedAt: new Date().toISOString(), ok: true }],
  }, null, 2));
  return backup;
}

(async () => {
  console.log('=== parte 1: serviço puro (sem Electron) ===\n');
  const javaLibs = require(path.join(RAIZ, 'services', 'javaLibs'));
  const sourceIndex = require(path.join(RAIZ, 'services', 'javaLibs', 'sourceIndex.js'));

  const repos = javaLibs.repositoriosLocais();
  console.log(`  repositórios locais detectados: ${repos.length}`);
  repos.forEach(r => console.log(`    ${r}`));
  assert(repos.length > 0, 'achou ao menos um repositório local');

  const lib = acharLibComFonte();
  if (!lib) {
    console.log('\n  nenhum -sources.jar no ~/.m2 desta máquina — teste inconclusivo.');
    console.log('  (baixe fontes com: mvn dependency:sources num projeto Java)');
    process.exit(0);
  }
  console.log(`\n  artefato de teste: ${lib.groupId}:${lib.artifactId}:${lib.version} (classe ${lib.classe})`);

  const proj = montarProjeto(lib);
  const r = javaLibs.listarBibliotecas(proj.raiz);
  assert(r.ok && r.libs.length === 1, `pom.xml resolvido (${r.libs.length} lib)`);
  assert(r.libs[0] && r.libs[0].version === lib.version,
    `\${propriedade} da versão resolvida (${r.libs[0] && r.libs[0].version})`);
  assert(r.libs[0] && r.libs[0].temFonte, 'sources.jar localizado no repositório');

  sourceIndex.limpar();
  const idx = sourceIndex.indexar(proj.raiz);
  assert(idx.ok && idx.classes > 0, `índice de classes montado (${idx.classes} classes, ${idx.ms}ms)`);

  const def = sourceIndex.abrirDefinicao(lib.classe);
  assert(def && def.filePath, `"ir para definição" resolve ${lib.classe}`);
  if (def) {
    assert(fs.existsSync(def.filePath), 'fonte extraído pro cache em disco');
    const txt = fs.readFileSync(def.filePath, 'utf8');
    assert(txt.length > 0 && /class|interface|enum|record/.test(txt), 'conteúdo extraído é código Java');
    assert(def.somenteLeitura === true, 'marcado como somente leitura');
    assert(sourceIndex.ehCaminhoDeCache(def.filePath), 'caminho reconhecido como cache de biblioteca');
    assert(!sourceIndex.ehCaminhoDeCache(path.join(os.homedir(), 'outro.java')),
      'caminho fora do cache NÃO é liberado');
  }

  console.log('\n=== parte 2: app real (IPC + árvore) ===\n');
  const backupWs = trocarWorkspace(proj.raiz);
  const app = spawn(electronPath, [RAIZ, `--remote-debugging-port=${PORT}`], {
    cwd: RAIZ, env: { ...process.env, ELECTRON_ENABLE_LOGGING: '1' }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  const logs = [];
  app.stdout.on('data', c => logs.push(String(c)));
  app.stderr.on('data', c => logs.push(String(c)));

  let ws;
  try {
    let pg;
    for (let i = 0; i < 40; i++) {
      try { const a = await getJson(`http://127.0.0.1:${PORT}/json`); pg = a.find(t => t.type === 'page' && /index\.html/.test(t.url || '')); if (pg) break; } catch (_) {}
      await sleep(500);
    }
    ws = new WebSocket(pg.webSocketDebuggerUrl);
    let id = 0; const pend = new Map();
    ws.addEventListener('message', ev => { const m = JSON.parse(ev.data); const p = pend.get(m.id); if (p) { pend.delete(m.id); p(m); } });
    await new Promise(res => ws.addEventListener('open', res));
    const ev = async (e) => {
      const my = ++id;
      const rr = await new Promise(res => { pend.set(my, res); ws.send(JSON.stringify({ id: my, method: 'Runtime.evaluate', params: { expression: e, awaitPromise: true, returnByValue: true } })); });
      if (rr.result?.exceptionDetails) return { ERRO: rr.result.exceptionDetails.exception?.description };
      return rr.result?.result?.value;
    };
    // Esperar só pelo preload não basta: ele fica pronto ANTES do body ser
    // parseado e dos scripts do renderer rodarem. window.Libraries só existe
    // quando renderer/libraries.js já executou — é esse o sinal certo.
    let pronto = false;
    for (let i = 0; i < 60; i++) {
      if (await ev('!!(window.Libraries && window.electronAPI && window.electronAPI.libsList)') === true) { pronto = true; break; }
      await sleep(500);
    }
    assert(pronto, 'renderer carregado (window.Libraries disponível)');

    const lista = await ev('window.electronAPI.libsList()');
    assert(lista && lista.ok && lista.libs.length === 1, `IPC libs:list responde (${lista && lista.libs && lista.libs.length} lib)`);

    const aberta = await ev(`window.electronAPI.libsOpenClass({ className: ${JSON.stringify(lib.classe)}, imports: [] })`);
    assert(aberta && aberta.filePath, 'IPC libs:open-class devolve o fonte');

    // O fonte fica fora do workspace: a leitura precisa aceitá-lo mesmo assim.
    const leitura = await ev(`window.electronAPI.readFileContent(${JSON.stringify((aberta && aberta.filePath) || '')})`);
    assert(leitura && leitura.ok && leitura.content && leitura.content.length > 0,
      `leitura do fonte liberada${leitura && !leitura.ok ? ' — ' + leitura.error : ''}`);

    // Ctrl+clique numa classe de lib: findDefinition tem que cair no fallback.
    const nav = await ev(`window.electronAPI.codeNavFindDefinition({
      filePath: ${JSON.stringify(proj.arquivo)}, symbol: ${JSON.stringify(lib.classe)}, lineText: '    ${lib.classe} campo;'
    })`);
    assert(Array.isArray(nav) && nav.length > 0 && nav[0].kind === 'library',
      'Ctrl+clique em classe de biblioteca acha a definição');

    const no = await ev(`(() => {
      const host = document.getElementById('ws-libs');
      const cab = host && host.querySelector('.ws-tree-node');
      return { existe: !!host, cabecalho: cab ? cab.textContent.trim() : null };
    })()`);
    assert(no && no.existe && /Bibliotecas/.test(no.cabecalho || ''),
      `nó "Bibliotecas" na árvore (${no && (no.cabecalho || no.ERRO)})`);

    const aberto = await ev(`(async () => {
      const r = await window.Libraries.abrir();
      return {
        libs: r && r.libs ? r.libs.length : 0,
        itensNaTela: document.querySelectorAll('#ws-libs .ws-lib').length,
        marcas: Array.from(document.querySelectorAll('#ws-libs .ws-lib-tag')).map(e => e.textContent)
      };
    })()`);
    assert(aberto && aberto.itensNaTela >= 1,
      `lista renderizada (${aberto && (aberto.itensNaTela + ' item, marcas: ' + JSON.stringify(aberto.marcas))})`);

    const erros = (logs.join('').match(/Uncaught (?:Reference|Type)Error[^"\n]*/g) || [])
      .filter(e => !/defineSimpleMode/.test(e));
    assert(erros.length === 0, `sem erro novo no renderer${erros.length ? ': ' + erros[0] : ''}`);
  } catch (e) {
    fail('exceção: ' + e.message);
  } finally {
    try { ws && ws.close(); } catch (_) {}
    try { app.kill(); } catch (_) {}
    await sleep(600);
    if (process.platform === 'win32' && app.pid) {
      try { require('child_process').spawnSync('taskkill', ['/PID', String(app.pid), '/T', '/F'], { stdio: 'ignore' }); } catch (_) {}
    } else { try { app.kill('SIGKILL'); } catch (_) {} }
    try {
      if (backupWs !== null) fs.writeFileSync(WS_JSON, backupWs);
      else fs.rmSync(WS_JSON, { force: true });
      console.log('\nworkspace do usuário restaurado.');
    } catch (e) { console.error('ATENÇÃO: falha ao restaurar workspace.json:', e.message); }
    try { fs.rmSync(proj.raiz, { recursive: true, force: true }); } catch (_) {}
  }

  console.log(falhas ? `\n${falhas} falha(s).` : '\ntudo ok.');
  process.exit(falhas ? 1 : 0);
})();
