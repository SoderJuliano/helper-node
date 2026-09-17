// scripts/test-realtime-deduplication.js
// Teste de prevenção de duplicação de respostas e bolhas no Assistente em Tempo Real

const assert = require('assert');
const { cleanTranscription, mergeContinuationText, isAcousticEcho } = require('../services/audioTranscriptionCleaner');

console.log('=== Testes de Deduplicação e Integridade do Assistente em Tempo Real ===\n');

// 1. Cenário do Bug reportado pelo usuário: "Como funciona a injeção de depend" vs "Como funciona a injeção de dependência do Spring?"
const turn1 = 'Como funciona a injeção de depend';
const turn2 = 'Como funciona a injeção de dependência do Spring?';

// Mesclagem deve reconhecer que turn2 contém a frase completa e expandida, sem duplicar o início
const merged = mergeContinuationText(turn1, turn2);
assert.strictEqual(merged, 'Como funciona a injeção de dependência do Spring?', 'Deve resolver para a frase completa');
console.log('  ok   1. Mesclagem de frase expandida do interlocutor resolve para frase completa');

// 2. Repetição idêntica de texto em janela curta (ex: STT re-emite o mesmo texto)
const identicalMerge = mergeContinuationText('Como funciona a injeção de dependência do Spring?', 'Como funciona a injeção de dependência do Spring?');
assert.strictEqual(identicalMerge, 'Como funciona a injeção de dependência do Spring?', 'Deve manter texto idêntico sem concatenar');
console.log('  ok   2. Supressão de texto idêntico duplicado');

// 3. Teste de detecção de eco acústico (vazamento entre mic e sys)
const mockSysClosed = { text: 'Como funciona a injeção de dependência do Spring?', closedAt: Date.now() - 500 };
assert.strictEqual(isAcousticEcho('Como funciona a injeção de dependência do Spring?', mockSysClosed), true, 'Deve identificar eco acústico idêntico');
assert.strictEqual(isAcousticEcho('como funciona a injeção de dependência do spring', mockSysClosed), true, 'Deve identificar eco acústico com variação de maiúsculas/pontuação');
assert.strictEqual(isAcousticEcho('Injeção de dependência no Spring', mockSysClosed), true, 'Deve identificar eco acústico com alto overlap de termos');
assert.strictEqual(isAcousticEcho('Outra pergunta totalmente diferente', mockSysClosed), false, 'Não deve marcar pergunta diferente como eco');

const oldMock = { text: 'Como funciona a injeção de dependência do Spring?', closedAt: Date.now() - 10000 };
assert.strictEqual(isAcousticEcho('Como funciona a injeção de dependência do Spring?', oldMock), false, 'Eco com mais de 5s não deve ser descartado');
console.log('  ok   3. Cancelamento de eco acústico entre mic e sys');

// 4. Verificação de instanciação e inicialização do RealtimeOpenAiService
const RealtimeOpenAiService = require('../services/realtimeOpenAiService');
const mockConfigService = {
  getOpenIaToken: () => 'sk-mock-test-key-1234567890',
  getOpenAiModel: () => 'gpt-4o-mini',
  getConfig: () => ({ realtimeAudioMode: 'both' }),
  getLanguage: () => 'pt-br',
  getUserContextBlock: () => '',
};
const updatesEmitted = [];
const mockWindow = {
  isDestroyed: () => false,
  webContents: {
    send: (channel, payload) => updatesEmitted.push(payload),
  },
};

const svc = new RealtimeOpenAiService({
  configService: mockConfigService,
  getMainWindow: () => mockWindow,
});

assert.strictEqual(svc.iterationCount, 0);
assert.strictEqual(svc.active, false);
assert.strictEqual(typeof svc._onStreamTurn, 'function');
assert.strictEqual(typeof svc._onStreamDelta, 'function');
console.log('  ok   4. RealtimeOpenAiService instanciado com pipeline limpo');

console.log('\nTodos os testes de deduplicação e integridade passaram com sucesso!\n');
