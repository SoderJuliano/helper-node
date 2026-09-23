/**
 * scripts/test-live-raphael-refactor.js
 * Teste automatizado de validação da refatoração Live Vision + Raphael Core Exclusivo.
 */

const assert = require("assert");
const fs = require("fs");
const path = require("path");

try {
  const electronPath = require.resolve("electron");
  require.cache[electronPath] = {
    id: electronPath,
    filename: electronPath,
    loaded: true,
    exports: { app: { getPath: () => "/tmp" } }
  };
} catch (_) {}

console.log("🧪 Iniciando validação completa da Refatoração Live + Raphael Core...\n");

// 1. Validação de purga dos arquivos 2D e Lottie
const purgedFiles = [
  "renderer/nexa/assets/lottie",
  "renderer/nexa/assets/layers",
  "renderer/nexa/nexaCharacter.js",
  "renderer/nexa/nexaAnimationController.js",
  "renderer/nexa/nexaLottieAnimation.js",
  "renderer/nexa/nexaIntroAnimation.js",
  "renderer/nexa/nexaBlink.js",
  "renderer/nexa/nexaBreathing.js",
  "renderer/nexa/nexaLook.js",
  "renderer/nexa/nexaTalking.js",
  "renderer/nexa/nexaThinking.js",
  "renderer/nexa/nexaDragHandler.js",
  "main/nexa/nexaAnimations.js"
];

for (const rel of purgedFiles) {
  const full = path.join(__dirname, "..", rel);
  assert.strictEqual(fs.existsSync(full), false, `Arquivo ou pasta purgada NÃO deve existir: ${rel}`);
}
console.log("  ✅ Teste 1: Todos os arquivos 2D, Lottie e camadas PSD foram completamente expurgados.");

// 2. Validação do package.json (sem lottie-web e sem tesseract.js)
const pkgJson = JSON.parse(fs.readFileSync(path.join(__dirname, "../package.json"), "utf8"));
assert.strictEqual(pkgJson.dependencies["lottie-web"], undefined, "lottie-web não deve estar nas dependências");
assert.strictEqual(pkgJson.dependencies["tesseract.js"], undefined, "tesseract.js não deve estar nas dependências");
console.log("  ✅ Teste 2: package.json limpo sem lottie-web e sem tesseract.js.");

// 3. Validação do Raphael Core como núcleo visual exclusivo em nexa.html e nexaRenderer.js
const nexaHtml = fs.readFileSync(path.join(__dirname, "../renderer/nexa/nexa.html"), "utf8");
assert.ok(nexaHtml.includes("raphaelCore.js"), "nexa.html deve carregar raphaelCore.js");
assert.ok(!nexaHtml.includes("lottie.min.js"), "nexa.html NÃO deve conter lottie");
assert.ok(!nexaHtml.includes("nexaCharacter.js"), "nexa.html NÃO deve conter nexaCharacter.js");

const nexaRenderer = fs.readFileSync(path.join(__dirname, "../renderer/nexa/nexaRenderer.js"), "utf8");
assert.ok(nexaRenderer.includes("RaphaelCore"), "nexaRenderer.js deve usar RaphaelCore");
assert.ok(!nexaRenderer.includes("NexaCharacter"), "nexaRenderer.js NÃO deve conter NexaCharacter");
assert.ok(!nexaRenderer.includes("NexaLottieAnimation"), "nexaRenderer.js NÃO deve conter NexaLottieAnimation");
console.log("  ✅ Teste 3: nexa.html e nexaRenderer.js operam exclusivamente com Raphael Core.");

// 4. Validação de ausência de tags de animação 2D na persona
const { buildNexaSystemPrompt } = require("../main/nexa/nexaPersona.js");
const prompt = buildNexaSystemPrompt("Raphael", "raphael");
assert.ok(!prompt.includes("<animation>"), "Prompt da persona não deve sugerir tags <animation>");
assert.ok(!prompt.includes("\"animation\":"), "Prompt da persona não deve conter campo animation no schema");
assert.ok(prompt.includes("Raphael Core"), "Prompt deve definir Raphael Core como núcleo visual");
console.log("  ✅ Teste 4: Prompts da persona simplificados e sem tags de animação.");

// 5. Validação de tokens e Google API Key no configService
try {
  const electronPath = require.resolve("electron");
  require.cache[electronPath] = {
    id: electronPath,
    filename: electronPath,
    loaded: true,
    exports: { app: { getPath: () => "/tmp" } }
  };
} catch (_) {}

const configService = require("../services/configService.js");
configService.setGoogleApiKey("AIzaSyTestKey123");
assert.strictEqual(configService.getGoogleApiKey(), "AIzaSyTestKey123", "configService deve armazenar e recuperar googleApiKey");
configService.setGoogleApiKey("");
console.log("  ✅ Teste 5: Google API Key configurada e acessível via configService.");

// 6. Validação do tesseractService como adaptador de visão direta (sem tesseract.js)
const tesseractService = require("../services/tesseractService.js");
tesseractService.getTextFromImage("data:image/png;base64,iVBORw0KGgo=").then(res => {
  assert.strictEqual(res, "", "getTextFromImage deve retornar vazio sem invocar OCR legado");
  console.log("  ✅ Teste 6: tesseractService opera sem tesseract.js como adaptador de visão direta.");
});

// 7. Validação do módulo Gemini Live Session
const { GeminiLiveSession, isLiveSessionActive } = require("../services/geminiLive");
const session = new GeminiLiveSession({ apiKey: "test_key", systemInstruction: "Teste" });
assert.strictEqual(typeof session.connect, "function", "GeminiLiveSession deve possuir método connect");
assert.strictEqual(typeof session.sendAudioChunk, "function", "GeminiLiveSession deve possuir método sendAudioChunk");
assert.strictEqual(typeof session.sendTextMessage, "function", "GeminiLiveSession deve possuir método sendTextMessage");
assert.strictEqual(typeof session.sendToolResponse, "function", "GeminiLiveSession deve possuir método sendToolResponse");
assert.strictEqual(isLiveSessionActive(), false, "Sessão deve iniciar inativa");
console.log("  ✅ Teste 7: GeminiLiveSession carregado com API duplex para áudio streaming.");

// 8. Validação da edição Lite
const edition = require("../services/edition.js");
assert.strictEqual(edition.isLite(), true, "Aplicação deve ser 100% Lite");
console.log("  ✅ Teste 8: Helper Node configurado como 100% Lite unificado.");

console.log("\n🎉 TODAS AS 8 VALIDAÇÕES DA REESTRUTURAÇÃO PASSARAM COM SUCESSO!");
