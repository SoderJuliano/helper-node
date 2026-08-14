// scripts/test-realtime-tab-sync.js
// Teste automatizado de regressão para a sincronização de abas do editor em tempo real (disk / IA).

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

console.log('=== Testando Sincronização de Abas do Editor em Tempo Real ===\n');

const tmpDir = path.join(os.tmpdir(), 'helper-realtime-sync-test-' + Date.now());
fs.mkdirSync(tmpDir, { recursive: true });

const testFile1 = path.join(tmpDir, 'App.js');
const testFile2 = path.join(tmpDir, 'Utils.js');

fs.writeFileSync(testFile1, 'console.log("v1");\n', 'utf8');
fs.writeFileSync(testFile2, 'export const name = "v1";\n', 'utf8');

// 1. Testando workspaceWatcher
const workspaceWatcher = require('../services/workspaceWatcher.js');
let eventFired = false;
let eventData = null;

// Mock do globals helpers pra capturar emitFileMutated
const { helpers } = require('../main/globals.js');
const oldEmit = helpers.emitFileMutated;
helpers.emitFileMutated = (data) => {
  eventFired = true;
  eventData = data;
};

workspaceWatcher.startWatchingProject(tmpDir);

// Escreve alteração no disco
fs.writeFileSync(testFile1, 'console.log("v2 - git pull");\n', 'utf8');

setTimeout(() => {
  try {
    assert.strictEqual(eventFired, true, 'workspaceWatcher deve disparar emitFileMutated ao alterar arquivo no disco');
    assert.strictEqual(path.normalize(eventData.path), path.normalize(testFile1), 'Caminho do evento deve corresponder ao arquivo alterado');
    assert.strictEqual(eventData.origin, 'disk', 'Origem da alteração deve ser disk');
    console.log('  ok   workspaceWatcher detectou git pull / edição externa no disco perfeitamente');
  } catch (err) {
    console.error('  FALHA:', err.message);
    process.exit(1);
  } finally {
    workspaceWatcher.stopWatching();
    helpers.emitFileMutated = oldEmit;
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
    console.log('\ntudo ok.');
  }
}, 300);
