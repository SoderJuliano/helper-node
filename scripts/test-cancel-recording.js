// scripts/test-cancel-recording.js
// Teste unitario do cancelamento de gravacao de audio (Ctrl+D) sem transcrever

const assert = require('assert');
const { state, helpers } = require('../main/globals.js');
require('../main/helpers/audio.js');

console.log('=== Testando Cancelamento e Descarte de Audio (Ctrl+D) ===\n');

// Simula estado de gravacao ativa com chunks de audio acumulados
state.dictationActive = true;
state.isRecording = true;
state.dictationChunks = [Buffer.from([1, 2, 3, 4]), Buffer.from([5, 6, 7, 8])];
state.dictationBytes = 8;
state.recordingBusy = true;

assert.equal(state.dictationActive, true);
assert.equal(state.isRecording, true);
assert.equal(state.dictationChunks.length, 2);

// Executa cancelamento
const cancelled = helpers.cancelDictation();

assert.equal(cancelled, true, 'Deve retornar true ao cancelar gravacao ativa');
assert.equal(state.dictationActive, false, 'indicador de dictationActive deve ser resetado');
assert.equal(state.isRecording, false, 'isRecording deve ser false');
assert.equal(state.recordingBusy, false, 'recordingBusy deve ser false');
assert.equal(state.dictationChunks.length, 0, 'buffers de audio devem ser limpos e descartados');
assert.equal(state.dictationBytes, 0, 'bytes devem ser 0');

console.log('  ok   Audio descartado e estado resetado sem transcrever nem gerar arquivos');

console.log('\nTodos os testes de cancelamento de gravacao passaram com sucesso! ׍');
