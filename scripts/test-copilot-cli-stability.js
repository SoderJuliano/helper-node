// scripts/test-copilot-cli-stability.js
const assert = require('assert');
const path = require('path');
const fs = require('fs');
const os = require('os');
const {
  CopilotCliProcess,
  getEnrichedEnv,
  fitPromptToCommandLine,
  ALLOW_ALL_FLAG,
  NO_ASK_FLAG,
} = require('../services/providers/copilot-cli/CopilotCliProcess');
const CopilotCliProvider = require('../services/providers/copilot-cli/CopilotCliProvider');

console.log('=== Testando Estabilidade e Recursos do Copilot CLI (GPT-5.6 Terra / Large Context) ===\n');

// 1. Testa variáveis de ambiente enriquecidas com memória heap de 8GB
const env = getEnrichedEnv();
assert(env.NODE_OPTIONS && env.NODE_OPTIONS.includes('--max-old-space-size=8192'), 'NODE_OPTIONS deve conter 8GB de heap (--max-old-space-size=8192)');
assert.strictEqual(env.FORCE_COLOR, '0', 'FORCE_COLOR deve ser 0');
assert.strictEqual(env.NO_COLOR, '1', 'NO_COLOR deve ser 1');
assert.strictEqual(env.CI, '1', 'CI deve ser 1');
console.log('  ok   Variaveis de ambiente configuradas com 8GB de heap e flags anti-bloqueio TTY');

// 2. Testa flags padrão do CopilotCliProcess
assert.strictEqual(ALLOW_ALL_FLAG, '--allow-all', 'ALLOW_ALL_FLAG deve ser --allow-all');
assert.strictEqual(NO_ASK_FLAG, '--no-ask-user', 'NO_ASK_FLAG deve ser --no-ask-user');
console.log('  ok   Flags de permissao total (--allow-all, --no-ask-user) validas');

// 3. Testa fitPromptToCommandLine com prompt gigante (acima de 30k chars)
const tmpDir = path.join(os.tmpdir(), 'helper-copilot-test-' + Date.now());
fs.mkdirSync(tmpDir, { recursive: true });

try {
  const bigPrompt = '🎯 INSTRUÇÃO ATUAL DO USUÁRIO (EXECUTE ESTA):\nCorrija os testes de integração do módulo UserService\n═══════════════════════════════════════════════════════════════\n' + 'A'.repeat(40000);
  const fitResult = fitPromptToCommandLine(bigPrompt, 'copilot', ['-p', '--allow-all'], tmpDir);

  assert(fitResult.tempFile, 'Deve ter criado arquivo temporario para prompt grande');
  assert(fs.existsSync(fitResult.tempFile), 'Arquivo temporario deve existir no disco');
  assert(fitResult.promptText.includes('Corrija os testes de integração do módulo UserService'), 'Prompt deve conter a instrucao atual do usuario');
  assert(fitResult.promptText.length < 2000, 'Tamanho do comando de linha de comando deve estar reduzido e seguro');

  // Limpa arquivo temporario de teste
  fs.unlinkSync(fitResult.tempFile);
  console.log('  ok   fitPromptToCommandLine salvou prompt gigante de forma integra sem estourar limite do SO');

  // 4. Testa Provider com mock sender e controle de esforço de raciocínio (Reasoning Effort)
  let phaseUpdates = [];
  let chunks = [];
  let completeEmitted = false;
  const mockSender = {
    send: (ch, payload) => {
      if (ch === 'agentic-phase-update') phaseUpdates.push(payload);
      if (ch === 'gemini-stream-chunk') chunks.push(payload);
      if (ch === 'gemini-stream-complete') completeEmitted = true;
    }
  };

  assert(typeof CopilotCliProvider.send === 'function', 'CopilotCliProvider deve exportar send()');
  assert(typeof CopilotCliProvider.abortCurrent === 'function', 'CopilotCliProvider deve exportar abortCurrent()');
  assert(typeof CopilotCliProvider.shutdown === 'function', 'CopilotCliProvider deve exportar shutdown()');
  assert(typeof CopilotCliProvider.setEffort === 'function', 'CopilotCliProvider deve exportar setEffort()');
  assert(typeof CopilotCliProvider.getEffort === 'function', 'CopilotCliProvider deve exportar getEffort()');

  CopilotCliProvider.setEffort('high');
  assert.strictEqual(CopilotCliProvider.getEffort(), 'high', 'getEffort deve retornar "high"');
  CopilotCliProvider.setEffort('low');
  assert.strictEqual(CopilotCliProvider.getEffort(), 'low', 'getEffort deve retornar "low"');
  console.log('  ok   CopilotCliProvider exporta metodos publicos e controle de Reasoning Effort (Low/Medium/High)');

  // 5. Testa formatação de rótulos e catálogo de modelos Copilot
  const { formatCopilotLabel, getModels } = require('../services/providers/copilot-cli/CopilotCliModels');
  assert.strictEqual(formatCopilotLabel('claude-opus-5'), 'Claude Opus 5');
  assert.strictEqual(formatCopilotLabel('claude-sonnet-5'), 'Claude Sonnet 5');
  assert.strictEqual(formatCopilotLabel('gpt-5.6-terra'), 'GPT-5.6 Terra');
  assert.strictEqual(formatCopilotLabel('gpt-5.6-sol'), 'GPT-5.6 Sol');
  assert.strictEqual(formatCopilotLabel('gpt-5.6-luna'), 'GPT-5.6 Luna');
  assert.strictEqual(formatCopilotLabel('kimi-k3'), 'Kimi K3');
  assert.strictEqual(formatCopilotLabel('grok-4.6'), 'Grok 4.6');
  assert.strictEqual(formatCopilotLabel('mai-code-1-flash-picker'), 'MAI-Code-1.1-Flash');
  console.log('  ok   formatCopilotLabel formata corretamente todos os modelos corporativos');

  const configService = require('../services/configService');
  assert(typeof configService.getCopilotCliReasoningEffort === 'function', 'configService deve ter getCopilotCliReasoningEffort');
  assert(typeof configService.setCopilotCliReasoningEffort === 'function', 'configService deve ter setCopilotCliReasoningEffort');
  console.log('  ok   configService possui getters e setters de copilotCliReasoningEffort');

  console.log('\nTodos os testes de Estabilidade e Recursos do Copilot CLI passaram com sucesso! 🎉\n');
} finally {
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch (_) {}
}
