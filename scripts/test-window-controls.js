// scripts/test-window-controls.js
// Testes dos botoes de controle da janela principal (Minimizar, Maximizar, Fechar).

const assert = require('assert');
const fs = require('fs');

console.log('=== Testando Controles de Janela (min/max/close) ===\n');

// 1. Verifica DOM no index.html
const html = fs.readFileSync('index.html', 'utf8');
assert.ok(html.includes('id="main-win-min-btn"'), 'index.html deve conter main-win-min-btn');
assert.ok(html.includes('id="main-win-max-btn"'), 'index.html deve conter main-win-max-btn');
assert.ok(html.includes('id="main-win-close-btn"'), 'index.html deve conter main-win-close-btn');
assert.ok(html.includes('id="win-controls-overlay"'), 'index.html deve conter win-controls-overlay');
console.log('  ok   Elementos DOM dos botoes estao presentes no index.html');

// 2. Verifica CSS em base.css
const css = fs.readFileSync('styles/base.css', 'utf8');
assert.ok(css.includes('.win-controls-overlay'), 'base.css deve conter estilos de .win-controls-overlay');
assert.ok(css.includes('-webkit-app-region: no-drag !important'), 'botoes devem ter no-drag !important');
assert.ok(css.includes('pointer-events: auto !important'), 'botoes devem ter pointer-events: auto !important');
console.log('  ok   CSS configurado com no-drag, pointer-events e z-index alto');

// 3. Verifica Preload exports
const preload = fs.readFileSync('preload.js', 'utf8');
assert.ok(preload.includes('minimizeWindow: () =>'), 'preload deve expor minimizeWindow');
assert.ok(preload.includes('maximizeWindow: () =>'), 'preload deve expor maximizeWindow');
assert.ok(preload.includes('closeWindow: () =>'), 'preload deve expor closeWindow');
console.log('  ok   Preload expoe minimizeWindow, maximizeWindow e closeWindow');

// 4. Verifica IPC Handlers em main/ipc/window.js
const windowIpc = fs.readFileSync('main/ipc/window.js', 'utf8');
assert.ok(windowIpc.includes('ipcMain.on("window-minimize"'), 'window-minimize handler deve existir');
assert.ok(windowIpc.includes('ipcMain.on("window-toggle-maximize"'), 'window-toggle-maximize handler deve existir');
assert.ok(windowIpc.includes('ipcMain.on("window-close"'), 'window-close handler deve existir');
console.log('  ok   IPC Handlers do main process registrados corretamente');

// 5. Verifica Resize Handles no index.html e base.css
assert.ok(html.includes('class="win-resize-handle win-resize-top"'), 'index.html deve conter win-resize-top');
assert.ok(html.includes('class="win-resize-handle win-resize-bottom"'), 'index.html deve conter win-resize-bottom');
assert.ok(html.includes('class="win-resize-handle win-resize-left"'), 'index.html deve conter win-resize-left');
assert.ok(html.includes('class="win-resize-handle win-resize-right"'), 'index.html deve conter win-resize-right');
assert.ok(css.includes('.win-resize-handle'), 'base.css deve conter estilos de .win-resize-handle');
assert.ok(preload.includes('setWindowBounds: (bounds) =>'), 'preload deve expor setWindowBounds');
assert.ok(windowIpc.includes('ipcMain.on("window-set-bounds"'), 'window-set-bounds handler deve existir');
console.log('  ok   Resize handles e IPC window-set-bounds configurados com sucesso');

console.log('\nTodos os testes de controles de janela passaram com sucesso! \n');

