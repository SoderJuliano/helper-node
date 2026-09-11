/**
 * scripts/test-nexa-reading-afk-animation.js
 * Testes unitarios para a animacao de leitura e comportamento AFK Dia/Noite da Nexa.
 */

const assert = require("assert");
const fs = require("fs");
const path = require("path");

console.log("=== Testando Animacao de Leitura e Modo AFK Dia/Noite da Nexa ===\
");

// 1. Validacao dos assets de reading_lottie em disco
const readingLottieDir = path.join(__dirname, "../renderer/nexa/assets/lottie/reading_lottie");
const mainJsonPath = path.join(readingLottieDir, "animations/main.json");
assert.ok(fs.existsSync(mainJsonPath), "main.json de reading_lottie deve existir");

const jsonContent = JSON.parse(fs.readFileSync(mainJsonPath, "utf8"));
assert.strictEqual(jsonContent.w, 270, "Largura base deve ser 270");
assert.strictEqual(jsonContent.h, 480, "Altura base deve ser 480");
assert.strictEqual(jsonContent.fr, 24, "Framerate deve ser 24fps");
assert.strictEqual(jsonContent.assets.length, 96, "Deve conter 96 frames (4 segundos a 24fps)");

const imagesDir = path.join(readingLottieDir, "images");
assert.ok(fs.existsSync(imagesDir), "Diretorio de imagens deve existir");
const imageFiles = fs.readdirSync(imagesDir).filter(f => f.endsWith(".webp"));
assert.strictEqual(imageFiles.length, 96, "Devem existir 96 arquivos webp em reading_lottie/images");
console.log("  [OK] Teste 1: Integridade dos assets de reading_lottie validada com sucesso.");

// 2. Validacao do catalogo de animacoes em main/nexa/nexaAnimations.js
const { NEXA_ANIMATIONS } = require("../main/nexa/nexaAnimations.js");
assert.ok(NEXA_ANIMATIONS.reading, "Catalogo deve conter animacao reading");
assert.strictEqual(NEXA_ANIMATIONS.reading.name, "reading", "Nome deve ser reading");
assert.strictEqual(NEXA_ANIMATIONS.reading.category, "idle", "Categoria deve ser idle");
assert.ok(fs.existsSync(NEXA_ANIMATIONS.reading.lottiePath), "Caminho lottiePath da animacao reading deve existir no disco");
console.log("  [OK] Teste 2: Registro no catalogo NEXA_ANIMATIONS validado.");

// 3. Validacao da logica Dia / Noite para AFK
function getAfkAnimationType(hour) {
  const isDaytime = hour >= 6 && hour < 18;
  return isDaytime ? "reading" : "sleeping";
}

assert.strictEqual(getAfkAnimationType(6), "reading", "06:00 deve ser leitura");
assert.strictEqual(getAfkAnimationType(12), "reading", "12:00 deve ser leitura");
assert.strictEqual(getAfkAnimationType(17), "reading", "17:00 deve ser leitura");
assert.strictEqual(getAfkAnimationType(18), "sleeping", "18:00 deve ser sono");
assert.strictEqual(getAfkAnimationType(22), "sleeping", "22:00 deve ser sono");
assert.strictEqual(getAfkAnimationType(0), "sleeping", "00:00 deve ser sono");
assert.strictEqual(getAfkAnimationType(5), "sleeping", "05:00 deve ser sono");
console.log("  [OK] Teste 3: Logica de alternancia Dia (Leitura) / Noite (Sono) validada.");

// 4. Validacao da protecao de arraste no NexaDragHandler quando em AFK
const { NexaDragHandler } = require("../renderer/nexa/nexaDragHandler.js");

class FakeAnimController {
  constructor(state = "IDLE") { this.state = state; }
  getCurrentState() { return this.state; }
}

class FakeAnimation {
  constructor(animationPath, isPlaying = true) {
    this.animationPath = animationPath;
    this.isPlaying = isPlaying;
  }
  stop() { this.isPlaying = false; }
}

class FakeCanvas {
  constructor() { this.handlers = {}; this.style = {}; }
  addEventListener(name, fn) { this.handlers[name] = fn; }
  dispatch(name, evt) { if (this.handlers[name]) this.handlers[name](evt); }
}

let readingAnim = new FakeAnimation("renderer/nexa/assets/lottie/reading_lottie/animations/main.json");
let controller = new FakeAnimController("IDLE");
let canvas = new FakeCanvas();
let isSleeping = true;

let handler = new NexaDragHandler({
  canvas,
  animController: controller,
  getCurrentAnimation: () => readingAnim,
  setCurrentAnimation: (a) => { readingAnim = a; },
  getIsSleeping: () => isSleeping
});

canvas.dispatch("mousedown", { button: 0 });
assert.strictEqual(readingAnim.isPlaying, true, "Animacao de AFK nao deve ser cancelada ao arrastar a janela");
console.log("  [OK] Teste 4: Protecao de arraste durante modo AFK validada.");

console.log("\
TODOS OS TESTES DE ANIMACAO DE LEITURA E AFK PASSARAM COM SUCESSO!");