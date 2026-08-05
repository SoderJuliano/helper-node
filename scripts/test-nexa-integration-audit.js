/**
 * scripts/test-nexa-integration-audit.js
 * Teste de integração automatizado para validar todas as regras e critérios da Nexa.
 */

const assert = require("assert");
const path = require("path");
const fs = require("fs");

try {
  const electronPath = require.resolve("electron");
  require.cache[electronPath] = {
    id: electronPath,
    filename: electronPath,
    loaded: true,
    exports: { app: { getPath: () => "/tmp" } }
  };
} catch (_) {}

console.log("🧪 Iniciando auditoria de integração da Nexa...");

// 1. Auditoria de tamanho de arquivos (Regra: <= 500 linhas para arquivos novos/modificados)
const nexaFiles = [
  "main/nexa/index.js",
  "main/nexa/nexaState.js",
  "main/nexa/nexaWindow.js",
  "main/nexa/nexaIpc.js",
  "main/nexa/nexaIntegration.js",
  "main/nexa/nexaPersona.js",
  "renderer/nexa/nexaRenderer.js",
  "renderer/nexa/nexaCharacter.js",
  "renderer/nexa/nexaBreathing.js",
  "renderer/nexa/nexaBlink.js",
  "renderer/nexa/nexaLook.js",
  "renderer/nexa/nexaTalking.js",
  "renderer/nexa/nexaThinking.js",
  "renderer/nexa/nexaIntroAnimation.js",
  "renderer/nexa/nexaAnimationController.js",
];

const rootDir = path.resolve(__dirname, "..");
for (const relPath of nexaFiles) {
  const fullPath = path.join(rootDir, relPath);
  assert.ok(fs.existsSync(fullPath), `Arquivo deve existir: ${relPath}`);
  const content = fs.readFileSync(fullPath, "utf-8");
  const lineCount = content.split("\n").length;
  assert.ok(
    lineCount <= 500,
    `Arquivo ${relPath} possui ${lineCount} linhas (máximo permitido é 500)`
  );
  console.log(`  ✅ Linhas OK (${lineCount} l.): ${relPath}`);
}

// 2. Validação do ConfigService & Nexa Config Toggle
const configService = require("../services/configService.js");

// Teste Estado Nexa OFF por padrão
configService.setNexaConfig({ enabled: false });
let nexaCfg = configService.getNexaConfig();
assert.strictEqual(nexaCfg.enabled, false, "Nexa deve estar OFF por padrão");
let promptInst = configService.getPromptInstruction();
assert.ok(!promptInst.includes("SEU ÚNICO NOME E IDENTIDADE É NEXA"), "Prompt não deve conter persona da Nexa quando OFF");

// Teste Estado Nexa ON
configService.setNexaConfig({ enabled: true });
nexaCfg = configService.getNexaConfig();
assert.strictEqual(nexaCfg.enabled, true, "Nexa deve estar ON após ativação");
promptInst = configService.getPromptInstruction();
assert.ok(promptInst.includes("SEU ÚNICO NOME E IDENTIDADE É NEXA"), "Prompt deve injetar a persona feminina da Nexa quando ON");

// Restaura estado para OFF para não sujar o ambiente
configService.setNexaConfig({ enabled: false });
console.log("  ✅ Teste Config & Prompt Persona Nexa aprovado.");

// 3. Validação do Prompt do Agente IDE com Nexa ON
const { buildIdeAgentPrompt } = require("../services/idePrompt.js");
configService.setNexaConfig({ enabled: true });
const idePromptOn = buildIdeAgentPrompt({ wsPaths: ["/test/path"] });
assert.ok(idePromptOn.includes("SEU ÚNICO NOME E IDENTIDADE É NEXA"), "buildIdeAgentPrompt deve conter a persona da Nexa quando ON");

configService.setNexaConfig({ enabled: false });
const idePromptOff = buildIdeAgentPrompt({ wsPaths: ["/test/path"] });
assert.ok(!idePromptOff.includes("SEU ÚNICO NOME E IDENTIDADE É NEXA"), "buildIdeAgentPrompt NÃO deve conter a persona da Nexa quando OFF");

console.log("  ✅ Teste IDE Agent Prompt Nexa aprovado.");

console.log("🎉 AUDITORIA DE INTEGRAÇÃO DA NEXA CONCLUÍDA COM SUCESSO!");
