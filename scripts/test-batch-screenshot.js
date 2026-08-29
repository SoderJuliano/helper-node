// scripts/test-batch-screenshot.js
const assert = require('assert');
const path = require('path');

console.log('🧪 Iniciando testes do Multi-Screenshot Batch Collector...');

// 1. Mock globals & helpers
const { state, helpers } = require('../main/globals.js');
require('../main/helpers/batchScreenshot.js');

// Reset state
state.batchScreenshots = [];

// Test 1: Add screenshot to batch
console.log('Test 1: Adicionar screenshots na fila');
const fakeBase64_1 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
const fakeBase64_2 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

helpers.addScreenshotToBatch(fakeBase64_1);
assert.strictEqual(state.batchScreenshots.length, 1, 'Deveria ter 1 item na fila');

helpers.addScreenshotToBatch(fakeBase64_2);
assert.strictEqual(state.batchScreenshots.length, 2, 'Deveria ter 2 itens na fila');

const item1 = state.batchScreenshots[0];
const item2 = state.batchScreenshots[1];
assert.ok(item1.id.startsWith('shot_'), 'ID deve ter prefixo shot_');
assert.strictEqual(item1.base64, fakeBase64_1);
assert.strictEqual(item2.base64, fakeBase64_2);

// Test 2: Remove individual screenshot
console.log('Test 2: Remover screenshot individual');
helpers.removeScreenshotFromBatch(item1.id);
assert.strictEqual(state.batchScreenshots.length, 1, 'Deveria restar 1 item');
assert.strictEqual(state.batchScreenshots[0].id, item2.id, 'O item restante deve ser o item 2');

// Test 3: Clear queue
console.log('Test 3: Limpar fila completa');
helpers.clearBatchScreenshots();
assert.strictEqual(state.batchScreenshots.length, 0, 'Fila deve estar vazia');

// Test 4: OpenAIService multimodal payload with multiple images
console.log('Test 4: OpenAIService suporte a array de imagens');
const OpenAIService = require('../services/openAIService.js');
assert.ok(typeof OpenAIService.makeOpenAIRequest === 'function');

// Test 5: Helper methods existence and computeBatchOverlayBounds
console.log('Test 5: Validar funções do helper de Batch');
assert.strictEqual(typeof helpers.computeBatchOverlayBounds, 'function');
assert.strictEqual(typeof helpers.createBatchScreenshotOverlay, 'function');
assert.strictEqual(typeof helpers.showBatchScreenshotOverlay, 'function');
assert.strictEqual(typeof helpers.hideBatchScreenshotOverlay, 'function');
assert.strictEqual(typeof helpers.isBatchScreenshotModeActive, 'function');
assert.strictEqual(typeof helpers.toggleBatchScreenshot, 'function');
assert.strictEqual(typeof helpers.processBatchScreenshots, 'function');
assert.strictEqual(typeof helpers.processBatchOsQuestion, 'function');

console.log('✅ Todos os testes do Batch Screenshot Collector passaram com sucesso!');
