// scripts/test-git-conflict.js
// Testes automatizados para o Git Conflict Resolver (3-Way Merge)

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const {
  GitConflictService,
  align3Way,
  parseConflictMarkers,
  computeLcs
} = require('../services/gitConflictService.js');

async function runTests() {
  console.log('=== Testando Git Conflict Resolver (3-Way Merge) ===\n');

  // 1. Testes Unitários de Algoritmo LCS e 3-Way Alignment
  console.log('1. Testando Algoritmo LCS e Alinhamento 3-Way...');

  const baseCode = [
    'public class Calculator {',
    '    public int add(int a, int b) {',
    '        return a + b;',
    '    }',
    '    public int subtract(int a, int b) {',
    '        return a - b;',
    '    }',
    '}'
  ];

  const oursCode = [
    'public class Calculator {',
    '    // Alteração Local: método add otimizado',
    '    public int add(int a, int b) {',
    '        return Math.addExact(a, b);',
    '    }',
    '    public int subtract(int a, int b) {',
    '        return a - b;',
    '    }',
    '}'
  ];

  const theirsCode = [
    'public class Calculator {',
    '    public int add(int a, int b) {',
    '        return a + b; // Comentário da incoming',
    '    }',
    '    public int subtract(int a, int b) {',
    '        // Alteração Incoming: subtract seguro',
    '        return Math.subtractExact(a, b);',
    '    }',
    '}'
  ];

  const chunks = align3Way(baseCode, oursCode, theirsCode);
  assert.ok(chunks.length > 0, 'Deve gerar chunks de alinhamento');

  // Verifica chunks
  const conflictChunks = chunks.filter(c => c.type === 'CONFLICT');
  const rightOnlyChunks = chunks.filter(c => c.type === 'RIGHT_ONLY');

  assert.strictEqual(conflictChunks.length, 1, 'Deve detectar exatamente 1 conflito no método add');
  assert.strictEqual(rightOnlyChunks.length, 1, 'Deve detectar alteração não conflitante no método subtract (Right Only)');
  console.log('  ok   LCS e align3Way detectaram conflitos e alterações unilaterais com precisão');

  // 2. Teste do Fallback com Marcadores de Conflito
  console.log('2. Testando Fallback de Marcadores Git (<<<<<<<, =======, >>>>>>>)...');
  const conflictMarkerText = `public class App {
<<<<<<< HEAD
    public void run() { System.out.println("Hello from Local"); }
=======
    public void run() { System.out.println("Hello from Remote"); }
>>>>>>> origin/main
}`;

  const parsedChunks = parseConflictMarkers(conflictMarkerText);
  assert.strictEqual(parsedChunks.length, 3, 'Deve gerar 3 chunks (equal, conflict, equal)');
  assert.strictEqual(parsedChunks[1].type, 'CONFLICT');
  assert.strictEqual(parsedChunks[1].leftLines[0].trim(), 'public void run() { System.out.println("Hello from Local"); }');
  assert.strictEqual(parsedChunks[1].rightLines[0].trim(), 'public void run() { System.out.println("Hello from Remote"); }');
  console.log('  ok   Parser de marcadores de conflito extraiu blocos corretamente');

  // 3. Teste em Repositório Git Real (Mock)
  console.log('3. Testando ciclo completo em repositório Git com conflito real...');
  const testGitDir = path.join(__dirname, 'mock_conflict_git_repo');
  if (fs.existsSync(testGitDir)) fs.rmSync(testGitDir, { recursive: true, force: true });
  fs.mkdirSync(testGitDir, { recursive: true });

  try {
    // Inicializa repo git
    execSync('git init', { cwd: testGitDir, stdio: 'pipe' });
    execSync('git config user.name "Test User"', { cwd: testGitDir, stdio: 'pipe' });
    execSync('git config user.email "test@example.com"', { cwd: testGitDir, stdio: 'pipe' });

    // Cria arquivo inicial
    const testFile = 'UserService.java';
    fs.writeFileSync(path.join(testGitDir, testFile), baseCode.join('\n'));
    execSync(`git add ${testFile}`, { cwd: testGitDir, stdio: 'pipe' });
    execSync('git commit -m "commit inicial"', { cwd: testGitDir, stdio: 'pipe' });

    // Cria branch feature e altera arquivo
    execSync('git checkout -b feature-incoming', { cwd: testGitDir, stdio: 'pipe' });
    fs.writeFileSync(path.join(testGitDir, testFile), theirsCode.join('\n'));
    execSync(`git commit -am "alteracao incoming"`, { cwd: testGitDir, stdio: 'pipe' });

    // Volta pra branch inicial e faz alteração conflitante
    execSync('git checkout -', { cwd: testGitDir, stdio: 'pipe' });
    fs.writeFileSync(path.join(testGitDir, testFile), oursCode.join('\n'));
    execSync(`git commit -am "alteracao local"`, { cwd: testGitDir, stdio: 'pipe' });

    // Executa merge gerando conflito
    try {
      execSync('git merge feature-incoming', { cwd: testGitDir, stdio: 'pipe' });
    } catch (_) {
      // Esperado gerar conflito
    }

    // Testa detecção de conflitos
    const status = await GitConflictService.detectGitConflicts(testGitDir);
    assert.strictEqual(status.hasConflicts, true, 'Deve identificar que o repo está em estado de conflito');
    assert.strictEqual(status.count, 1, 'Deve identificar 1 arquivo em conflito');
    assert.strictEqual(status.conflictFiles[0].path, 'UserService.java');
    assert.strictEqual(status.mergeState, 'merge');
    console.log('  ok   detectGitConflicts detectou estado de merge e arquivo UserService.java em conflito');

    // Testa getFile3WayData
    const file3Way = await GitConflictService.getFile3WayData(testGitDir, 'UserService.java');
    assert.strictEqual(file3Way.ok, true);
    assert.strictEqual(file3Way.totalConflicts, 1);
    assert.ok(file3Way.baseText.length > 0, 'Deve conter texto da Base');
    assert.ok(file3Way.oursText.length > 0, 'Deve conter texto de Ours');
    assert.ok(file3Way.theirsText.length > 0, 'Deve conter texto de Theirs');
    console.log('  ok   getFile3WayData extraiu com sucesso Base, Ours e Theirs a partir do índice Git');

    // Testa resolução e salvamento
    const resolvedContent = `public class Calculator {
    // Resolução: método add local e subtract incoming
    public int add(int a, int b) {
        return Math.addExact(a, b);
    }
    public int subtract(int a, int b) {
        return Math.subtractExact(a, b);
    }
}`;

    const saveRes = await GitConflictService.saveResolvedFile(testGitDir, 'UserService.java', resolvedContent);
    assert.strictEqual(saveRes.ok, true, 'Salvar resolução deve retornar sucesso');
    assert.strictEqual(saveRes.remainingConflicts, 0, 'Conflitos restantes devem ser 0 após git add');
    console.log('  ok   saveResolvedFile gravou resolução no disco e executou git add com sucesso');

    // Conclui merge
    execSync('git commit -m "merge resolvido"', { cwd: testGitDir, stdio: 'pipe' });
    const postMergeStatus = await GitConflictService.detectGitConflicts(testGitDir);
    assert.strictEqual(postMergeStatus.hasConflicts, false);
    console.log('  ok   Merge concluído com sucesso e status do repositório voltou a clean');

  } finally {
    fs.rmSync(testGitDir, { recursive: true, force: true });
  }

  console.log('\nTodos os testes do Git Conflict Resolver passaram com sucesso! 🎉\n');
}

runTests().catch((e) => {
  console.error('Falha nos testes do Git Conflict Resolver:', e);
  process.exit(1);
});
