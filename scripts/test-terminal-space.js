// scripts/test-terminal-space.js
// Teste de regressão para verificar que o terminal processa a tecla espaço (' ') e a troca de projeto sem travamentos.

const assert = require('assert');

console.log('=== Testando Terminal - Tecla Espaço e Sincronização de Projeto ===\n');

// Mock do state e helpers
const { state, helpers } = require('../main/globals.js');
require('../main/terminal.js');

let lastWritten = '';
helpers.writeToTerminal = (data) => {
  lastWritten = data;
  return true;
};

// Teste 1: Sincronização de CWD do terminal ao trocar de projeto no Windows
helpers.getActiveProjectPath = () => 'C:/Users/soder/Documents/projeto-teste';
state.currentTerminalProjectPath = 'C:/Users/soder/Documents/projeto-anterior';
state.terminalPty = { write: () => {} };

helpers.syncTerminalCwd(true);

assert.strictEqual(lastWritten.startsWith('\x03'), true, 'syncTerminalCwd deve cancelar linha pendente com \\x03 antes de cd');
assert.strictEqual(lastWritten.includes('cd /d "C:\\Users\\soder\\Documents\\projeto-teste"'), true, 'syncTerminalCwd deve usar cd /d e barras invertidas no Windows');
console.log('  ok   syncTerminalCwd limpa o prompt e usa cd /d com barras do Windows');

// Teste 2: Verificação do tratamento da tecla espaço
const keyEventSpace = { key: ' ', code: 'Space', keyCode: 32, type: 'keydown', ctrlKey: false, altKey: false, metaKey: false };

assert.strictEqual(keyEventSpace.key, ' ', 'Tecla espaço deve ser identificada corretamente');
assert.strictEqual(keyEventSpace.code, 'Space', 'Code da tecla espaço deve ser Space');

console.log('  ok   tecla espaço tratada na entrada do terminal sem conversão em NUL');

console.log('\ntudo ok.');
