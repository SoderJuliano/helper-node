/**
 * scripts/test-nexa-voice-vad.js
 * Teste unitário para a lógica de VAD e detecção de turnos por silêncio.
 */

const assert = require("assert");
const NexaTurnDetector = require("../services/nexaVoiceAssistant/nexaTurnDetector");

console.log("🧪 Iniciando testes de Nexa Turn Detector e VAD...\n");

// 1. Cálculo de RMS para buffers de silêncio e voz simulada
{
  const silenceBuf = Buffer.alloc(3200); // 100ms de zeros (silêncio)
  const silenceRms = NexaTurnDetector.computeRms(silenceBuf);
  assert.strictEqual(silenceRms, 0, "Buffer de zeros deve ter RMS = 0");
  console.log("✅ Caso 1: RMS de silêncio absoluto = 0");
}

{
  const voiceBuf = Buffer.alloc(3200);
  for (let i = 0; i < 1600; i++) {
    // Onda senoidal simulando voz
    const sample = Math.round(Math.sin(i / 10) * 8000);
    voiceBuf.writeInt16LE(sample, i * 2);
  }
  const voiceRms = NexaTurnDetector.computeRms(voiceBuf);
  assert.ok(voiceRms > 1000, "Voz simulada deve ter RMS alto (>1000)");
  console.log(`✅ Caso 2: RMS de voz simulada = ${Math.round(voiceRms)} (>= limiar de 180)`);
}

// 2. Simulação de ciclo completo de fala + silêncio
{
  const detector = new NexaTurnDetector({
    speechThresholdRms: 180,
    silenceThresholdMs: 200, // 200ms para teste rápido
    minSpeechMs: 100
  });
  detector.active = true;

  let speechStarted = false;
  let turnCompleted = false;

  detector.on("speech-start", () => {
    speechStarted = true;
  });

  detector.on("turn-complete", (data) => {
    turnCompleted = true;
    assert.ok(data.durationMs >= 100);
    assert.ok(data.pcmBuffer.length > 0);
  });

  // 100ms de áudio ativo
  const activeChunk = Buffer.alloc(3200);
  for (let i = 0; i < 1600; i++) {
    activeChunk.writeInt16LE(Math.round(Math.sin(i / 5) * 5000), i * 2);
  }
  detector._handlePcmChunk(activeChunk);
  assert.strictEqual(speechStarted, true, "Deve detectar início de fala");

  // 250ms de silêncio para disparar o fechamento do turno
  const silenceChunk = Buffer.alloc(3200);
  detector._handlePcmChunk(silenceChunk);
  detector._handlePcmChunk(silenceChunk);
  detector._handlePcmChunk(silenceChunk);

  assert.strictEqual(turnCompleted, true, "Deve fechar o turno automaticamente após o silêncio");
  console.log("✅ Caso 3: Simulação de ciclo de fala e fechamento por silêncio (turn-complete)");
}

// 3. Verificação do limiar padrão de 800ms
{
  const defaultDetector = new NexaTurnDetector();
  assert.strictEqual(defaultDetector.silenceThresholdMs, 800, "Limiar padrão de silêncio deve ser 800ms");
  console.log("✅ Caso 4: Limiar padrão de silêncio configurado para 800ms");
}

// 4. Teste de detecção de decaimento de voz (Voice Decay)
{
  const decayDetector = new NexaTurnDetector({
    speechThresholdRms: 100,
    silenceThresholdMs: 400,
    minSpeechMs: 100
  });
  decayDetector.active = true;

  let decayDetected = false;
  decayDetector.on("voice-decay", (info) => {
    decayDetected = true;
    assert.ok(info.peakTurnRms > 0);
  });

  // Gera 350ms de fala forte (7 chunks de 50ms)
  const strongChunk = Buffer.alloc(1600); // 50ms
  for (let i = 0; i < 800; i++) {
    strongChunk.writeInt16LE(Math.round(Math.sin(i / 4) * 6000), i * 2);
  }
  for (let i = 0; i < 7; i++) {
    decayDetector._handlePcmChunk(strongChunk);
  }

  // Gera áudio fraco / decaimento (RMS baixo)
  const weakChunk = Buffer.alloc(1600);
  for (let i = 0; i < 800; i++) {
    weakChunk.writeInt16LE(Math.round(Math.sin(i / 4) * 40), i * 2);
  }
  decayDetector._handlePcmChunk(weakChunk);
  decayDetector._handlePcmChunk(weakChunk);

  assert.strictEqual(decayDetected, true, "Deve detectar decaimento de voz ao final da fala");
  console.log("✅ Caso 5: Detecção de decaimento de voz (Voice Decay) disparada com sucesso");
}

console.log("\n🎉 Todos os testes de VAD passaram com sucesso!");
