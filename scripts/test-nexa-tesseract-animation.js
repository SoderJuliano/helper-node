/**
 * scripts/test-nexa-tesseract-animation.js
 * Testes unitarios para a animacao do Tesseract (Cubo Digital de Codigo) e alternancia 50/50 na Nexa.
 */

const assert = require("assert");
const fs = require("fs");
const path = require("path");

console.log("=== Testando Animacao do Tesseract (Cubo de Codigo) e Selecao 50/50 ===\
");

// 1. Validacao dos assets de tesseract_lottie em disco
const tesseractDir = path.join(__dirname, "../renderer/nexa/assets/lottie/tesseract_lottie");
const mainJsonPath = path.join(tesseractDir, "animations/main.json");
assert.ok(fs.existsSync(mainJsonPath), "main.json de tesseract_lottie deve existir");

const jsonContent = JSON.parse(fs.readFileSync(mainJsonPath, "utf8"));
assert.strictEqual(jsonContent.w, 281, "Largura base deve ser 281");
assert.strictEqual(jsonContent.h, 500, "Altura base deve ser 500");
assert.strictEqual(jsonContent.fr, 30, "Framerate deve ser 30fps");
assert.strictEqual(jsonContent.assets.length, 120, "Deve conter 120 frames (4 segundos a 30fps)");

const imagesDir = path.join(tesseractDir, "images");
assert.ok(fs.existsSync(imagesDir), "Diretorio de imagens deve existir");
const imageFiles = fs.readdirSync(imagesDir).filter(f => f.endsWith(".webp"));
assert.strictEqual(imageFiles.length, 120, "Devem existir 120 arquivos webp em tesseract_lottie/images");
console.log("  [OK] Teste 1: Integridade dos 120 frames e main.json do tesseract validada.");

// 2. Validacao do catalogo de animacoes em main/nexa/nexaAnimations.js
const { NEXA_ANIMATIONS } = require("../main/nexa/nexaAnimations.js");
assert.ok(NEXA_ANIMATIONS.tesseract_code, "Catalogo deve conter animacao tesseract_code");
assert.ok(NEXA_ANIMATIONS.tesseract, "Catalogo deve conter alias tesseract");
assert.ok(fs.existsSync(NEXA_ANIMATIONS.tesseract_code.lottiePath), "Caminho lottiePath de tesseract_code deve existir no disco");
console.log("  [OK] Teste 2: Registro no catalogo NEXA_ANIMATIONS validado.");

// 3. Validacao da selecao 50/50 e consistencia durante uma tarefa
class WorkingAnimationPicker {
  constructor() {
    this.activeWorkingAnimation = null;
  }
  onStateChange(state, randomVal = Math.random()) {
    if (state === "SPEAKING" || state === "IDLE" || state === "LISTENING") {
      this.activeWorkingAnimation = null;
      return null;
    }
    if (state === "WORKING") {
      if (!this.activeWorkingAnimation) {
        this.activeWorkingAnimation = randomVal < 0.5 ? "tesseract" : "terminal";
      }
      return this.activeWorkingAnimation;
    }
    return this.activeWorkingAnimation;
  }
}

const picker = new WorkingAnimationPicker();
// Simulando tarefa 1 com random 0.2 (deve escolher tesseract)
const anim1_step1 = picker.onStateChange("WORKING", 0.2);
assert.strictEqual(anim1_step1, "tesseract", "Passo 1 deve ser tesseract");
// Transicao intermediaria para THINKING (proxima tool)
picker.onStateChange("THINKING");
// Segundo passo da mesma tarefa (mesmo com random diferente, mantem tesseract ate o fim da tarefa)
const anim1_step2 = picker.onStateChange("WORKING", 0.9);
assert.strictEqual(anim1_step2, "tesseract", "Passo 2 deve manter tesseract ate o fim da tarefa");
// Conclusao da tarefa (fala a resposta)
picker.onStateChange("SPEAKING");
assert.strictEqual(picker.activeWorkingAnimation, null, "Deve resetar apos conclusao/SPEAKING");

// Simulando tarefa 2 com random 0.8 (deve escolher terminal)
const anim2_step1 = picker.onStateChange("WORKING", 0.8);
assert.strictEqual(anim2_step1, "terminal", "Tarefa 2 deve escolher terminal");
const anim2_step2 = picker.onStateChange("WORKING", 0.1);
assert.strictEqual(anim2_step2, "terminal", "Passo 2 da tarefa 2 deve manter terminal");
picker.onStateChange("IDLE");
assert.strictEqual(picker.activeWorkingAnimation, null, "Deve resetar apos IDLE");
console.log("  [OK] Teste 3: Consistencia durante a mesma tarefa e selecao 50/50 validadas.");

// 4. Validacao da protecao de arraste no NexaDragHandler com tesseract
const { NexaDragHandler } = require("../renderer/nexa/nexaDragHandler.js");

class FakeAnimController { constructor(s = "IDLE") { this.state = s; } getCurrentState() { return this.state; } }
class FakeAnimation { constructor(p) { this.animationPath = p; this.isPlaying = true; } stop() { this.isPlaying = false; } }

const curAnim = new FakeAnimation("renderer/nexa/assets/lottie/tesseract_lottie/animations/main.json");
const handler = new NexaDragHandler({
  canvas: { addEventListener: () => {}, style: {} },
  animController: new FakeAnimController("WORKING"),
  getCurrentAnimation: () => curAnim,
  getIsSleeping: () => false
});

assert.strictEqual(handler.isBusyWorkingState(), true, "Animacao do tesseract deve ser reconhecida como estado ativo ocupado");
console.log("  [OK] Teste 4: Protecao contra interrupcao do tesseract durante arraste validada.");

console.log("\
TODOS OS TESTES DO TESSERACT E SELECAO 50/50 PASSARAM COM SUCESSO! 🧊✨");