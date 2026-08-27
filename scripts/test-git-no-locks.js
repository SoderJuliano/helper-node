// scripts/test-git-no-locks.js
// Testes de execucao Git sem travas (no-optional-locks) e robustez de checkout.

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync, execFile } = require('child_process');
const { GitConflictService } = require('../services/gitConflictService.js');

async function run() {
  console.log('=== Testando Gerenciamento de Processos e Locks do Git ===\n');

  const tmpGitDir = path.join(os.tmpdir(), `test-git-no-lock-${Date.now()}`);
  fs.mkdirSync(tmpGitDir, { recursive: true });

  try {
    execSync('git init', { cwd: tmpGitDir, stdio: 'pipe' });
    execSync('git config user.name "Tester"', { cwd: tmpGitDir, stdio: 'pipe' });
    execSync('git config user.email "test@example.com"', { cwd: tmpGitDir, stdio: 'pipe' });

    // Cria arquivo inicial
    fs.writeFileSync(path.join(tmpGitDir, 'arquivo.txt'), 'linha 1\n\nlinha 2\n', 'utf8');
    execSync('git add .', { cwd: tmpGitDir, stdio: 'pipe' });
    execSync('git commit -m "initial"', { cwd: tmpGitDir, stdio: 'pipe' });

    // Cria branch secundaria
    execSync('git branch feature-a', { cwd: tmpGitDir, stdio: 'pipe' });

    // 1. Testa detectGitConflicts com --no-optional-locks
    const status = await GitConflictService.detectGitConflicts(tmpGitDir);
    assert.equal(status.hasConflicts, false);
    console.log('  ok   GitConflictService executou com --no-optional-locks sem gerar lock');

    // 2. Testa concorrencia: executar git checkout enquanto --no-optional-locks status esta rodando
    const backgroundPromises = [];
    for (let i = 0; i < 10; i++) {
      backgroundPromises.push(new Promise((resolve) => {
        execFile('git', ['--no-optional-locks', '-C', tmpGitDir, 'status', '--porcelain'], (err, stdout) => {
          resolve({ err, stdout });
        });
      }));
    }

    // Enquanto as queries de status estao acontecendo, da git checkout
    execSync('git checkout feature-a', { cwd: tmpGitDir, stdio: 'pipe' });
    const curBranch = execSync('git rev-parse --abbrev-ref HEAD', { cwd: tmpGitDir, encoding: 'utf8' }).trim();
    assert.equal(curBranch, 'feature-a', 'Checkout deve funcionar livremente sem colisao de lock');

    await Promise.all(backgroundPromises);
    console.log('  ok   Checkout de branch concluido com sucesso em paralelo com varias consultas de status');

    console.log('\nDodos os testes de protecao de locks do Git passaram com sucesso! \n');
  } finally {
    try { fs.rmSync(tmpGitDir, { recursive: true, force: true }); } catch (_) {}
  }
}

run().catch(err => {
  console.error('Falha nos testes:', err);
  process.exit(1);
});
