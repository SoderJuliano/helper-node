// scripts/test-tab-header-drag.js
// Teste para garantir que a barra de abas e o header do editor não têm áreas de drag sobrepostas.

const assert = require('assert');
const fs = require('fs');

console.log('=== Testando Áreas de Drag e Acesso aos Cliques das Abas ===\n');

// 1. Verifica que styles/editor.css não contém -webkit-app-region: drag na classe .drag-area
const editorCss = fs.readFileSync('styles/editor.css', 'utf8');
const dragAreaMatch = editorCss.match(/\.drag-area\s*\{([^}]+)\}/);
assert.ok(dragAreaMatch, '.drag-area deve estar definido');
assert.ok(!dragAreaMatch[1].includes('-webkit-app-region: drag'), '.drag-area NÃO pode conter -webkit-app-region: drag');
assert.ok(dragAreaMatch[1].includes('display: none'), '.drag-area deve estar oculto com display: none');
console.log('  ok   styles/editor.css não possui .drag-area com arrasto');

// 2. Verifica que terminal.css define no-drag !important para .fv-header e abas
const terminalCss = fs.readFileSync('styles/terminal.css', 'utf8');
assert.ok(terminalCss.includes('.fv-header * { -webkit-app-region: no-drag !important; }'), '.fv-header * deve ter no-drag !important');
assert.ok(terminalCss.includes('.fv-tab {'), '.fv-tab deve estar definido');
console.log('  ok   styles/terminal.css define no-drag !important para todas as abas e cabeçalho');

// 3. Verifica que index.html não tem elementos de drag absolutos cobrindo o topo
const html = fs.readFileSync('index.html', 'utf8');
assert.ok(!html.includes('<div class="drag-area"></div>'), 'index.html não deve ter .drag-area desprotegido');
console.log('  ok   index.html devidamente configurado');

console.log('\nTodos os testes de cliques e drag das abas passaram com sucesso!\n');
