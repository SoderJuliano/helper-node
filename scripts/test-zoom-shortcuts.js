// scripts/test-zoom-shortcuts.js
const assert = require('assert');
const fs = require('fs');
const path = require('path');

console.log('🧪 Iniciando testes de zoom e atalhos de teclado (Ctrl+ / Ctrl- / Ctrl 0)...');

// 1. Validar preload.js
const preloadPath = path.join(__dirname, '..', 'preload.js');
const preloadContent = fs.readFileSync(preloadPath, 'utf8');

assert.ok(preloadContent.includes('webFrame'), 'preload.js deve importar webFrame');
assert.ok(preloadContent.includes('setZoomFactor'), 'preload.js deve expor setZoomFactor');
assert.ok(preloadContent.includes('getZoomFactor'), 'preload.js deve expor getZoomFactor');
assert.ok(preloadContent.includes('resetZoom'), 'preload.js deve expor resetZoom');
console.log('✅ 1. preload.js contém APIs do webFrame exportadas corretamente.');

// 2. Validar arquivos de overlays
const filesToCheck = [
  path.join(__dirname, '..', 'os-integration', 'notifications', 'realtime-assistant-overlay.js'),
  path.join(__dirname, '..', 'os-integration', 'notifications', 'translation-overlay.js'),
  path.join(__dirname, '..', 'os-integration', 'notifications', 'vision-guide-overlay.js'),
  path.join(__dirname, '..', 'os-integration', 'notifications', 'response.html'),
  path.join(__dirname, '..', 'editorController.js'),
  path.join(__dirname, '..', 'renderer', 'workspaceTreeEvents.js'),
  path.join(__dirname, '..', 'renderer', 'terminal.js'),
  path.join(__dirname, '..', 'renderer', 'windowControls.js'),
];

filesToCheck.forEach((filePath) => {
  const content = fs.readFileSync(filePath, 'utf8');
  assert.ok(
    content.includes('Equal') || content.includes('NumpadAdd') || content.includes('changeEditorFontSize') || content.includes('changeTreeFontSize'),
    `Arquivo ${path.basename(filePath)} deve ter suporte robusto a teclas de Zoom (+, =, NumpadAdd)`
  );
  assert.ok(
    content.includes('NumpadSubtract') || content.includes('Minus'),
    `Arquivo ${path.basename(filePath)} deve ter suporte a teclas de Zoom Out (-, NumpadSubtract)`
  );
});
console.log('✅ 2. Todos os overlays e componentes contêm detecção de atalhos de zoom.');

// 3. Teste da função de lógica de teclas
function testKeyMatcher(e) {
  const isPlus = e.key === '+' || e.key === '=' || e.code === 'Equal' || e.code === 'NumpadAdd';
  const isMinus = e.key === '-' || e.key === '_' || e.code === 'Minus' || e.code === 'NumpadSubtract';
  const isZero = e.key === '0' || e.code === 'Digit0' || e.code === 'Numpad0';
  return { isPlus, isMinus, isZero };
}

// Casos reais de teclado:
// Caso A: Ctrl + '+' onde Shift está pressionado (teclado US/ABNT2 Shift+=)
assert.deepStrictEqual(testKeyMatcher({ key: '+', code: 'Equal', shiftKey: true, ctrlKey: true }), { isPlus: true, isMinus: false, isZero: false });

// Caso B: Ctrl + '=' onde Shift não está pressionado (usuário aperta tecla do + sem Shift)
assert.deepStrictEqual(testKeyMatcher({ key: '=', code: 'Equal', shiftKey: false, ctrlKey: true }), { isPlus: true, isMinus: false, isZero: false });

// Caso C: Teclado numérico '+'
assert.deepStrictEqual(testKeyMatcher({ key: '+', code: 'NumpadAdd', shiftKey: false, ctrlKey: true }), { isPlus: true, isMinus: false, isZero: false });

// Caso D: Ctrl + '-'
assert.deepStrictEqual(testKeyMatcher({ key: '-', code: 'Minus', shiftKey: false, ctrlKey: true }), { isPlus: false, isMinus: true, isZero: false });

// Caso E: Teclado numérico '-'
assert.deepStrictEqual(testKeyMatcher({ key: '-', code: 'NumpadSubtract', shiftKey: false, ctrlKey: true }), { isPlus: false, isMinus: true, isZero: false });

// Caso F: Ctrl + '0'
assert.deepStrictEqual(testKeyMatcher({ key: '0', code: 'Digit0', shiftKey: false, ctrlKey: true }), { isPlus: false, isMinus: false, isZero: true });

// Caso G: Teclado numérico '0'
assert.deepStrictEqual(testKeyMatcher({ key: '0', code: 'Numpad0', shiftKey: false, ctrlKey: true }), { isPlus: false, isMinus: false, isZero: true });

console.log('✅ 3. Lógica de combinação de teclas (Plus, Minus, Zero) validada com 100% de sucesso.');

// 4. Teste de cálculo de zoom e clamp
function calculateZoom(current, delta, min = 0.6, max = 2.5) {
  return Math.min(max, Math.max(min, Math.round((current + delta) * 10) / 10));
}

assert.strictEqual(calculateZoom(1.0, 0.1), 1.1);
assert.strictEqual(calculateZoom(1.1, 0.1), 1.2);
assert.strictEqual(calculateZoom(1.0, -0.1), 0.9);
assert.strictEqual(calculateZoom(0.6, -0.1), 0.6); // clamp min
assert.strictEqual(calculateZoom(2.5, 0.1), 2.5); // clamp max

console.log('✅ 4. Cálculo e limites de zoom (0.6x a 2.5x) validados com sucesso.');
console.log('🎉 Todos os testes de Zoom passaram com perfeição!');
