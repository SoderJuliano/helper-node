#!/usr/bin/env node
// Regressão do bug "cliquei em Parar IA e o Copilot segue botando texto na tela
// eternamente".
//
// O test:killtree prova que a ÁRVORE de processos morre. Este prova a coisa que
// o usuário vê: que o STREAM PARA. São defeitos diferentes — o processo podia
// morrer e ainda assim chegar chunk na tela (buffer pendente, filho vivo
// escrevendo no mesmo stdout, callback disparando depois do kill).
//
// Monta um "copilot" falso: um shim .cmd (como o npm instala no Windows) que
// roda um NETO node cuspindo texto sem parar. Liga no CopilotCliProcess de
// verdade, mata com kill() e verifica que nenhum chunk novo chega depois.
//
//   node scripts/test-copilot-stop.js   (npm run test:copilotstop)

const fs = require('fs');
const os = require('os');
const path = require('path');
const { CopilotCliProcess } = require('../services/providers/copilot-cli/CopilotCliProcess');

let falhas = 0;
const ok = (m) => console.log(`  ok   ${m}`);
const fail = (m) => { falhas++; console.error(`  FALHA ${m}`); };
const assert = (c, m) => (c ? ok(m) : fail(m));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'copilot-stop-'));

// Arquivos separados de propósito: gerar o código do neto embutido numa string
// exigia escape aninhado, e um erro de sintaxe ali mataria o neto na largada —
// o teste passaria provando muito menos do que diz (só que o filho direto
// morreu). Cada processo tem seu .js, sem escape.
const NETO = path.join(TMP, 'neto.js');
fs.writeFileSync(NETO, [
  'let m = 0;',
  "setInterval(() => { m++; process.stdout.write('neto ' + m + '\\n'); }, 40);",
].join('\n'));

// Entrypoint que o shim aponta: cospe texto e abre o NETO no mesmo stdout — é
// o neto que sobrevivia ao kill antigo e mantinha texto chegando na tela
// depois do "Parar IA".
const WORKER = path.join(TMP, 'entry.js');
fs.writeFileSync(WORKER, [
  "const { spawn } = require('child_process');",
  'let n = 0;',
  "setInterval(() => { n++; process.stdout.write('pai ' + n + '\\n'); }, 40);",
  `spawn(process.execPath, [${JSON.stringify(NETO)}], { stdio: ['ignore', 'inherit', 'inherit'] });`,
].join('\n'));

// Shim .cmd no formato que o npm gera — o buildSpawnCommand resolve o .js dele
// e spawna node direto, então este teste exercita o caminho real do copilot.
const SHIM = path.join(TMP, 'copilot.cmd');
fs.writeFileSync(SHIM,
  `@echo off\r\nsetlocal\r\nset _prog=node\r\n"%_prog%"  "%dp0%\\entry.js" %*\r\n`);

// Sobe o falso copilot e devolve { proc, chunks(), viuPai(), viuNeto() }.
async function subir() {
  const proc = new CopilotCliProcess();
  const st = { chunks: 0, ultimo: 0, pai: false, neto: false };
  proc.onData((c) => {
    st.chunks++;
    st.ultimo = Date.now();
    if (/pai /.test(c)) st.pai = true;
    if (/neto /.test(c)) st.neto = true;
  });
  await proc.start({ cwd: TMP, model: 'auto', prompt: 'oi', binary: SHIM });
  return { proc, st };
}

// Fase 0: prova que o teste tem dente — matando do jeito ANTIGO (só o filho
// direto, como era antes do killProcessTree), o neto sobrevive e o texto
// continua chegando. Informativo, não assertivo: se algum dia o Windows passar
// a propagar a morte, o teste não deve virar vermelho por isso.
async function conferirJeitoAntigo() {
  const { proc, st } = await subir();
  await sleep(1200);
  if (!st.neto) { console.log('  (neto não subiu; comparativo inconclusivo)'); await proc.kill(); return; }
  try { proc._proc.kill('SIGKILL'); } catch (_) {}
  const noKill = st.chunks;
  await sleep(1500);
  const depois = st.chunks - noKill;
  console.log(`  kill só no filho direto -> ${depois} chunk(s) depois: `
    + (depois > 0 ? 'AINDA STREAMANDO (é o bug que o usuário viu)' : 'parou nesta máquina'));
  await proc.kill(); // limpa o que sobrou
  await sleep(300);
}

(async () => {
  console.log('0. o jeito antigo de matar (pra confirmar que o teste tem dente)');
  await conferirJeitoAntigo();

  console.log('\n=== agora o caminho de verdade (killProcessTree) ===');
  const proc = new CopilotCliProcess();
  let chunks = 0;
  let ultimoChunkEm = 0;
  let viuPai = false;
  let viuNeto = false;
  proc.onData((c) => {
    chunks++;
    ultimoChunkEm = Date.now();
    if (/pai /.test(c)) viuPai = true;
    if (/neto /.test(c)) viuNeto = true;
  });

  await proc.start({ cwd: TMP, model: 'auto', prompt: 'oi', binary: SHIM });

  await sleep(1200);
  assert(chunks > 0, `o falso copilot está streamando (${chunks} chunks)`);
  // Sem estas duas, o teste poderia "passar" com o neto morto na largada,
  // provando só que o filho direto morre — que é justamente o bug antigo.
  assert(viuPai, 'o processo pai está cuspindo texto');
  assert(viuNeto, 'o NETO está cuspindo texto (o que sobrevivia ao kill antigo)');

  console.log('\n1. kill() para o stream');
  const antesDoKill = chunks;
  await proc.kill();
  const noKill = chunks;

  // Janela generosa: se sobrou processo vivo, ele escreve MUITO em 1,5s.
  await sleep(1500);
  const depois = chunks - noKill;
  assert(antesDoKill > 0, 'havia stream em andamento antes do kill');
  assert(depois === 0, `nenhum chunk novo depois do kill (chegaram ${depois})`);

  console.log('\n2. o processo não ficou vivo em segundo plano');
  assert(proc.alive === false, 'processo marcado como morto');
  const paradoHa = Date.now() - ultimoChunkEm;
  assert(paradoHa >= 1400, `stream parado há ${paradoHa}ms`);

  console.log('\n3. kill() de novo não explode nem revive nada');
  await proc.kill();
  await sleep(300);
  assert(chunks === noKill, 'segundo kill é inofensivo');

  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (_) {}

  console.log(falhas ? `\n${falhas} falha(s).` : '\nOK: Parar IA silencia o Copilot de verdade.');
  process.exit(falhas ? 1 : 0);
})().catch((e) => {
  console.error('exceção:', e && e.message);
  process.exit(1);
});
