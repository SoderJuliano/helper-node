/**
 * scripts/test-nexa-mic-close-lifecycle.js
 * Validação do ciclo de vida do microfone e fechamento automático da janela da Nexa
 * quando a opção da Nexa estiver desabilitada no sistema.
 */

const assert = require("assert");

console.log("=== Testando Ciclo de Vida do Microfone e Janela da Nexa ===\n");

// Mocking Electron globals & configService
let nexaWindowOpen = false;
let closeNexaWindowCalled = false;
let createNexaWindowCalled = false;
let currentNexaConfig = { enabled: false, onlyNexa: false };

const mockConfigService = {
  getNexaConfig: () => currentNexaConfig,
  setNexaConfig: (cfg) => { currentNexaConfig = { ...currentNexaConfig, ...cfg }; },
  getMicDevice: () => "default"
};

const mockNexaWindow = {
  createNexaWindow: () => {
    nexaWindowOpen = true;
    createNexaWindowCalled = true;
  },
  closeNexaWindow: () => {
    nexaWindowOpen = false;
    closeNexaWindowCalled = true;
  },
  isNexaWindowOpen: () => nexaWindowOpen
};

// Simulação da lógica implementada no services/nexaVoiceAssistant/index.js
async function simulateVoiceToggle(session, forcedState) {
  const shouldBeActive = typeof forcedState === "boolean" ? forcedState : !session.isActive();
  if (shouldBeActive) {
    if (!mockNexaWindow.isNexaWindowOpen()) {
      mockNexaWindow.createNexaWindow();
    }
    await session.start();
  } else {
    session.stop();
    const nexaCfg = mockConfigService.getNexaConfig();
    if (!nexaCfg || !nexaCfg.enabled) {
      mockNexaWindow.closeNexaWindow();
    }
  }
  return { active: session.isActive() };
}

// Mock de sessão simples
class MockSession {
  constructor() {
    this.active = false;
  }
  async start() { this.active = true; }
  stop() { this.active = false; }
  isActive() { return this.active; }
}

async function runTests() {
  const session = new MockSession();

  // Caso 1: Nexa DESABILITADA (enabled = false)
  currentNexaConfig = { enabled: false };
  nexaWindowOpen = false;
  closeNexaWindowCalled = false;
  createNexaWindowCalled = false;

  // Usuário abre o microfone
  await simulateVoiceToggle(session);
  assert.strictEqual(session.isActive(), true, "Sessão de voz deve estar ativa");
  assert.strictEqual(nexaWindowOpen, true, "Janela da Nexa deve abrir para servir como feedback do microfone");

  // Usuário fecha o microfone
  closeNexaWindowCalled = false;
  await simulateVoiceToggle(session);
  assert.strictEqual(session.isActive(), false, "Sessão de voz deve estar inativa");
  assert.strictEqual(nexaWindowOpen, false, "Janela da Nexa DEVE fechar porque Nexa está desabilitada");
  assert.strictEqual(closeNexaWindowCalled, true, "closeNexaWindow deve ter sido chamado");
  console.log("  [OK] Cenário 1: Quando Nexa está desabilitada, fechar o microfone fecha o avatar com sucesso.");

  // Caso 2: Nexa HABILITADA (enabled = true)
  currentNexaConfig = { enabled: true };
  nexaWindowOpen = true;
  closeNexaWindowCalled = false;

  // Usuário abre o microfone
  await simulateVoiceToggle(session, true);
  assert.strictEqual(session.isActive(), true);

  // Usuário fecha o microfone
  closeNexaWindowCalled = false;
  await simulateVoiceToggle(session, false);
  assert.strictEqual(session.isActive(), false, "Sessão de voz inativa");
  assert.strictEqual(nexaWindowOpen, true, "Janela da Nexa DEVE continuar aberta pois Nexa está habilitada nas configurações");
  assert.strictEqual(closeNexaWindowCalled, false, "closeNexaWindow NÃO deve ser chamado");
  console.log("  [OK] Cenário 2: Quando Nexa está habilitada permanentemente, fechar o microfone mantém o avatar ativo.");

  console.log("\n🎉 TESTES DE CICLO DE VIDA DO MICROFONE PASSARAM COM SUCESSO! 🎙️✨");
}

runTests().catch((err) => {
  console.error("Falha no teste:", err);
  process.exit(1);
});
