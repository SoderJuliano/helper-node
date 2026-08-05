/**
 * scripts/test-nexa-module.js
 * Teste automatizado do módulo Nexa (Máquina de estados e integração).
 */

const assert = require("assert");
const { nexaState } = require("../main/nexa/nexaState.js");
const { registerNexaIpc } = require("../main/nexa/nexaIpc.js");
const { setupNexaIntegration } = require("../main/nexa/nexaIntegration.js");

console.log("🧪 Iniciando testes da infraestrutura da Nexa...");

// Teste 1: Estado inicial deve ser IDLE
assert.strictEqual(nexaState.getState(), "IDLE", "Estado inicial deve ser IDLE");
console.log("  ✅ Teste 1 Aprovado: Estado inicial é IDLE.");

// Teste 2: Mudança para LISTENING
let lastEmittedState = null;
nexaState.on("state-changed", ({ state }) => {
  lastEmittedState = state;
});

assert.strictEqual(nexaState.setState("LISTENING"), true, "Deve aceitar estado LISTENING");
assert.strictEqual(nexaState.getState(), "LISTENING", "Estado deve ter mudado para LISTENING");
assert.strictEqual(lastEmittedState, "LISTENING", "Evento state-changed deve ser disparado");
console.log("  ✅ Teste 2 Aprovado: Transição para LISTENING.");

// Teste 3: Mudança para THINKING
assert.strictEqual(nexaState.setState("THINKING"), true, "Deve aceitar estado THINKING");
assert.strictEqual(nexaState.getState(), "THINKING", "Estado deve ter mudado para THINKING");
assert.strictEqual(lastEmittedState, "THINKING", "Evento state-changed deve ser disparado");
console.log("  ✅ Teste 3 Aprovado: Transição para THINKING.");

// Teste 4: Mudança para SPEAKING
assert.strictEqual(nexaState.setState("SPEAKING"), true, "Deve aceitar estado SPEAKING");
assert.strictEqual(nexaState.getState(), "SPEAKING", "Estado deve ter mudado para SPEAKING");
assert.strictEqual(lastEmittedState, "SPEAKING", "Evento state-changed deve ser disparado");
console.log("  ✅ Teste 4 Aprovado: Transição para SPEAKING.");

// Teste 5: Retorno para IDLE
assert.strictEqual(nexaState.setState("IDLE"), true, "Deve aceitar retorno para IDLE");
assert.strictEqual(nexaState.getState(), "IDLE", "Estado deve ter retornado para IDLE");
assert.strictEqual(lastEmittedState, "IDLE", "Evento state-changed deve ser disparado");
console.log("  ✅ Teste 5 Aprovado: Retorno para IDLE.");

// Teste 6: Rejeição de estados inválidos
const invalidResult = nexaState.setState("INVALID_STATE");
assert.strictEqual(invalidResult, false, "Deve rejeitar estado inválido");
assert.strictEqual(nexaState.getState(), "IDLE", "Estado deve permanecer IDLE");
console.log("  ✅ Teste 6 Aprovado: Rejeição de estados inválidos.");

console.log("🎉 TODOS OS TESTES DA NEXA FORAM APROVADOS COM SUCESSO!");
