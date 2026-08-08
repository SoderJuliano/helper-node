#!/usr/bin/env node
// Teste ponta a ponta do terminal embutido.
//
// Um terminal não dá pra testar por leitura de código: o que importa é o que
// chegou na tela. Este script sobe o app de verdade com o debugger remoto do
// Chromium ligado, abre a aba do terminal, digita comandos no xterm como um
// humano digitaria, e depois LÊ o buffer do emulador — o texto e os atributos
// de cor de cada célula.
//
// Cobre os defeitos relatados, que vinham todos do emulador VT100 caseiro:
//   1. saída do git chegando sem cor nenhuma (o SGR era picado e sobrescrito);
//   2. tela embaralhando depois de vários comandos coloridos;
//   3. texto cortado na direita (ConPTY fixo em 120 colunas, sem resize);
//   4. o prompt e o comando saindo grudados/fora de lugar.
//
// Roda com: node scripts/test-terminal.js   (npm run test:terminal)

const { spawn } = require('child_process');
const path = require('path');
const http = require('http');

const PORT = 9333;
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

/** Espera o alvo da janela principal aparecer no debugger remoto. */
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
        // Avalia no renderer e devolve o valor (JSON-serializável).
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

// Digita no xterm como o usuário digita: caractere a caractere pelo onData.
const digitar = (texto) => `window._term._core.coreService.triggerDataEvent(${JSON.stringify(texto)}, true)`;

// Lê o buffer do xterm: linhas físicas, linhas LÓGICAS (remontando o que o
// emulador quebrou na borda) e quantas células têm cor de verdade.
//
// A distinção importa: numa largura de 54 colunas um comando longo ocupa duas
// linhas físicas, e procurar o texto inteiro numa linha só falha por motivo
// nenhum. Quebrar na borda é o comportamento CERTO — o defeito era o texto
// sumir, não quebrar.
const LER_BUFFER = `(() => {
  const t = window._term;
  if (!t) return { erro: 'xterm não montou' };
  const buf = t.buffer.active;
  const fisicas = [];
  const logicas = [];
  let comCor = 0, celulas = 0;
  for (let y = 0; y < buf.length; y++) {
    const linha = buf.getLine(y);
    if (!linha) continue;
    const txt = linha.translateToString(true);
    fisicas.push(txt);
    // isWrapped = esta linha é continuação da anterior (não houve \\n).
    if (linha.isWrapped && logicas.length) logicas[logicas.length - 1] += linha.translateToString(false);
    else logicas.push(txt);
    for (let x = 0; x < linha.length; x++) {
      const c = linha.getCell(x);
      if (!c || !c.getChars()) continue;
      celulas++;
      if (c.isFgPalette() || c.isFgRGB() || c.isBold()) comCor++;
    }
  }
  return { cols: t.cols, rows: t.rows, linhas: fisicas, logicas: logicas.map(l => l.replace(/\\s+$/, '')), comCor, celulas };
})()`;

(async () => {
  console.log('subindo o app com o debugger remoto...');
  const app = spawn(electronPath, [RAIZ, `--remote-debugging-port=${PORT}`], {
    cwd: RAIZ,
    env: { ...process.env, ELECTRON_ENABLE_LOGGING: '1' },
    stdio: 'ignore',
  });

  let cdp;
  try {
    const pagina = await acharPagina();
    cdp = await conectar(pagina.webSocketDebuggerUrl);
    await cdp.evaluate('1');

    console.log('\n1) a aba do terminal monta o xterm');
    // O alvo aparece no debugger antes de o DOM existir; espera o botão.
    for (let i = 0; i < 40; i++) {
      const pronto = await cdp.evaluate(
        "document.readyState === 'complete' && !!document.getElementById('tab-btn-terminal')"
      );
      if (pronto) break;
      await sleep(500);
    }
    await cdp.evaluate("document.getElementById('tab-btn-terminal').click()");
    await sleep(2500);
    const montou = await cdp.evaluate("!!window._term");
    assert(montou, 'xterm.js montou no painel');
    if (!montou) throw new Error('sem xterm, o resto não faz sentido');

    console.log('\n2) o PTY nasce com a largura REAL do painel (não 120 fixo)');
    const dims = await cdp.evaluate('({ cols: window._term.cols, rows: window._term.rows })');
    assert(dims.cols > 0 && dims.rows > 0, `xterm mediu o painel: ${dims.cols}x${dims.rows}`);
    assert(dims.cols !== 120 || dims.rows !== 30,
      `tamanho medido, não o padrão fixo de 120x30 (é ${dims.cols}x${dims.rows})`);

    console.log('\n3) git status colorido — o sintoma principal');
    await cdp.evaluate(digitar('git -c color.status=always status -s -b\r'));
    await sleep(3000);
    const st = await cdp.evaluate(LER_BUFFER);
    const texto = st.linhas.join('\n');
    // Casa o cabeçalho de QUALQUER branch (`## avatar...`), não só master/HEAD —
    // a versão antiga acusava falha sempre que o teste rodava fora da master.
    assert(/##\s+\S+/.test(texto), `git status apareceu na tela`);
    assert(st.comCor > 0, `saída COLORIDA: ${st.comCor} de ${st.celulas} células com cor/negrito`);
    assert(!/\x1b|\[3[0-9]m|\[0m/.test(texto), 'nenhum lixo de escape ANSI vazou como texto');

    console.log('\n4) prompt e comando não saem grudados/embaralhados');
    // O eco do comando tem que sair na MESMA linha lógica do prompt (é assim num
    // terminal de verdade) e não colado no meio de outra saída.
    const linhaDoComando = st.logicas.find((l) => l.includes('git -c color.status'));
    assert(!!linhaDoComando, `o comando digitado foi ecoado`);
    assert(/[>$#]\s*git -c color\.status/.test(linhaDoComando || ''),
      `o comando veio logo após o prompt: ${JSON.stringify((linhaDoComando || '').slice(-55))}`);
    // A saída do git começa numa linha nova, não emendada no comando.
    const idxCmd = st.logicas.indexOf(linhaDoComando);
    assert(idxCmd >= 0 && !/##/.test(linhaDoComando || ''),
      'a saída do git não veio grudada na linha do comando');

    console.log('\n5) vários comandos coloridos seguidos — a tela não desanda');
    await cdp.evaluate(digitar('git -c color.ui=always log --oneline -3\r'));
    await sleep(2500);
    await cdp.evaluate(digitar('git -c color.ui=always branch -a\r'));
    await sleep(2500);
    await cdp.evaluate(digitar('git -c color.ui=always diff --stat HEAD~1\r'));
    await sleep(3000);
    const depois = await cdp.evaluate(LER_BUFFER);
    const txt2 = depois.linhas.join('\n');
    assert(!/\x1b/.test(txt2), 'depois de 4 comandos coloridos, nenhum escape cru na tela');
    assert(depois.comCor > st.comCor, `a cor continua funcionando (${depois.comCor} células)`);
    // O bug antigo grudava palavras por causa do índice de coluna dessincronizado.
    assert(!/[a-z]{2}(modified|deleted|renamed):/.test(txt2), 'nenhuma palavra grudada no meio de outra');

    console.log('\n6) resize chega no PTY (o corte na direita)');
    const antes = await cdp.evaluate('window._term.cols');
    await cdp.evaluate(`(() => {
      const c = document.getElementById('terminal-container-element');
      c.style.height = '420px';
      window.dispatchEvent(new Event('resize'));
      return true;
    })()`);
    await sleep(1200);
    const depoisRows = await cdp.evaluate('window._term.rows');
    assert(depoisRows > dims.rows, `o xterm recalculou as linhas: ${dims.rows} -> ${depoisRows}`);
    // Linha mais longa que a largura tem que QUEBRAR, não sumir.
    await cdp.evaluate(digitar(`node -e "console.log('L'.repeat(${antes} + 40))"\r`));
    await sleep(2500);
    const largo = await cdp.evaluate(LER_BUFFER);
    const totalL = largo.linhas.join('').split('').filter((c) => c === 'L').length;
    assert(totalL >= antes + 40, `nenhum caractere sumiu na borda direita (${totalL} de ${antes + 40} Ls)`);

    console.log('\n7) vim (o editor do `git pull`) fica VISÍVEL e controlável');
    // Este era o pior sintoma: o emulador antigo DESCARTAVA o \\x1b[?1049h, então
    // a tela do editor nunca aparecia — dava pra digitar :wq no escuro e torcer.
    // xterm.js tem alternate screen de verdade, e `buffer.active.type` diz qual
    // está no ar. É a prova direta.
    await cdp.evaluate(digitar('vim %TEMP%\\helper-vim-teste.txt\r'));
    await sleep(3500);
    const tipoDentro = await cdp.evaluate("window._term.buffer.active.type");
    const telaVim = await cdp.evaluate(LER_BUFFER);
    assert(tipoDentro === 'alternate', `o editor entrou na tela alternativa (buffer=${tipoDentro})`);
    assert(telaVim.linhas.some((l) => l.trimStart().startsWith('~')),
      'a interface do vim está desenhada na tela (coluna de ~)');

    // Sai como um humano sairia: ESC, :q!, Enter — tecla a tecla pelo PTY.
    await cdp.evaluate(digitar('\x1b'));
    await sleep(300);
    await cdp.evaluate(digitar(':q!\r'));
    await sleep(2500);
    const tipoFora = await cdp.evaluate("window._term.buffer.active.type");
    assert(tipoFora === 'normal', `saiu do editor e voltou pro shell (buffer=${tipoFora})`);

  } catch (e) {
    fail(`erro no teste: ${e.message}`);
  } finally {
    try { cdp && cdp.ws.close(); } catch (_) {}
    try { app.kill(); } catch (_) {}
    // O Electron pode demorar a soltar; força a saída.
    setTimeout(() => process.exit(falhas === 0 ? 0 : 1), 1500);
  }

  console.log(falhas === 0 ? '\nTUDO OK' : `\n${falhas} FALHA(S)`);
})();
