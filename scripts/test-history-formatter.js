// scripts/test-history-formatter.js
// Teste de validação para o formatador de histórico e prevenção de contaminação de contexto.

const assert = require('assert');
const {
  buildPromptWithHistory,
  cleanMessageContent,
  extractCurrentInstruction,
  MAX_HISTORY_MESSAGES
} = require('../services/historyFormatter');
const { fitPromptToCommandLine } = require('../services/providers/copilot-cli/CopilotCliProcess');
const path = require('path');
const os = require('os');
const fs = require('fs');

console.log('=== Testando Formatador de Histórico e Anti-Contaminação de Contexto ===\n');

try {
  // 1. Prompt sem histórico
  const p1 = buildPromptWithHistory('Pergunta simples', []);
  assert.strictEqual(p1, 'Pergunta simples');
  console.log('  ok   prompt sem histórico retorna pergunta original');

  // 2. Limpeza de artefatos e diretivas
  const dirty = '═══ DIRETIVA DE SISTEMA: bla bla ═════════════════════════════════════════════════════════════\n{"response": "Resposta limpa da IA"}\n<voice_summary>Resumo falado</voice_summary>';
  const cleaned = cleanMessageContent(dirty);
  assert.strictEqual(cleaned, 'Resposta limpa da IA');
  console.log('  ok   limpeza de diretivas de sistema, JSON envelopes e tags TTS funciona');

  // 3. Formatação com histórico contendo comandos antigos perigosos ("continue de onde parou")
  const pastMsgs = [
    { role: 'user', content: 'continue de onde parou e complete a tarefa anterior' },
    { role: 'assistant', content: 'A' .repeat(3000) }, // Resposta longa
    { role: 'user', content: 'crie a feature do toast de usos' },
    { role: 'assistant', content: 'Feature criada com sucesso!' }
  ];

  const currentQ = 'notei que o copilot cli tem um problema de sequencia';
  const formattedPrompt = buildPromptWithHistory(currentQ, pastMsgs);

  // Validações no prompt formatado
  assert.strictEqual(formattedPrompt.includes('[Histórico - Pergunta Passada do Usuário]'), true);
  assert.strictEqual(formattedPrompt.includes('[Histórico - Resposta Passada da IA]'), true);
  assert.strictEqual(formattedPrompt.includes('continue de onde parou'), true);
  assert.strictEqual(formattedPrompt.includes('⛔ DIRETIVA MANDATÓRIA PARA A IA:'), true);
  assert.strictEqual(formattedPrompt.includes('🎯 INSTRUÇÃO ATUAL DO USUÁRIO (EXECUTE ESTA):'), true);
  assert.strictEqual(formattedPrompt.includes(currentQ), true);

  // A resposta longa da IA de 3000 caracteres deve ter sido truncada
  assert.strictEqual(formattedPrompt.includes('... [trecho longo anterior omitido para economizar contexto]'), true);
  console.log('  ok   histórico formatado com tags anti-contaminação, truncamento e destaque da instrução atual');

  // 4. Extração da instrução atual
  const extracted = extractCurrentInstruction(formattedPrompt);
  assert.strictEqual(extracted, currentQ);
  console.log('  ok   extração da instrução atual a partir do prompt formatado');

  // 5. Integração com CopilotCliProcess fitPromptToCommandLine
  const tmpDir = path.join(os.tmpdir(), 'history-copilot-test-' + Date.now());
  fs.mkdirSync(tmpDir, { recursive: true });

  const giantPrompt = formattedPrompt + '\n' + 'x'.repeat(40000);
  const res = fitPromptToCommandLine(giantPrompt, 'copilot', ['--allow-all'], tmpDir);

  assert.notStrictEqual(res.tempFile, null);
  assert.strictEqual(res.promptText.includes('INSTRUÇÃO ATUAL DO USUÁRIO QUE VOCÊ DEVE EXECUTAR/RESPONDER'), true);
  assert.strictEqual(res.promptText.includes(currentQ), true);
  assert.strictEqual(res.promptText.includes(path.basename(res.tempFile)), true);

  // Limpeza
  if (res.tempFile && fs.existsSync(res.tempFile)) fs.unlinkSync(res.tempFile);
  fs.rmSync(tmpDir, { recursive: true, force: true });
  console.log('  ok   fitPromptToCommandLine exibe preview da instrução atual no parâmetro -p');

  console.log('\nTodos os testes de formatação de histórico passaram com sucesso! 🎉');
} catch (err) {
  console.error('  FALHA:', err);
  process.exit(1);
}
