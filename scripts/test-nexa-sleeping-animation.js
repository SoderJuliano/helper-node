/**
 * scripts/test-nexa-sleeping-animation.js
 * Teste automatizado para verificar o enquadramento e limites da animação de dormir (sleeping_lottie).
 */

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { NexaLottieAnimation } = require("../renderer/nexa/nexaLottieAnimation.js");

console.log("=== Testando Enquadramento da Animação de Dormir (sleeping_lottie) ===\n");

const sleepingDir = path.join(__dirname, "../renderer/nexa/assets/lottie/sleeping_lottie");
const mainJsonPath = path.join(sleepingDir, "animations/main.json");
assert.ok(fs.existsSync(mainJsonPath), "main.json de sleeping_lottie deve existir");

const jsonContent = JSON.parse(fs.readFileSync(mainJsonPath, "utf8"));
assert.strictEqual(jsonContent.w, 480, "Largura base deve ser 480");
assert.strictEqual(jsonContent.h, 270, "Altura base deve ser 270");

const lottieSleeping = new NexaLottieAnimation({ animationPath: "renderer/nexa/assets/lottie/sleeping_lottie/animations/main.json" });
lottieSleeping.anim = { isPlaying: true };
lottieSleeping.canvas = { width: 480, height: 270 };
lottieSleeping.isPlaying = true;
lottieSleeping.finished = false;

let drawnArgs = null;
const fakeCtx = {
  clearRect: () => {},
  save: () => {},
  restore: () => {},
  drawImage: (...args) => { drawnArgs = args; }
};

const WINDOW_W = 360;
const WINDOW_H = 360;

lottieSleeping.render(fakeCtx, WINDOW_W, WINDOW_H);
assert.ok(drawnArgs, "drawImage deve ter sido chamado");
const [img, x, y, drawW, drawH] = drawnArgs;

console.log(`  Dimensões renderizadas: W=${drawW.toFixed(1)}px, H=${drawH.toFixed(1)}px, Pos=(X=${x.toFixed(1)}, Y=${y.toFixed(1)})`);

// Validações de limites dentro da janela 360x360
assert.ok(x >= 0, `X (${x}) deve ser >= 0 (não vazar para fora à esquerda)`);
assert.ok(x + drawW <= WINDOW_W, `X + drawW (${x + drawW}) deve ser <= ${WINDOW_W} (não vazar à direita)`);
assert.ok(y >= 0, `Y (${y}) deve ser >= 0 (não vazar acima)`);
assert.ok(y + drawH <= WINDOW_H, `Y + drawH (${y + drawH}) deve ser <= ${WINDOW_H} (não vazar abaixo)`);

console.log("  [OK] Animação de dormir está 100% contida dentro da janela sem corte.");
console.log("\n🎉 TESTE DA ANIMAÇÃO DE DORMIR PASSOU COM SUCESSO! 💤✨");
