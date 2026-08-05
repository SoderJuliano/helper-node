/**
 * scripts/test-nexa-animation.js
 * Teste automatizado de integração para os controladores procedurais 2D da Nexa.
 */

const assert = require("assert");
const { CharacterLayer, NexaCharacter } = require("../renderer/nexa/nexaCharacter.js");
const { NexaBreathing } = require("../renderer/nexa/nexaBreathing.js");
const { NexaBlink } = require("../renderer/nexa/nexaBlink.js");
const { NexaLook } = require("../renderer/nexa/nexaLook.js");
const { NexaTalking, MOUTH_STATES } = require("../renderer/nexa/nexaTalking.js");
const { NexaAnimationController } = require("../renderer/nexa/nexaAnimationController.js");

console.log("🧪 Iniciando testes dos controladores de animação 2D da Nexa...");

// Teste 1: Validação do NexaCharacter e Pivô da Boca
const character = new NexaCharacter();
assert.strictEqual(character.layers.length, 22, "Devem existir 22 camadas no mapa do personagem");

const mouthLayer = character.layerMap["mouth"];
assert.ok(mouthLayer, "Camada da boca deve existir");
assert.strictEqual(mouthLayer.pivotX, 642.5, "Pivô X da boca deve ser 642.5");
assert.strictEqual(mouthLayer.pivotY, 221.0, "Pivô Y da boca deve ser 221.0");
console.log("  ✅ Teste 1 Aprovado: Carregamento de camadas e pivô da boca validado.");

// Teste 2: NexaBreathing (Respiração)
const breathing = new NexaBreathing();
const breathData = breathing.update(0.016, "IDLE");
assert.ok(typeof breathData.offsetY === "number", "offsetY deve ser número");
assert.ok(typeof breathData.scaleY === "number", "scaleY deve ser número");
assert.ok(typeof breathData.rotation === "number", "rotation deve ser número");
console.log("  ✅ Teste 2 Aprovado: NexaBreathing gera valores numéricos válidos.");

// Teste 3: NexaBlink (Piscar de Olhos)
const blink = new NexaBlink();
const blinkData = blink.update(0.016, "IDLE");
assert.ok(blinkData.eyeScaleY >= 0.0 && blinkData.eyeScaleY <= 1.0, "Escala do olho deve estar entre 0 e 1");
console.log("  ✅ Teste 3 Aprovado: NexaBlink gerado corretamente.");

// Teste 4: NexaLook (Olhar e Inclinação)
const look = new NexaLook();
const lookData = look.update(0.016, "THINKING");
assert.ok(typeof lookData.headRotation === "number", "headRotation deve ser número");
assert.ok(typeof lookData.eyeX === "number", "eyeX deve ser número");
console.log("  ✅ Teste 4 Aprovado: NexaLook calcula inclinação e olhares.");

// Teste 5: NexaTalking (Boca, Espectro de Áudio & Portão de Ruído)
const talking = new NexaTalking();
const talkDataIdle = talking.update(0.016, false);
assert.strictEqual(talkDataIdle.mouthScaleY, 1.0, "Boca em IDLE deve iniciar com escalaY 1.0");

talking.targetAmplitude = 0.8; // Simula pico de fala com energia vocal
talking.vowelDrive = 0.7;
for (let i = 0; i < 10; i++) talking.update(0.016, true);
const talkDataSpeaking = talking.update(0.016, true);
assert.ok(talkDataSpeaking.mouthScaleY > 1.2, "Boca deve expandir durante a fala");

talking.targetAmplitude = 0; // Simula pausa/silêncio (noise gate)
talking.vowelDrive = 0;
talking.sibilantDrive = 0;
for (let i = 0; i < 10; i++) talking.update(0.016, true);
const talkDataPause = talking.update(0.016, true);
assert.ok(talkDataPause.mouthScaleY < talkDataSpeaking.mouthScaleY, "Boca deve fechar/reduzir abertura durante pausas de silêncio");

console.log("  ✅ Teste 5 Aprovado: NexaTalking reage dinamicamente ao áudio e pausas.");

// Teste 6: NexaAnimationController (Orquestrador)
const controller = new NexaAnimationController(character);
controller.setState("LISTENING");
assert.strictEqual(controller.getCurrentState(), "LISTENING", "Estado deve atualizar no controlador");
controller.update(0.016);
assert.ok(character.nodes.body.scaleY > 0, "Transformações do corpo devem ter sido aplicadas ao personagem");
console.log("  ✅ Teste 6 Aprovado: NexaAnimationController orquestra nós do personagem.");

console.log("🎉 TODOS OS TESTES DOS CONTROLADORES DA NEXA FORAM APROVADOS COM SUCESSO!");
