// scripts/test-tab-header-drag.js
// Teste para garantir que a barra de abas e o header do editor mantêm as abas 100% interativas (no-drag)
// e os espaços vazios e títulos permitindo o arrasto da janela.

const assert = require('assert');
const fs = require('fs');

console.log('=== Testando Áreas de Drag e Acesso aos Cliques das Abas ===\n');

// 1. Verifica que styles/editor.css não contém -webkit-app-region: drag na classe .drag-area
const editorCss = fs.readFileSync('styles/editor.css', 'utf8');
const dragAreaMatch = editorCss.match(/\.drag-area\s*\{([^}]+)\}/);
assert.ok(dragAreaMatch, '.drag-area deve estar definido');
assert.ok(!dragAreaMatch[1].includes('-webkit-app-region: drag'), '.drag-area NÃO pode conter -webkit-app-region: drag');
assert.ok(dragAreaMatch[1].includes('display: none'), '.drag-area deve estar oculto com display: none');
console.log('  ok   styles/editor.css não possui .drag-area bloqueando o topo');

// 2. Verifica que terminal.css define drag para espaços vazios e no-drag !important para cada aba renderizada
const terminalCss = fs.readFileSync('styles/terminal.css', 'utf8');
assert.ok(terminalCss.includes('.fv-tab {') && terminalCss.includes('-webkit-app-region: no-drag !important'), '.fv-tab deve ter no-drag !important');
assert.ok(terminalCss.includes('.fv-tab * { -webkit-app-region: no-drag !important; }'), '.fv-tab * deve ter no-drag !important');
assert.ok(terminalCss.includes('.fv-close {') && terminalCss.includes('-webkit-app-region: no-drag !important'), '.fv-close deve ter no-drag !important');
assert.ok(terminalCss.includes('.fv-header {') && terminalCss.includes('-webkit-app-region: drag;'), '.fv-header deve ter drag nos espaços vazios');
console.log('  ok   styles/terminal.css define abas como no-drag !important e cabeçalho vazio com drag');

// 3. Verifica que a sidebar permite arrastar por Helper Node full
const baseCss = fs.readFileSync('styles/base.css', 'utf8');
assert.ok(baseCss.includes('.sb-brand {') && baseCss.includes('-webkit-app-region: drag;'), '.sb-brand deve permitir arrasto');
assert.ok(baseCss.includes('.sb-brand .sb-ver {') && baseCss.includes('-webkit-app-region: drag;'), '.sb-ver deve permitir arrasto');
console.log('  ok   styles/base.css permite arrasto por "Helper Node full"');

// 4. Verifica que index.html não tem elementos de drag absolutos cobrindo o topo
const html = fs.readFileSync('index.html', 'utf8');
assert.ok(!html.includes('<div class="drag-area"></div>'), 'index.html não deve ter .drag-area desprotegido');
console.log('  ok   index.html devidamente configurado');

console.log('\nTodos os testes de cliques e drag das abas passaram com sucesso!\n');
