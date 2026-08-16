/**
 * scripts/test-nexa-persona-precedence.js
 * Bateria de testes de integridade da Precedência da Persona Nexa.
 */

try {
  const electronPath = require.resolve("electron");
  require.cache[electronPath] = {
    id: electronPath,
    filename: electronPath,
    loaded: true,
    exports: { app: { getPath: () => "/tmp" } }
  };
} catch (_) {}

const assert = require("assert");
const configService = require("../services/configService.js");
const { buildIdeAgentPrompt } = require("../services/idePrompt.js");
const { helpers } = require("../main/globals.js");
require("../main/helpers/aiResponse.js");
const { applyNexaPersonaIfNeeded, NEXA_SYSTEM_OVERRIDE_PROMPT } = require("../main/nexa/nexaPersona.js");

console.log("🧪 Iniciando Testes de Precedência da Persona Nexa...");

// 1. Teste Nexa = OFF (Preservação 100% da identidade antiga)
configService.setNexaConfig({ enabled: false });

const promptOff = configService.getPromptInstruction();
assert.ok(!promptOff.includes("SEU ÚNICO NOME E IDENTIDADE É NEXA"), "Nexa OFF: Não deve conter a diretiva suprema da Nexa");

const idePromptOff = buildIdeAgentPrompt({ wsPaths: ["/test"] });
assert.ok(!idePromptOff.includes("SEU ÚNICO NOME E IDENTIDADE É NEXA"), "Nexa OFF: IDE Agent Prompt não deve conter Nexa");

console.log("  ✅ Teste 1 Aprovado: Nexa OFF preserva comportamento original intacto.");

// 2. Teste Nexa = ON (Precedência da Diretiva Suprema Nexa no TOPO ABSOLUTO)
configService.setNexaConfig({ enabled: true });

const promptOn = applyNexaPersonaIfNeeded(configService.getPromptInstruction(), true);
assert.ok(promptOn.startsWith("═══ DIRETIVA DE SISTEMA E IDENTIDADE SUPREMA"), "Nexa ON: Diretiva da Nexa deve estar no TOPO ABSOLUTO");
assert.ok(promptOn.includes("SEU ÚNICO NOME E IDENTIDADE É NEXA"), "Nexa ON: Deve declarar explicitamente que o único nome é Nexa");
assert.ok(promptOn.includes("NUNCA se identifique como Antigravity, Helper Node"), "Nexa ON: Deve vetar Antigravity e Helper Node");

const idePromptOn = applyNexaPersonaIfNeeded(buildIdeAgentPrompt({ wsPaths: ["/test"] }), true);
assert.ok(idePromptOn.startsWith("═══ DIRETIVA DE SISTEMA E IDENTIDADE SUPREMA"), "Nexa ON: IDE Agent Prompt deve conter a diretiva no topo");

console.log("  ✅ Teste 2 Aprovado: Nexa ON injeta precedência no topo quando chamada para o contexto da Nexa.");

// 3. Teste de Voice Summary com Persona Nexa
const voiceInstruction = helpers.appendVoiceSummaryInstructionIfNeeded("Instrução base");
assert.ok(voiceInstruction.includes("PRIMEIRA PESSOA PELA NEXA"), "Voice Summary deve instruir resposta em primeira pessoa pela Nexa");
assert.ok(!voiceInstruction.includes("Antigravity"), "Voice Summary não deve mencionar Antigravity");

console.log("  ✅ Teste 3 Aprovado: Voice Summary configurado para a identidade Nexa.");

// 4. Teste de RAG e Memória do Usuário
const userContext = "DADOS DO USUÁRIO PERSISTIDOS: Nome do usuário = Juliano Soder";
const promptWithUser = applyNexaPersonaIfNeeded(`${userContext}\n\nPergunte o nome dele.`, true);

assert.ok(promptWithUser.includes("SEU ÚNICO NOME E IDENTIDADE É NEXA"), "Deve conter a persona da Nexa");
assert.ok(promptWithUser.includes("Juliano Soder"), "Deve manter os dados do usuário (Juliano Soder) como contexto");
assert.ok(promptWithUser.indexOf("SEU ÚNICO NOME E IDENTIDADE É NEXA") < promptWithUser.indexOf("Juliano Soder"), "Diretiva da Nexa vem antes dos dados do usuário para evitar confusão de quem é a assistente");

console.log("  ✅ Teste 4 Aprovado: Memória do usuário ('Juliano') preservada sem confundir com o nome da assistente.");

// Restaura estado para OFF para não sujar o ambiente
configService.setNexaConfig({ enabled: false });

console.log("🎉 TODOS OS TESTES DE PRECEDÊNCIA DA PERSONA NEXA FORAM APROVADOS COM SUCESSO!");
