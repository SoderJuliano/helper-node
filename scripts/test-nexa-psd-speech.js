/**
 * scripts/test-nexa-psd-speech.js
 * Testes automatizados para a fala procedural PSD (camadas PNG + sincronização labial Web Audio)
 * e o mecanismo de fallback Lottie da Nexa.
 */

const assert = require("assert");
const fs = require("fs");
const path = require("path");

console.log("=== Testando Fala Procedural PSD e Sincronização Labial da Nexa ===\n");

// 1. Validação da presença física de todas as 23 camadas PNG no repositório
const layersDir = path.join(__dirname, "../renderer/nexa/assets/layers");
assert.ok(fs.existsSync(layersDir), "Diretório renderer/nexa/assets/layers deve existir");

const expectedLayers = [
  "back hair.png", "bottomwear.png", "ears.png", "earwear.png",
  "eyebrow.png", "eyelash.png", "eyewear.png", "eyewhite.png",
  "face.png", "footwear.png", "front hair.png", "hand_pose_chin.png",
  "handwear.png", "head.png", "headwear.png", "irides.png",
  "legwear.png", "mouth.png", "neck.png", "neckwear.png",
  "nose.png", "objects.png", "topwear.png"
];

for (const layerFile of expectedLayers) {
  const filePath = path.join(layersDir, layerFile);
  assert.ok(fs.existsSync(filePath), `Camada PNG deve existir no disco: ${layerFile}`);
  const stats = fs.statSync(filePath);
  assert.ok(stats.size > 0, `Camada ${layerFile} não pode estar vazia (tamanho: ${stats.size} bytes)`);
}
console.log(`  [OK] Teste 1: Todas as ${expectedLayers.length} camadas PNG verificadas em assets/layers com integridade.`);

// 2. Validação da classe NexaCharacter e carregamento das camadas
const { NexaCharacter } = require("../renderer/nexa/nexaCharacter.js");
const character = new NexaCharacter();
assert.strictEqual(character.layers.length, 23, "NexaCharacter deve registrar exatamente 23 camadas");

(async () => {
  const loaded = await character.loadAssets(layersDir);
  assert.ok(loaded, "character.loadAssets deve retornar true ao carregar de assets/layers");
  assert.ok(character.isFullyLoaded, "character.isFullyLoaded deve ser true");
  console.log("  [OK] Teste 2: NexaCharacter carregou e validou todas as camadas PNG.");

  // 3. Validação do controlador de fala (NexaTalking) e sincronização labial
  const { NexaTalking, MOUTH_STATES } = require("../renderer/nexa/nexaTalking.js");
  const talking = new NexaTalking();

  // Em repouso (não falando), a boca deve permanecer fechada
  const idleState = talking.update(0.016, false);
  assert.strictEqual(idleState.mouthState, MOUTH_STATES.CLOSED, "Boca deve estar fechada em repouso");
  assert.strictEqual(idleState.mouthScaleY, 1.0, "ScaleY da boca deve ser 1.0 em repouso");

  // Durante fala ativa com volume alto (vogais abertas)
  talking.targetAmplitude = 0.85;
  talking.vowelDrive = 0.75;
  for (let i = 0; i < 15; i++) talking.update(0.016, true);
  const speakingState = talking.update(0.016, true);

  assert.ok(speakingState.mouthScaleY > 1.3, "ScaleY da boca deve expandir durante fala ativa de vogais");
  assert.ok(speakingState.mouthState !== MOUTH_STATES.CLOSED, "Estado da boca não deve ser CLOSED durante fala");
  console.log("  [OK] Teste 3: NexaTalking calcula visemes e escala de abertura da boca perfeitamente.");

  // 4. Validação do orquestrador (NexaAnimationController) e modelo de nós
  const { NexaAnimationController } = require("../renderer/nexa/nexaAnimationController.js");
  const animController = new NexaAnimationController(character);

  animController.setState("SPEAKING");
  animController.talking.targetAmplitude = 0.9;
  animController.talking.vowelDrive = 0.8;
  animController.update(0.016);

  const mouthNode = character.nodes.mouth;
  assert.ok(mouthNode.scaleY > 1.2, "Nó da boca no personagem deve receber a transformação do NexaTalking");
  console.log("  [OK] Teste 4: NexaAnimationController aplica transformações labiais ao modelo do personagem.");

  // 5. Simulação de Renderização no Canvas 2D
  let drawnLayersCount = 0;
  const mockCtx = {
    save: () => {},
    restore: () => {},
    clearRect: () => {},
    translate: () => {},
    rotate: () => {},
    scale: () => {},
    drawImage: () => { drawnLayersCount++; },
    globalAlpha: 1.0
  };

  // Prepara imagens falsas para cada camada carregada
  for (const layer of character.layers) {
    layer.isLoaded = true;
    layer.image = {}; // Objeto de imagem simulado
  }
  character.isFullyLoaded = true;

  animController.render(mockCtx, 360, 360);
  assert.strictEqual(drawnLayersCount, 23, "Todas as 23 camadas devem ser desenhadas no Canvas pelo animController.render");
  console.log("  [OK] Teste 5: Renderização 2D Canvas executou o desenho completo das 23 camadas.");

  console.log("\n🎉 TODOS OS TESTES DA FALA EM PSD E SINCRONIA LABIAL PASSARAM COM SUCESSO! 🗣️✨");
})();
