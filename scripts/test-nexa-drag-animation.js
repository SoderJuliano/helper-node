// scripts/test-nexa-drag-animation.js
// Testes unitarios para o NexaDragHandler: 90% se equilibrando / 10% flutuando, pouso condicional e protecao de estados ativos.

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { NexaDragHandler } = require('../renderer/nexa/nexaDragHandler.js');

console.log('=== Testando Gerenciador de Arraste da Nexa e Animacoes (Equilibrio 90% / Flutuacao 10%) ===\n');

// 0. Verificacao de integridade dos arquivos em disco
const balancingJsonPath = path.join(__dirname, '../renderer/nexa/assets/lottie/balancing_lottie/animations/main.json');
assert(fs.existsSync(balancingJsonPath), 'Arquivo main.json da animacao de equilibrio deve existir');
const jsonContent = JSON.parse(fs.readFileSync(balancingJsonPath, 'utf8'));
assert.strictEqual(jsonContent.w, 270, 'Largura base deve ser 270');
assert.strictEqual(jsonContent.h, 480, 'Altura base deve ser 480');
assert.strictEqual(jsonContent.assets.length, 96, 'Deve conter 96 frames de animacao');
console.log('  ok   Integridade dos assets de balancing_lottie validada com sucesso');

class FakeAnimController {
  constructor(state = 'IDLE') {
    this.state = state;
  }
  getCurrentState() {
    return this.state;
  }
  setState(s) {
    this.state = s;
  }
}

class FakeAnimation {
  constructor(animationPath, isPlaying = true) {
    this.animationPath = animationPath;
    this.isPlaying = isPlaying;
    this.stopped = false;
  }
  stop() {
    this.isPlaying = false;
    this.stopped = true;
  }
  play() {
    this.isPlaying = true;
  }
}

// Mock global NexaLottieAnimation para os testes
global.NexaLottieAnimation = class {
  constructor(opts) {
    this.animationPath = opts.animationPath;
    this.loop = opts.loop;
    this.isPlaying = false;
    this.canvas = {};
  }
  play() {
    this.isPlaying = true;
  }
  stop() {
    this.isPlaying = false;
  }
};

class FakeCanvas {
  constructor() {
    this.handlers = {};
    this.style = {};
  }
  addEventListener(eventName, fn) {
    this.handlers[eventName] = fn;
  }
  dispatch(name, evt) {
    if (this.handlers[name]) this.handlers[name](evt);
  }
}

// 1. Teste em estado THINKING
let curAnim = new FakeAnimation('renderer/nexa/assets/lottie/thinking_lottie/animations/main.json');
let controller = new FakeAnimController('THINKING');
let canvas = new FakeCanvas();

let handler = new NexaDragHandler({
  canvas,
  animController: controller,
  getCurrentAnimation: () => curAnim,
  setCurrentAnimation: (a) => { curAnim = a; },
  getIsSleeping: () => false
});

assert(handler.isBusyWorkingState(), 'THINKING deve ser reconhecido como estado ativo');
canvas.dispatch('mousedown', { button: 0 });
assert.equal(curAnim.isPlaying, true, 'Animacao de pensamento NAO pode ser parada ao arrastar');
assert(curAnim.animationPath.includes('thinking'), 'Deve manter animacao thinking');
console.log('  ok   Estado THINKING preservado com sucesso durante arraste');

// 2. Teste em estado WORKING (escrevendo codigo / typing)
curAnim = new FakeAnimation('renderer/nexa/assets/lottie/typing_lottie/animations/main.json');
controller.setState('WORKING');
assert(handler.isBusyWorkingState(), 'WORKING deve ser reconhecido como estado ativo');
canvas.dispatch('mousedown', { button: 0 });
assert.equal(curAnim.isPlaying, true, 'Animacao de digitacao/escrita NAO pode ser parada ao arrastar');
assert(curAnim.animationPath.includes('typing'), 'Deve manter animacao typing/writing');
console.log('  ok   Estado WORKING (escrita de codigo) preservado com sucesso durante arraste');

// 3. Teste de probabilidade do getDragAnimation (90% balancing / 10% floating)
let hNew = new NexaDragHandler({
  canvas: new FakeCanvas(),
  animController: new FakeAnimController('IDLE'),
  randomProvider: () => 0.50 // < 0.90 -> balancing
});
let choiceNew = hNew.getDragAnimation();
assert.strictEqual(choiceNew.type, 'balancing', 'Random 0.50 deve escolher balancing');
assert(choiceNew.path.includes('balancing_lottie'), 'Path deve ser balancing_lottie');

let hOld = new NexaDragHandler({
  canvas: new FakeCanvas(),
  animController: new FakeAnimController('IDLE'),
  randomProvider: () => 0.95 // >= 0.90 -> floating
});
let choiceOld = hOld.getDragAnimation();
assert.strictEqual(choiceOld.type, 'floating', 'Random 0.95 deve escolher floating');
assert(choiceOld.path.includes('floating_lottie'), 'Path deve ser floating_lottie');
console.log('  ok   Probabilidade de 90% (equilibrio) e 10% (flutuacao) validada');

// 4. Teste de arraste com animacao nova de equilibrio (mouseup sem landing)
let dragCanvas = new FakeCanvas();
let activeAnim = null;
let hDragBalancing = new NexaDragHandler({
  canvas: dragCanvas,
  animController: new FakeAnimController('IDLE'),
  getCurrentAnimation: () => activeAnim,
  setCurrentAnimation: (a) => { activeAnim = a; },
  getIsSleeping: () => false,
  randomProvider: () => 0.10 // Forca escolha da nova animacao
});

dragCanvas.dispatch('mousedown', { button: 0 });
assert(activeAnim !== null, 'Animacao de arraste deve ter iniciado');
assert(activeAnim.animationPath.includes('balancing_lottie'), 'Deve iniciar balancing_lottie');
assert.strictEqual(activeAnim.isPlaying, true, 'Animacao balancing deve estar tocando');

dragCanvas.dispatch('mouseup', {});
assert.strictEqual(activeAnim, null, 'Ao soltar da animacao de equilibrio, deve retornar diretamente ao repouso sem disparar landing');
console.log('  ok   Arraste com nova animacao (equilibrio) finaliza diretamente sem landing');

// 5. Teste de arraste com animacao antiga de flutuacao (mouseup com landing)
async function testFloatingLanding() {
  activeAnim = null;
  let hDragFloating = new NexaDragHandler({
    canvas: dragCanvas,
    animController: new FakeAnimController('IDLE'),
    getCurrentAnimation: () => activeAnim,
    setCurrentAnimation: (a) => { activeAnim = a; },
    getIsSleeping: () => false,
    randomProvider: () => 0.95 // Forca escolha da animacao antiga
  });

  dragCanvas.dispatch('mousedown', { button: 0 });
  assert(activeAnim !== null, 'Animacao de arraste deve ter iniciado');
  assert(activeAnim.animationPath.includes('floating_lottie'), 'Deve iniciar floating_lottie');

  dragCanvas.dispatch('mouseup', {});
  
  // Aguarda o intervalo de troca da animacao de pouso (16-50ms)
  await new Promise((resolve) => setTimeout(resolve, 50));
  
  assert(activeAnim !== null, 'Animacao antiga deve transicionar para animacao de landing');
  assert(activeAnim.animationPath.includes('landing_lottie'), 'Deve acionar landing_lottie');
  console.log('  ok   Arraste com animacao antiga (flutuacao) transiciona para landing corretamente');

  console.log('\nTodos os testes do NexaDragHandler passaram com 100% de sucesso! 🎉');
}

testFloatingLanding().catch((err) => {
  console.error('Falha nos testes:', err);
  process.exit(1);
});


