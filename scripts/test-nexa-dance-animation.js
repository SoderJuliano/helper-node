/**
 * scripts/test-nexa-dance-animation.js
 * Testes automatizados para a animação de dança (dance_lottie) da Nexa.
 */

const assert = require("assert");
const fs = require("fs");
const path = require("path");

console.log("=== Testando Animação de Dança da Nexa (dance_lottie) ===\n");

// 1. Validação dos assets de dance_lottie em disco
const danceDir = path.join(__dirname, "../renderer/nexa/assets/lottie/dance_lottie");
const mainJsonPath = path.join(danceDir, "animations/main.json");
assert.ok(fs.existsSync(mainJsonPath), "main.json de dance_lottie deve existir");

const jsonContent = JSON.parse(fs.readFileSync(mainJsonPath, "utf8"));
assert.strictEqual(jsonContent.w, 720, "Largura base deve ser 720");
assert.strictEqual(jsonContent.h, 405, "Altura base deve ser 405");
assert.strictEqual(jsonContent.fr, 24, "Framerate deve ser 24fps");
assert.strictEqual(jsonContent.op, 192, "Duração deve ser 192 frames (8 segundos a 24fps)");
assert.strictEqual(jsonContent.assets.length, 192, "Deve conter 192 frames nos assets");

const imagesDir = path.join(danceDir, "images");
assert.ok(fs.existsSync(imagesDir), "Diretório images de dance_lottie deve existir");
const imageFiles = fs.readdirSync(imagesDir).filter(f => f.endsWith(".webp"));
assert.strictEqual(imageFiles.length, 192, "Devem existir 192 arquivos webp em dance_lottie/images");
console.log("  [OK] Teste 1: Integridade dos 192 frames e main.json do dance_lottie validada.");

// 2. Validação do catálogo de animações em main/nexa/nexaAnimations.js
const { NEXA_ANIMATIONS } = require("../main/nexa/nexaAnimations.js");
assert.ok(NEXA_ANIMATIONS.dance, "Catálogo deve conter animação dance");
assert.ok(NEXA_ANIMATIONS.dancing, "Catálogo deve conter alias dancing");
assert.strictEqual(NEXA_ANIMATIONS.dance.name, "dance", "Nome da animação deve ser dance");
assert.strictEqual(NEXA_ANIMATIONS.dance.category, "action", "Categoria deve ser action");
assert.ok(fs.existsSync(NEXA_ANIMATIONS.dance.lottiePath), "Caminho lottiePath de dance deve existir no disco");
assert.ok(fs.existsSync(NEXA_ANIMATIONS.dancing.lottiePath), "Caminho lottiePath do alias dancing deve existir no disco");
console.log("  [OK] Teste 2: Registro no catálogo NEXA_ANIMATIONS e alias validados.");

// 3. Validação da proteção contra interrupção no NexaDragHandler
const { NexaDragHandler } = require("../renderer/nexa/nexaDragHandler.js");

class FakeAnimController { constructor(s = "IDLE") { this.state = s; } getCurrentState() { return this.state; } }
class FakeAnimation { constructor(p) { this.animationPath = p; this.isPlaying = true; } stop() { this.isPlaying = false; } }

const danceAnim = new FakeAnimation("renderer/nexa/assets/lottie/dance_lottie/animations/main.json");
const handler = new NexaDragHandler({
  canvas: { addEventListener: () => {}, style: {} },
  animController: new FakeAnimController("IDLE"),
  getCurrentAnimation: () => danceAnim,
  getIsSleeping: () => false
});

assert.strictEqual(handler.isBusyWorkingState(), true, "Animação de dança deve ser reconhecida como estado ativo ocupado");
console.log("  [OK] Teste 3: Proteção contra interrupção de dança durante arraste validada.");

// 4. Validação da matemática de escala e enquadramento visual da dança
const { NexaLottieAnimation } = require("../renderer/nexa/nexaLottieAnimation.js");
const lottieDance = new NexaLottieAnimation({ animationPath: "renderer/nexa/assets/lottie/dance_lottie/animations/main.json" });
lottieDance.anim = { isPlaying: true };
lottieDance.canvas = { width: 720, height: 405 };
lottieDance.isPlaying = true;
lottieDance.finished = false;

let drawnArgs = null;
const fakeCtx = {
  clearRect: () => {},
  save: () => {},
  restore: () => {},
  drawImage: (...args) => { drawnArgs = args; }
};

lottieDance.render(fakeCtx, 360, 360);
assert.ok(drawnArgs, "drawImage deve ter sido chamado");
const [img, x, y, drawW, drawH] = drawnArgs;

// Altura do personagem na dança = 383px * (drawH / 405)
const danceCharHeightOnScreen = 383 * (drawH / 405);
// Altura de referência (wave/idle) = 458px * (360 / 482) = ~342.07px
const refStandingHeight = (458 / 482) * 360;

assert.ok(Math.abs(danceCharHeightOnScreen - refStandingHeight) < 1.0, `Altura da dança (${danceCharHeightOnScreen}px) deve ser proporcional à altura em pé (${refStandingHeight}px)`);
console.log(`  [OK] Teste 4: Proporção visual e escala da dança validadas (Altura renderizada: ${danceCharHeightOnScreen.toFixed(1)}px vs Referência: ${refStandingHeight.toFixed(1)}px).`);

console.log("\n🎉 TODOS OS TESTES DA ANIMAÇÃO DE DANÇA PASSARAM COM SUCESSO! 💃✨");
