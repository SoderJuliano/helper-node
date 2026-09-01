// scripts/test-git-diff-viewer.js
// Teste unitário e de integração para o Visualizador de Diff (GitDiffService e gitDiffAligner).

const assert = require('assert');
const path = require('path');
const { computeLcs, alignDiff } = require('../services/gitDiff/gitDiffAligner');
const { GitDiffService } = require('../services/gitDiff/gitDiffService');

async function runTests() {
  console.log('--- Iniciando Testes do Visualizador de Alterações (Diff) ---');

  // 1. Teste de LCS
  console.log('[1/4] Testando computeLcs...');
  const a = ['linha 1', 'linha 2', 'linha 3'];
  const b = ['linha 1', 'linha 2 MODIFICADA', 'linha 3'];
  const lcs = computeLcs(a, b);
  assert.strictEqual(lcs.aToB.get(0), 0, 'Linha 1 deve casar com Linha 1');
  assert.strictEqual(lcs.aToB.get(2), 2, 'Linha 3 deve casar com Linha 3');
  assert.strictEqual(lcs.aToB.has(1), false, 'Linha 2 original não deve casar');
  console.log('✓ computeLcs passou!');

  // 2. Teste de alignDiff em múltiplos cenários
  console.log('[2/4] Testando alignDiff...');

  // 2.1 Modificação
  const diffMod = alignDiff("console.log('antes');\nconst x = 10;", "console.log('depois');\nconst x = 10;");
  assert.strictEqual(diffMod.additions, 1, 'Deve ter 1 adição');
  assert.strictEqual(diffMod.deletions, 1, 'Deve ter 1 remoção');
  assert.strictEqual(diffMod.rows.length, 2, 'Deve ter 2 linhas alinhadas');
  assert.strictEqual(diffMod.rows[0].left.type, 'delete');
  assert.strictEqual(diffMod.rows[0].right.type, 'insert');
  assert.strictEqual(diffMod.rows[1].left.type, 'equal');

  // 2.2 Arquivo novo (Adição)
  const diffAdd = alignDiff("", "linha 1\nlinha 2\nlinha 3");
  assert.strictEqual(diffAdd.additions, 3);
  assert.strictEqual(diffAdd.deletions, 0);
  assert.strictEqual(diffAdd.rows[0].left.type, 'empty');
  assert.strictEqual(diffAdd.rows[0].right.type, 'insert');

  // 2.3 Arquivo deletado (Remoção)
  const diffDel = alignDiff("linha 1\nlinha 2", "");
  assert.strictEqual(diffDel.additions, 0);
  assert.strictEqual(diffDel.deletions, 2);
  assert.strictEqual(diffDel.rows[0].left.type, 'delete');
  assert.strictEqual(diffDel.rows[0].right.type, 'empty');

  // 2.4 Arquivo idêntico
  const diffEq = alignDiff("linha 1\nlinha 2", "linha 1\nlinha 2");
  assert.strictEqual(diffEq.additions, 0);
  assert.strictEqual(diffEq.deletions, 0);
  assert.strictEqual(diffEq.rows.every(r => r.left.type === 'equal' && r.right.type === 'equal'), true);
  console.log('✓ alignDiff passou em todos os cenários!');

  // 3. Teste de integração do GitDiffService no repositório atual
  console.log('[3/4] Testando GitDiffService.getDiffSummary...');
  const rootDir = path.resolve(__dirname, '..');
  const summary = await GitDiffService.getDiffSummary(rootDir);
  assert.strictEqual(summary.ok, true, 'getDiffSummary deve responder ok: true');
  assert.ok(summary.data, 'Deve conter data');
  assert.ok(typeof summary.data.currentBranch === 'string', 'Deve conter currentBranch');
  assert.ok(Array.isArray(summary.data.files), 'files deve ser um array');
  console.log(`✓ getDiffSummary detectou ${summary.data.files.length} arquivo(s) alterados na branch '${summary.data.currentBranch}'.`);

  // 4. Teste de getFileDiff
  console.log('[4/4] Testando GitDiffService.getFileDiff...');
  if (summary.data.files.length > 0) {
    const firstFile = summary.data.files[0];
    const fileDiff = await GitDiffService.getFileDiff(rootDir, firstFile.relPath, summary.data.baseRef);
    assert.strictEqual(fileDiff.ok, true, 'getFileDiff deve responder ok: true');
    assert.ok(fileDiff.data.rows, 'Deve conter rows alinhadas');
    console.log(`✓ getFileDiff funcionou para '${firstFile.relPath}': +${fileDiff.data.additions} -${fileDiff.data.deletions} linhas.`);
  }

  console.log('\n=============================================');
  console.log('✅ TODOS OS TESTES DO DIFF VIEWER PASSARAM!');
  console.log('=============================================');
}

runTests().catch((err) => {
  console.error('❌ Falha nos testes do Diff Viewer:', err);
  process.exit(1);
});
