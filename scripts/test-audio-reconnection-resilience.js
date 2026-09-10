const assert = require('assert');
const NexaTurnDetector = require('../services/nexaVoiceAssistant/nexaTurnDetector');
const nativeAudio = require('../services/platform/nativeAudio');

console.log('🧪 Iniciando testes de resiliência e reconexão de áudio...\n');

// 1. Teste de NexaTurnDetector reagindo a evento de device-lost
{
  const detector = new NexaTurnDetector({ minSpeechMs: 100 });
  detector.active = true;
  detector.isSpeaking = true;
  detector.speechChunks = [Buffer.alloc(3200)];
  detector.speechBytes = 3200;

  assert.strictEqual(detector.isSpeaking, true);
  assert.strictEqual(detector.speechChunks.length, 1);

  nativeAudio.events.emit('device-lost', { source: 'mic', deviceId: '' });

  assert.strictEqual(detector.isSpeaking, false, 'Turno deve ser resetado quando dispositivo for desconectado');
  assert.strictEqual(detector.speechChunks.length, 0, 'Buffer de fala deve ser zerado');
  assert.strictEqual(detector.speechBytes, 0, 'Bytes devem ser 0');
  console.log('✅ Caso 1: NexaTurnDetector limpa o turno e se recupera ao receber device-lost');
}

// 2. Teste de alternância de microfone e reinício do NexaTurnDetector
{
  const detector = new NexaTurnDetector();
  detector.active = true;
  detector.resetTurn();

  assert.strictEqual(detector.active, true);
  assert.strictEqual(detector.isSpeaking, false);

  const voiceChunk = Buffer.alloc(3200);
  for (let i = 0; i < 1600; i++) {
    voiceChunk.writeInt16LE(Math.round(Math.sin(i / 5) * 4000), i * 2);
  }

  let speechDetected = false;
  detector.on('speech-start', () => {
    speechDetected = true;
  });

  detector._handlePcmChunk(voiceChunk);
  assert.strictEqual(speechDetected, true, 'Deve voltar a capturar fala imediatamente pós-reconexão');
  console.log('✅ Caso 2: NexaTurnDetector detecta áudio novo sem travar pós-reconexão');
}

// 3. Teste de exportação dos métodos resilientes em nativeAudio
{
  assert.strictEqual(typeof nativeAudio.restart, 'function', 'nativeAudio deve exportar restart()');
  assert.strictEqual(typeof nativeAudio.listInputDevices, 'function', 'nativeAudio deve exportar listInputDevices()');
  assert.strictEqual(typeof nativeAudio.events, 'object', 'nativeAudio deve exportar events EventEmitter');
  console.log('✅ Caso 3: Métodos resilientes presentes no nativeAudio');
}

console.log('\n🎉 Todos os testes de resiliência e reconexão de áudio passaram com sucesso!');
