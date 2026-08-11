// Regressão do bug "cliquei em Parar IA / no × e a CLI continuou alterando os
// arquivos".
//
// Reproduz o cenário real do Windows: a CLI é um shim .cmd, spawnado com
// `shell: true`, então o filho DIRETO do Electron é o cmd.exe e o processo que
// escreve nos arquivos é um NETO. Mata dos dois jeitos e verifica quem de fato
// para de escrever.
//
//   node scripts/test-kill-tree.js

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { killProcessTree } = require('../services/providers/killProcessTree');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'killtree-'));
const WORKER = path.join(TMP, 'worker.js');
const SHIM = path.join(TMP, 'fakecli.cmd');

// O "trabalho" da CLI: escrever num arquivo do projeto sem parar.
fs.writeFileSync(WORKER, `
const fs = require('fs');
const out = process.argv[2];
let n = 0;
setInterval(() => { n++; fs.writeFileSync(out, String(n)); }, 50);
`);

fs.writeFileSync(SHIM, `@echo off\r\n"${process.execPath}" "${WORKER}" %1\r\n`);

const sleep = ms => new Promise(r => setTimeout(r, ms));

function spawnFakeCli(outFile) {
  // shell: true = exatamente o que needsShell() faz com um shim .cmd.
  return spawn(SHIM, [outFile], { shell: true, windowsHide: true, stdio: 'ignore' });
}

// Escreveu depois do kill? Então o processo sobreviveu.
async function stillWriting(outFile) {
  const before = fs.existsSync(outFile) ? fs.readFileSync(outFile, 'utf8') : '';
  await sleep(1200);
  const after = fs.existsSync(outFile) ? fs.readFileSync(outFile, 'utf8') : '';
  return before !== after;
}

(async () => {
  if (process.platform !== 'win32') {
    console.log('SKIP: teste é específico do Windows (shim .cmd + shell:true).');
    return;
  }

  let failures = 0;

  // --- 1. Comportamento ANTIGO: proc.kill() só no filho direto ---
  const outA = path.join(TMP, 'a.txt');
  const procA = spawnFakeCli(outA);
  await sleep(900);
  try { procA.kill('SIGKILL'); } catch (_) {}
  const survivedOld = await stillWriting(outA);
  console.log(`proc.kill() direto      -> neto ainda escrevendo: ${survivedOld}`);
  if (!survivedOld) {
    console.log('  (nota: o cmd.exe repassou a morte nesta máquina; o bug não reproduz aqui)');
  }
  // Não deixa lixo rodando caso tenha sobrevivido.
  await killProcessTree(procA, 'SIGKILL');
  await sleep(300);

  // --- 2. Comportamento NOVO: killProcessTree derruba a árvore ---
  const outB = path.join(TMP, 'b.txt');
  const procB = spawnFakeCli(outB);
  await sleep(900);
  if (!fs.existsSync(outB)) {
    console.error('FALHOU: o worker nem chegou a escrever — teste inválido.');
    process.exit(1);
  }
  await killProcessTree(procB, 'SIGKILL');
  const survivedNew = await stillWriting(outB);
  console.log(`killProcessTree()       -> neto ainda escrevendo: ${survivedNew}`);
  if (survivedNew) {
    console.error('FALHOU: killProcessTree deixou o processo neto vivo.');
    failures++;
  }

  // --- 3. Não pode explodir com processo já morto / pid inexistente ---
  await killProcessTree(null, 'SIGKILL');
  await killProcessTree({ pid: 0 }, 'SIGKILL');
  await killProcessTree(procB, 'SIGKILL'); // já morto
  console.log('killProcessTree(morto)  -> sem exceção: true');

  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (_) {}

  if (failures) {
    console.error(`\n${failures} falha(s).`);
    process.exit(1);
  }
  console.log('\nOK: a árvore inteira morre no Parar IA.');
})();
