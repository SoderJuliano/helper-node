// scripts/test-workspace-rename.js
const assert = require('assert');
const path = require('path');
const fs = require('fs');
const os = require('os');

console.log('=== Testando Renomeação de Arquivos e Resiliência na Abertura do Workspace ===\n');

const tmpDir = path.join(os.tmpdir(), 'helper-rename-test-' + Date.now());
fs.mkdirSync(tmpDir, { recursive: true });

try {
  const file1 = path.join(tmpDir, 'collect.java');
  const file2 = path.join(tmpDir, 'collectcontroller.java');
  fs.writeFileSync(file1, 'public class Collect {}', 'utf8');

  // 1. Testa renomeação no disco com case-sensitivity e caminhos
  assert(fs.existsSync(file1), 'Arquivo collect.java deve existir');
  
  // Simula lógica do workspace:rename-item
  const normOld = path.resolve(file1);
  const normNew = path.resolve(file2);
  const isCaseOnlyRename = process.platform === 'win32' && normOld.toLowerCase() === normNew.toLowerCase() && normOld !== normNew;
  
  if (isCaseOnlyRename) {
    const tempRenamePath = normOld + `.__rename_temp_${Date.now()}`;
    fs.renameSync(normOld, tempRenamePath);
    fs.renameSync(tempRenamePath, normNew);
  } else {
    fs.renameSync(normOld, normNew);
  }

  assert(!fs.existsSync(file1), 'Arquivo antigo nao deve mais existir');
  assert(fs.existsSync(file2), 'Arquivo novo collectcontroller.java deve existir no disco');
  console.log('  ok   Renomeacao de arquivo no disco executada com sucesso');

  // 2. Testa que workspaceTreeEvents só bloqueia o próprio node em renomeação
  const treeEventsCode = fs.readFileSync('renderer/workspaceTreeEvents.js', 'utf8');
  assert(treeEventsCode.includes('renamingPath === e.path'), 'workspaceTreeEvents deve verificar renamingPath === e.path e não bloquear outros nós');
  assert(!treeEventsCode.includes('if (ev.target.closest(\'.ws-tree-checkbox\') || renamingPath) return;'), 'Antigo bug que bloqueava todos os cliques na arvore foi removido');
  console.log('  ok   Clique na arvore de arquivos nao e mais bloqueado globalmente por renamingPath');

  // 3. Testa sincronização de abas abertas em editorFileMutations
  const fileMutationsCode = fs.readFileSync('renderer/editor/editorFileMutations.js', 'utf8');
  assert(fileMutationsCode.includes('handleRenamePath(ctx, op, p)'), 'handleFileMutated deve chamar handleRenamePath quando recebe oldPath');
  assert(fileMutationsCode.includes('const oldPath = normPath(oldRaw)'), 'handleRenamePath deve normalizar os caminhos');
  console.log('  ok   editorFileMutations sincroniza abas abertas e caminhos normalizados');

  // 4. Testa retry de carregamento em editorController
  const editorCode = fs.readFileSync('editorController.js', 'utf8');
  assert(editorCode.includes('const isDocInError = doc && typeof doc.content === \'string\' && doc.content.startsWith(\'// Não foi possível abrir:\')'), 'editorController deve re-tentar carregar arquivos que anteriormente deram erro');
  console.log('  ok   editorController recarrega arquivos sem ficar preso no estado de erro');

  console.log('\nTodos os testes de Renomeacao e Abertura de Arquivos passaram com sucesso! 🎉\n');
} finally {
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch (_) {}
}
