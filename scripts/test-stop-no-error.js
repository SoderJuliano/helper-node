#!/usr/bin/env node
// Regressão do relato: "depois que clica em Parar IA da um erro vermelho na
// tela e o Copilot segue printando a resposta dentro do span de erro".
//
// São dois defeitos diferentes do "matar o processo" (que o test:copilotstop já
// cobre):
//   A) o provider tratava o processo morto A PEDIDO como falha (código de saída
//      ≠ 0) e mandava 'transcription-error' → erro vermelho na tela;
//   B) os chunks que já estavam no pipe continuavam sendo enviados pro renderer
//      durante os ~800ms do kill, e o renderer os aceitava mesmo cancelado.
//
// Parte 1 (main): roda o CopilotCliProvider de verdade contra um copilot falso,
// aborta no meio e verifica que NÃO sai transcription-error e que nenhum chunk
// sai depois do abort.
// Parte 2 (renderer): confere a guarda do onStreamChunk e, principalmente, que
// o flag é destravado nos turnos novos — um flag preso deixaria o chat mudo.
//
//   node scripts/test-stop-no-error.js   (npm run test:stopnoerror)

const fs = require('fs');
const os = require('os');
const path = require('path');

let falhas = 0;
const ok = (m) => console.log(`  ok   ${m}`);
const fail = (m) => { falhas++; console.error(`  FALHA ${m}`); };
const assert = (c, m) => (c ? ok(m) : fail(m));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- copilot falso que streama sem parar ----------
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'stop-noerror-'));
const ENTRY = path.join(TMP, 'entry.js');
fs.writeFileSync(ENTRY, [
  'let n = 0;',
  "setInterval(() => { n++; process.stdout.write('resposta ' + n + '\\n'); }, 40);",
].join('\n'));
fs.writeFileSync(path.join(TMP, 'copilot.cmd'),
  '@echo off\r\nsetlocal\r\nset _prog=node\r\n"%_prog%"  "%dp0%\\entry.js" %*\r\n');

// Um `sender` falso no formato do webContents: só coleta o que foi enviado.
function fakeSender() {
  const eventos = [];
  return {
    eventos,
    send(canal, payload) { eventos.push({ canal, payload }); },
    de(canal) { return eventos.filter((e) => e.canal === canal); },
  };
}

async function parteMain() {
  console.log('\n=== Parte 1: main (CopilotCliProvider) ===');
  const provider = require('../services/providers/copilot-cli/CopilotCliProvider');
  const { CopilotCliProcess } = require('../services/providers/copilot-cli/CopilotCliProcess');

  // O send() resolve o binário real; aqui forçamos o falso interceptando o
  // start do processo (o resto do fluxo do provider fica intacto).
  const startOriginal = CopilotCliProcess.prototype.start;
  CopilotCliProcess.prototype.start = function (opts) {
    return startOriginal.call(this, { ...opts, binary: path.join(TMP, 'copilot.cmd') });
  };

  const sender = fakeSender();
  let erroDoSend = null;
  const turno = provider.send('oi', TMP, sender, {}).catch((e) => { erroDoSend = e; });

  await sleep(1000);
  const chunksAntes = sender.de('gemini-stream-chunk').length;
  assert(chunksAntes > 0, `o falso copilot está streamando pro renderer (${chunksAntes} chunks)`);

  await provider.abortCurrent();
  const chunksNoAbort = sender.de('gemini-stream-chunk').length;
  await sleep(1800);
  await turno;

  const depois = sender.de('gemini-stream-chunk').length - chunksNoAbort;
  const erros = sender.de('transcription-error');

  console.log('\n1. abortar não pinta erro vermelho na tela');
  assert(erros.length === 0,
    `nenhum transcription-error${erros.length ? ' (veio: ' + JSON.stringify(erros[0].payload) + ')' : ''}`);
  assert(!erroDoSend, `send() não rejeitou${erroDoSend ? ': ' + erroDoSend.message : ''}`);

  console.log('\n2. nenhum texto vai pra tela depois do abort');
  assert(depois === 0, `0 chunk depois do abort (chegaram ${depois})`);

  console.log('\n3. o turno fecha como concluído, não como erro');
  const fases = sender.de('agentic-phase-update').map((e) => e.payload.phase);
  assert(fases.includes('completed'), `fase final é 'completed' (veio: ${fases.slice(-1)[0]})`);
  assert(!fases.includes('error'), 'nenhuma fase de erro emitida');

  console.log('\n4. um turno novo depois do abort volta a streamar');
  const sender2 = fakeSender();
  const turno2 = provider.send('oi de novo', TMP, sender2, {}).catch(() => {});
  await sleep(900);
  const vivos = sender2.de('gemini-stream-chunk').length;
  await provider.abortCurrent();
  await sleep(1200);
  await turno2;
  assert(vivos > 0, `o flag de abort não ficou preso (${vivos} chunks no turno novo)`);

  CopilotCliProcess.prototype.start = startOriginal;
}

// ---------- Parte 2: a guarda do renderer ----------
function parteRenderer() {
  console.log('\n=== Parte 2: renderer (guarda do onStreamChunk) ===');
  const stream = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'ipcStreaming.js'), 'utf8');
  const msgs = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'chatMessages.js'), 'utf8');

  console.log('\n5. chunk atrasado é descartado quando cancelado');
  assert(/onStreamChunk\(\([^)]*\)\s*=>\s*\{[\s\S]{0,600}?if \(window\.iaCancelled\) return;/.test(stream),
    'onStreamChunk sai cedo se window.iaCancelled');

  console.log('\n6. o flag é destravado em TODO caminho que inicia turno');
  // Um flag presp em true = chat mudo pra sempre. Estes são os caminhos que
  // mandam pergunta sem passar pelo startProcessing.
  assert(/function startProcessing\(\)[\s\S]{0,400}?window\.iaCancelled = false/.test(msgs),
    'startProcessing destrava');
  assert(/async function sentToAI\([\s\S]{0,400}?window\.iaCancelled = false/.test(msgs),
    'sentToAI destrava (caminho do OCR/screenshot)');
  assert(/async function sentImageToAI\([\s\S]{0,300}?window\.iaCancelled = false/.test(msgs),
    'sentImageToAI destrava');
  assert(/onAutoStream\([\s\S]{0,400}?window\.iaCancelled = false/.test(stream),
    'onAutoStream destrava (caminho da voz)');

  console.log('\n7. o reset de streaming NÃO mora no stopProcessing');
  // stopProcessing() roda no fim NORMAL do stream, antes de ler streamingText
  // pra salvar no histórico/TTS — zerar ali apagaria a resposta boa.
  const corpoStop = (msgs.match(/function stopProcessing\(\)\s*\{[\s\S]*?\n        \}/) || [''])[0];
  assert(corpoStop.length > 0, 'achei o corpo do stopProcessing');
  assert(!/streamingText\s*=\s*''/.test(corpoStop),
    'stopProcessing não zera streamingText (senão apagaria a resposta no fim normal)');
  assert(/function cancelIaAndFreezeStream\(\)[\s\S]{0,900}?streamingText = ''/.test(msgs),
    'o reset mora no cancelIaAndFreezeStream');
}

(async () => {
  if (process.platform !== 'win32') {
    console.log('SKIP: o copilot falso usa shim .cmd (Windows).');
    return;
  }
  try {
    await parteMain();
    parteRenderer();
  } catch (e) {
    fail(`exceção: ${e && e.message}`);
  }
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (_) {}
  console.log(falhas ? `\n${falhas} falha(s).` : '\nOK: parar não gera erro e silencia a tela.');
  process.exit(falhas ? 1 : 0);
})();
