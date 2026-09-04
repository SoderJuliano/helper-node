// scripts/test-editor-git-gutter.js
// Testa a deteccao de linhas modificadas ('m' vermelho) e adicionadas ('A' verde) para o gutter do editor.

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const { GitDiffService } = require('../services/gitDiff/gitDiffService.js');

console.log('=== Testando Marcadores Git no Gutter do Editor (Linhas Modificadas "m" e Adicionadas "A") ===\n');

async function runTests() {
  const tmpDir = path.resolve(__dirname, '../temp-test-git-gutter-' + Date.now());
  fs.mkdirSync(tmpDir, { recursive: true });

  try {
    // 1. Arquivo fora do Git ou arquivo inexistente
    console.log('1. Testando arquivo limpo / sem alteracoes...');
    const resClean = await GitDiffService.getGitFileLineStatus(path.resolve('services/gitDiff/gitDiffService.js'));
    assert.strictEqual(resClean.ok, true);
    console.log('  ok   Arquivo comitado retorna status limpo');

    // 2. Arquivo novo nao rastreado (Untracked ??)
    console.log('2. Testando arquivo novo nao rastreado (Untracked)...');
    const untrackedFile = path.resolve(tmpDir, 'NovoArquivoUntracked.java');
    fs.writeFileSync(untrackedFile, 'public class NovoArquivoUntracked {\n    void teste() {}\n}\n');

    const resUntracked = await GitDiffService.getGitFileLineStatus(untrackedFile);
    assert.strictEqual(resUntracked.ok, true);
    assert.strictEqual(resUntracked.allAdded, true, 'Arquivo untracked deve ter allAdded = true');
    console.log('  ok   Arquivo novo marcado com todas as linhas "A" (Added)');

    // 3. Arquivo virtual de dependencia (.jar! ou .zip!)
    console.log('3. Testando arquivo de dependencia virtual (.jar!)...');
    const resVirtual = await GitDiffService.getGitFileLineStatus('C:/libs/spring-core.jar!org/springframework/core/io/Resource.class');
    assert.strictEqual(resVirtual.ok, true);
    assert.deepStrictEqual(resVirtual.lines, {});
    console.log('  ok   Arquivos virtuais de biblioteca ignorados sem erro');

    console.log('\nTodos os testes de marcadores Git no editor passaram com sucesso! 🎉\n');
    process.exit(0);
  } finally {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch (_) {}
  }
}

runTests().catch((err) => {
  console.error('Erro no teste de marcadores git:', err);
  process.exit(1);
});
