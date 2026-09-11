// scripts/test-nexa-searching-animation.js
// Testes unitarios para a animacao de globo holografico (SEARCHING / pesquisa na web) da Nexa.

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { nexaState } = require('../main/nexa/nexaState.js');
const { isWebSearchTool } = require('../main/nexa/nexaIntegration.js');
const { NexaDragHandler } = require('../renderer/nexa/nexaDragHandler.js');

console.log('=== Testando Animacao do Globo Holografico e Estado SEARCHING da Nexa ===\n');

// 1. Validacao de arquivos em disco
const globeLottieDir = path.join(__dirname, '../renderer/nexa/assets/lottie/globe_lottie');
const mainJsonPath = path.join(globeLottieDir, 'animations/main.json');
assert(fs.existsSync(mainJsonPath), 'main.json de globe_lottie deve existir');
const jsonContent = JSON.parse(fs.readFileSync(mainJsonPath, 'utf8'));
assert.strictEqual(jsonContent.w, 270, 'Largura base deve ser 270');
assert.strictEqual(jsonContent.h, 480, 'Altura base deve ser 480');
assert.strictEqual(jsonContent.assets.length, 96, 'Deve conter 96 frames (4 segundos a 24fps)');
console.log('  ok   Integridade dos assets de globe_lottie validada com sucesso');

// 2. Validacao do estado SEARCHING na maquina de estados
nexaState.reset();
assert.strictEqual(nexaState.getState(), 'IDLE', 'Estado inicial deve ser IDLE');

let stateChangeEmitted = false;
const onStateChange = ({ state }) => {
  if (state === 'SEARCHING') stateChangeEmitted = true;
};
nexaState.on('state-changed', onStateChange);

const ok = nexaState.setState('SEARCHING');
assert.strictEqual(ok, true, 'Transição para SEARCHING deve ser aceita');
assert.strictEqual(nexaState.getState(), 'SEARCHING', 'Estado atual deve ser SEARCHING');
assert.strictEqual(stateChangeEmitted, true, 'Evento state-changed deve ter sido emitido com SEARCHING');
nexaState.removeListener('state-changed', onStateChange);
console.log('  ok   Maquina de estados aceita SEARCHING com sucesso');

// 3. Teste de deteccao de ferramentas de busca na web
const searchTools = [
  { name: 'search_web', label: 'Pesquisando na web' },
  { name: 'read_url_content', label: 'Lendo página web' },
  { name: 'google_search', label: 'Buscando no Google' },
  { name: 'browse_web', label: 'Navegando na internet' },
  { name: 'weather', label: 'Consultando previsão do tempo' },
  { name: 'tavily_search', label: 'Pesquisa online' },
  { name: 'tool_custom', label: 'Acessando internet para notícias' }
];

for (const t of searchTools) {
  assert.strictEqual(isWebSearchTool(t.name, t.label), true, `Deve identificar ${t.name} como web tool`);
}

const fileTools = [
  { name: 'readFile', label: 'Lendo arquivo local' },
  { name: 'writeFile', label: 'Escrevendo arquivo' },
  { name: 'patchFile', label: 'Patch de código' }
];

for (const t of fileTools) {
  assert.strictEqual(isWebSearchTool(t.name, t.label), false, `Nao deve identificar ${t.name} como web tool`);
}
console.log('  ok   Identificacao de ferramentas de busca na web validada');

// 4. Teste de protecao do NexaDragHandler durante SEARCHING
class FakeAnimController {
  constructor(state = 'SEARCHING') {
    this.state = state;
  }
  getCurrentState() {
    return this.state;
  }
}

class FakeAnimation {
  constructor(animationPath, isPlaying = true) {
    this.animationPath = animationPath;
    this.isPlaying = isPlaying;
  }
  stop() {
    this.isPlaying = false;
  }
}

class FakeCanvas {
  constructor() {
    this.handlers = {};
    this.style = {};
  }
  addEventListener(name, fn) {
    this.handlers[name] = fn;
  }
  dispatch(name, evt) {
    if (this.handlers[name]) this.handlers[name](evt);
  }
}

let curAnim = new FakeAnimation('renderer/nexa/assets/lottie/globe_lottie/animations/main.json');
let controller = new FakeAnimController('SEARCHING');
let canvas = new FakeCanvas();

let handler = new NexaDragHandler({
  canvas,
  animController: controller,
  getCurrentAnimation: () => curAnim,
  setCurrentAnimation: (a) => { curAnim = a; },
  getIsSleeping: () => false
});

assert(handler.isBusyWorkingState(), 'SEARCHING deve ser considerado busy');
canvas.dispatch('mousedown', { button: 0 });
assert.strictEqual(curAnim.isPlaying, true, 'Animacao do globo holografico nao pode ser interrompida ao arrastar');
console.log('  ok   Protecao contra interrupcao do globo durante arraste validada');

console.log('\nTodos os testes de animacao do globo e estado SEARCHING passaram com 100% de sucesso! 🌍🎉');
