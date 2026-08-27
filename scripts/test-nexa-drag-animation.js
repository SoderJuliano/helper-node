// scripts/test-nexa-drag-animation.js
// Testes unitarios para o NexaDragHandler e protecao das animacoes de trabalho/pensamento.

const assert = require('assert');
const { NexaDragHandler } = require('../renderer/nexa/nexaDragHandler.js');

console.log('=== Testando Protecao de Animacoes da Nexa durante Arraste da Janela ===\n');

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

assert(  handler.isBusyWorkingState(), 'THINKING deve ser reconhecido como estado ativo' );
canvas.dispatch('mousedown', { button: 0 });
assert.equal(curAnim.isPlaying, true, 'Animacao de pensamento NAO pode ser parada ao arrastar');
assert(curAnim.animationPath.includes('thinking'), 'Deve manter animacao thinking, nao trocar pra floating');
console.log('  ok   Estado THINKING preservado com sucesso durante arraste');

// 2. Teste em estado WORKING (escrevendo codigo / typing)
curAnim = new FakeAnimation('renderer/nexa/assets/lottie/typing_lottie/animations/main.json');
controller.setState('WORKING');
assert( handler.isBusyWorkingState(), 'WORKING deve ser reconhecido como estado ativo' );
canvas.dispatch('mousedown', { button: 0 });
assert.equal(curAnim.isPlaying, true, 'Animacao de digitacao/escrita NAO pode ser parada ao arrastar');
assert(curAnim.animationPath.includes('typing'), 'Deve manter animacao typing/writing, nao trocar pra floating');
console.log('  ok   Estado WORKING (escrita de codigo) preservado com sucesso durante arraste');

// 3. Teste em estado IDL (flutuacao liberada quando livre)
controller.setState('IDLE');
curAnim = new FakeAnimation('renderer/nexa/assets/lottie/idle_lottie/animations/main.json');
assert(!handler.isBusyWorkingState(), 'IDLE deve permitir flutuacao');
console.log('  ok   Estado IDLE permite flutuacao e pouso corretamente');

console.log('\nTodos os testes do NexaDragHandler passaram com sucesso! ׍');
