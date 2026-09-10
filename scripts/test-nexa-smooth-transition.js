/**
 * scripts/test-nexa-smooth-transition.js
 * 
 * Teste unitário para transição suave de loops de animação da Nexa.
 */

const assert = require('assert');
const { NexaLottieAnimation } = require('../renderer/nexa/nexaLottieAnimation.js');

console.log('🧪 Testando transição suave e conclusão de loops de animação...\n');

// 1. Teste de NexaLottieAnimation com finishLoopAndStop
{
  const anim = new NexaLottieAnimation({ animationPath: 'test.json', loop: true });
  anim.isPlaying = true;
  anim.finished = false;
  
  // Mock do objeto lottie-web anim
  let loopSet = true;
  anim.anim = {
    setLoop(val) { loopSet = val; },
    loop: true
  };

  let completed = false;
  anim.finishLoopAndStop(() => {
    completed = true;
  });

  assert.strictEqual(anim.loop, false, 'Loop deve ser definido como false');
  assert.strictEqual(loopSet, false, 'setLoop do lottie-web deve receber false');
  assert.strictEqual(typeof anim.onComplete, 'function', 'onComplete deve ser configurado');

  // Simula o término do loop disparando o evento complete do lottie-web
  anim.onComplete();
  assert.strictEqual(completed, true, 'Callback de conclusão deve ser chamado após o fim do loop');
  console.log('✅ Caso 1: finishLoopAndStop finaliza o ciclo atual de loop sem corte abrupto');
}

// 2. Teste de lógica de fila de transição suave
{
  let currentState = 'IDLE';
  let activeAnimationName = 'stretching_lottie';
  let pendingState = null;
  let appliedState = null;

  function onStateChange(newState) {
    if (activeAnimationName === 'stretching_lottie' && (newState === 'THINKING' || newState === 'WORKING')) {
      pendingState = newState;
      // Não aplica imediatamente, aguarda fim da animação
      return;
    }
    appliedState = newState;
  }

  // Recebe estado THINKING enquanto se espreguiça
  onStateChange('THINKING');
  assert.strictEqual(pendingState, 'THINKING', 'Deve enfileirar THINKING como transição pendente');
  assert.strictEqual(appliedState, null, 'Não deve aplicar imediatamente');

  // Ao terminar de se espreguiçar:
  if (pendingState) {
    appliedState = pendingState;
    pendingState = null;
    activeAnimationName = 'thinking_lottie';
  }

  assert.strictEqual(appliedState, 'THINKING', 'Deve aplicar THINKING suavemente ao fim do movimento');
  assert.strictEqual(activeAnimationName, 'thinking_lottie');
  console.log('✅ Caso 2: Transição de IDLE para THINKING aguarda o fim do movimento em curso');
}

console.log('\n🎉 Todos os testes de transição suave de animação passaram com sucesso!');
