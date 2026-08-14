// scripts/test-copilot-large-object.js
// Teste de regressão para verificar que o Copilot CLI não fatias/omite prompts grandes com objetos gigantes.

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { fitPromptToCommandLine } = require('../services/providers/copilot-cli/CopilotCliProcess.js');

console.log('=== Testando Envio de Objeto Gigante para Copilot CLI sem Omissão ===\n');

const tmpDir = path.join(os.tmpdir(), 'helper-copilot-large-test-' + Date.now());
fs.mkdirSync(tmpDir, { recursive: true });

try {
  // 1. Prompt curto (< budget)
  const shortPrompt = 'Pergunta curta: qual o valor de X?';
  const resShort = fitPromptToCommandLine(shortPrompt, 'copilot', ['--allow-all'], tmpDir);
  assert.strictEqual(resShort.promptText, shortPrompt, 'Prompt curto não deve ser alterado');
  assert.strictEqual(resShort.tempFile, null, 'Prompt curto não precisa de arquivo temporário');
  console.log('  ok   prompt curto passa direto sem arquivo temporário');

  // 2. Prompt com objeto gigante (> 30,000 chars)
  const giantObject = { data: 'x'.repeat(40000), info: 'objeto extenso de teste' };
  const largePrompt = `Analise este objeto gigante:\n` + JSON.stringify(giantObject);

  const resLarge = fitPromptToCommandLine(largePrompt, 'copilot', ['--allow-all'], tmpDir);

  assert.notStrictEqual(resLarge.tempFile, null, 'Prompt grande deve gerar arquivo temporário');
  assert.strictEqual(fs.existsSync(resLarge.tempFile), true, 'Arquivo temporário deve ter sido criado no disco');

  const savedContent = fs.readFileSync(resLarge.tempFile, 'utf8');
  assert.strictEqual(savedContent, largePrompt, 'Conteúdo salvo no arquivo temporário deve ser 100% IDÊNTICO ao prompt original sem omissões');
  assert.strictEqual(savedContent.includes('[...trecho omitido'), false, 'NUNCA deve existir marcação de trecho omitido no conteúdo salvo');
  assert.strictEqual(resLarge.promptText.includes(path.basename(resLarge.tempFile)), true, 'Instrução do prompt deve referenciar o arquivo temporário criado');

  // Limpeza
  fs.unlinkSync(resLarge.tempFile);
  console.log('  ok   objeto gigante (40k+ chars) salvo 100% integralmente em arquivo sem nenhuma omissão ou fatiamento');

} catch (err) {
  console.error('  FALHA:', err.message);
  process.exit(1);
} finally {
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
  console.log('\ntudo ok.');
}
