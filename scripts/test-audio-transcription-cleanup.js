// scripts/test-audio-transcription-cleanup.js
// Testes de limpeza de alucinacoes de silencio do Whisper (ex: musica de fundo) e verificacao de RMS.

const assert = require('assert');
const { helpers } = require('../main/globals.js');
require('../main/helpers/audio.js');

console.log('=== Testando Filtragem de Alucinacoes e RMS de Audio ===\n');

(async () => {
  // 1. Testes de alucinacoes de silencio
  const hallucinations = [
    'música de fundo',
    '[Múoica de fundo]',
    '(Múoica de fundo)',
    '[Múoica]',
    '(Múoica)',
    '[musica]',
    'música de fundo.',
    '[Silêncio]',
    '[Aplausos]',
    'Legendas pela comunidade Amara.org',
    'Obrigado por assistir',
    'Inscreva-se no canal',
    '[BLANK_AUDIO]',
    '[00:00:00.000 --> 00:00:02.000] [Música]',
  ];

  for (const h of hallucinations) {
    const clean = await helpers.limparTranscricao(h);
    assert.equal(clean, '', `Deve retornar vazio pra alucinacao: \"${h}\"`);
  }
  console.log('  ok   Alucinacoes de silencio (musica de fundo, [Musica], etc) filtradas com sucesso');

  // 2. Testes de frases legitimas com a palavra musica
  const legitInputs = [
    'crie uma classe para processar musica',
    'Qual a melhor forma de escutar musica no Java',
    '[00:00:00.000 --> 00:00:03.000] Crie uma controller de usuarios',
  ];

  for (const l of legitInputs) {
    const clean = await helpers.limparTranscricao(l);
    assert.ok(clean.length > 0, `Deve preservar fevo valido: \"${l}\"`);
  }
  console.log('  ok   Frases reais e perguntas validas preservadas com precisao');

  // 3. Testes de RMS
  const silenceBuf = Buffer.alloc(16000); // 0 amplitude
  const rmsSilence = helpers._computeRMS(silenceBuf);
  assert.equal(rmsSilence, 0, 'RMS de silencio deve ser 0');

  const audioBuf = Buffer.alloc(16000);
  for (let i = 0; i < audioBuf.length; i += 2) {
    audioBuf.writeInt16LE(2000, i);
  }
  const rmsAudio = helpers._computeRMS(audioBuf);
  assert.ok(rmsAudio > 100, 'RMS de audio real deve ser > 100');
  console.log('  ok   Calculo de RMS detecta silencio e microfone ativo corretamente');

  console.log('\nTodos os testes de limpeza de audio passaram com sucesso!\n');
})();
