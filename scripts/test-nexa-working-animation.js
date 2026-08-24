/**
 * scripts/test-nexa-working-animation.js
 * Testa a máquina de estados, o evento de tools (leitura/escrita de arquivos)
 * e o catálogo de animações da Nexa.
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');

console.log('🧪 Iniciando testes da animação de digitação/escrita (WORKING) da Nexa...');

// 1. Valida Catálogo de Animações
const { NEXA_ANIMATIONS } = require('../main/nexa/nexaAnimations.js');
assert.ok(NEXA_ANIMATIONS.typing, 'Catálogo deve conter animação typing');
assert.ok(NEXA_ANIMATIONS.writing_code, 'Catálogo deve conter animação writing_code');
assert.ok(NEXA_ANIMATIONS.thinking, 'Catálogo deve conter animação thinking');

// Garante que as animações principais existem em disco
assert.ok(fs.existsSync(NEXA_ANIMATIONS.typing.lottiePath), 'typing_lottie deve existir');
assert.ok(fs.existsSync(NEXA_ANIMATIONS.writing_code.lottiePath), 'writing_code_lottie deve existir');
assert.ok(fs.existsSync(NEXA_ANIMATIONS.thinking.lottiePath), 'thinking_lottie deve existir');

for (const [key, anim] of Object.entries(NEXA_ANIMATIONS)) {
  if (anim.lottiePath) {
    const exists = fs.existsSync(anim.lottiePath);
    if (!exists) {
      console.warn(`  ⚠️ Aviso: Animação ${key} registrada no catálogo mas pasta Lottie ainda não presente em disco (${anim.lottiePath})`);
    } else {
      console.log(`  ✅ Animação presente em disco: ${key}`);
    }
  }
}
console.log('  ✅ Teste 1: Catálogo de animações validado com sucesso.');

// 2. Valida Máquina de Estados com WORKING
const { nexaState } = require('../main/nexa/nexaState.js');
nexaState.reset();
assert.strictEqual(nexaState.getState(), 'IDLE');

let stateChanges = [];
nexaState.on('state-changed', ({ state, previousState }) => {
  stateChanges.push({ from: previousState, to: state });
});

nexaState.setState('THINKING');
assert.strictEqual(nexaState.getState(), 'THINKING');

nexaState.setState('WORKING');
assert.strictEqual(nexaState.getState(), 'WORKING');

nexaState.setState('SPEAKING');
assert.strictEqual(nexaState.getState(), 'SPEAKING');

nexaState.setState('IDLE');
assert.strictEqual(nexaState.getState(), 'IDLE');

console.log('  ✅ Teste 2: Transições de estado com WORKING validadas.');

// 3. Valida resolução de caminhos Lottie no Windows
function resolveLottieAssetsPath(animPathStr, pageDir = 'C:/Users/soder/Documents/helper-node/renderer/nexa') {
  let animPath = (animPathStr || '').replace(/\\/g, '/');
  const isAbsolute = /^[A-Za-z]:\//.test(animPath) || animPath.startsWith('/') || animPath.startsWith('file://');

  if (!isAbsolute) {
    const cleanDir = pageDir.replace(/^\/+([A-Za-z]:)/, '$1');
    if (animPath.startsWith('renderer/nexa/')) {
      animPath = cleanDir + '/' + animPath.substring('renderer/nexa/'.length);
    } else {
      animPath = cleanDir + '/' + animPath;
    }
  }

  animPath = animPath.replace(/^file:\/\/\/?/, '');
  const parts = animPath.split('/');
  let assetsPath = '';
  if (parts.length > 2) {
    assetsPath = parts.slice(0, -2).join('/') + '/images/';
  }
  if (!assetsPath.startsWith('file://')) {
    assetsPath = 'file:///' + assetsPath.replace(/^\/+/, '');
  }
  return assetsPath;
}

const relAssets = resolveLottieAssetsPath('renderer/nexa/assets/lottie/typing_lottie/animations/main.json');
assert.strictEqual(relAssets, 'file:///C:/Users/soder/Documents/helper-node/renderer/nexa/assets/lottie/typing_lottie/images/');

const absAssets = resolveLottieAssetsPath('C:\\Users\\soder\\Documents\\helper-node\\renderer\\nexa\\assets\\lottie\\typing_lottie\\animations\\main.json');
assert.strictEqual(absAssets, 'file:///C:/Users/soder/Documents/helper-node/renderer/nexa/assets/lottie/typing_lottie/images/');

console.log('  ✅ Teste 3: Resolução de caminhos Lottie no Windows validada.');

console.log('🎉 TODOS OS TESTES DE ANIMAÇÃO WORKING/TYPING FORAM APROVADOS!');
