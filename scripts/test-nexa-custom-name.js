/**
 * scripts/test-nexa-custom-name.js
 * Teste unitário e de integração para validação da funcionalidade de Nome Customizado do Copiloto/Assistente Nexa.
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
const { helpers } = require("../main/globals.js");
require("../main/helpers/aiResponse.js");
const { applyNexaPersonaIfNeeded } = require("../main/nexa/nexaPersona.js");
const NexaIntentClassifier = require("../services/nexaVoiceAssistant/nexaIntentClassifier.js");

console.log("🧪 Iniciando testes de Nome Customizado da Nexa...");

// 1. Padrão inicial deve ser "Nexa"
configService.setNexaConfig({ name: "Nexa", enabled: true });
let cfg = configService.getNexaConfig();
assert.strictEqual(cfg.name, "Nexa", "O nome padrão deve ser 'Nexa'");
console.log("  ✅ Teste 1: Nome padrão é 'Nexa'");

// 2. Persona com nome padrão "Nexa"
let prompt = applyNexaPersonaIfNeeded("Pergunta de teste", true);
assert.ok(prompt.includes("SEU ÚNICO NOME E IDENTIDADE É NEXA"), "Prompt deve conter 'SEU ÚNICO NOME E IDENTIDADE É NEXA'");
assert.ok(prompt.includes("Você É a Nexa"), "Prompt deve conter 'Você É a Nexa'");
console.log("  ✅ Teste 2: Persona com nome padrão 'Nexa'");

// 3. Alteração para "Rafael"
configService.setNexaConfig({ name: "Rafael", enabled: true });
cfg = configService.getNexaConfig();
assert.strictEqual(cfg.name, "Rafael", "O nome configurado deve ser 'Rafael'");
console.log("  ✅ Teste 3: Nome atualizado para 'Rafael'");

// 4. Prompt gerado deve refletir "Rafael"
prompt = applyNexaPersonaIfNeeded("Pergunta de teste", true);
assert.ok(prompt.includes("SEU ÚNICO NOME E IDENTIDADE É RAFAEL"), "Prompt deve conter 'SEU ÚNICO NOME E IDENTIDADE É RAFAEL'");
assert.ok(prompt.includes("Você É a Rafael"), "Prompt deve conter 'Você É a Rafael'");
assert.ok(prompt.includes("responda que você é a Rafael"), "Prompt deve orientar responder como Rafael");
assert.ok(prompt.includes("tanto pelo seu nome ativo (Rafael) quanto pelo seu nome original"), "Prompt deve aceitar ambos os nomes");
console.log("  ✅ Teste 4: Prompt reflete a persona 'Rafael'");

// 5. Intent Classifier com Wake Word "Rafael"
const classification = NexaIntentClassifier.classify("Rafael, como crio um controller no Spring Boot?", { assistantName: "Rafael" });
assert.strictEqual(classification.action, "RESPOND_AUDIO_AND_CHAT", "Deve reconhecer o comando direcionado a Rafael");
assert.strictEqual(classification.cleanedQuery, "como crio um controller no Spring Boot?", "Deve limpar o vocativo 'Rafael,'");
console.log("  ✅ Teste 5: Intent Classifier aciona com wake word 'Rafael' e limpa vocativo");

// 6. Voice summary instruction reflete o novo nome
const voiceInstruction = helpers.appendVoiceSummaryInstructionIfNeeded("Instrução base");
assert.ok(voiceInstruction.includes("PERSONA RAFAEL"), "Voice summary deve ter cabeçalho da PERSONA RAFAEL");
console.log("  ✅ Teste 6: Persona header reflete 'RAFAEL'");

// 7. Reset do nome para vazio deve restaurar fallback "Nexa"
configService.setNexaConfig({ name: "   ", enabled: true });
cfg = configService.getNexaConfig();
assert.strictEqual(cfg.name, "Nexa", "Nome em branco deve cair de volta para o fallback 'Nexa'");
console.log("  ✅ Teste 7: Fallback para 'Nexa' ao passar string em branco");

// 8. Background Story com nome dinâmico
const { getBackgroundStory } = require("../main/nexa/nexaBackground.js");
const story = getBackgroundStory("Rafael");
assert.ok(story.includes("Rafael é uma assistente e copiloto digital"), "História de fundo deve conter 'Rafael é uma assistente'");
console.log("  ✅ Teste 8: História de fundo (background story) reflete 'Rafael'");

// 9. Detecção de apresentação em 3ª pessoa com nome customizado
const presClassification = NexaIntentClassifier.classify("Pessoal, esse aqui é o Rafael, meu copiloto", { assistantName: "Rafael" });
assert.strictEqual(presClassification.action, "REACT_ANIMATION_ONLY", "Deve reagir com animação à apresentação em 3ª pessoa de Rafael");
assert.strictEqual(presClassification.animation, "wave", "Deve acenar na apresentação");
console.log("  ✅ Teste 9: Apresentação em 3ª pessoa detecta 'Rafael' e reage com 'wave'");

// 10. Barge-in / Comando de parada com nome customizado
const stopClassification = NexaIntentClassifier.classify("Para Rafael!", { assistantName: "Rafael" });
assert.strictEqual(stopClassification.action, "STOP_AND_LISTEN", "Deve interromper áudio com comando de parada direcionado a Rafael");
console.log("  ✅ Teste 10: Barge-in / Comando de parada aciona com 'Para Rafael'");

// Restaura estado limpo
configService.setNexaConfig({ name: "Nexa", enabled: false });

console.log("🎉 TODOS OS TESTES DE NOME CUSTOMIZADO FORAM APROVADOS COM SUCESSO!");
