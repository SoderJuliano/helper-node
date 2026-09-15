/**
 * scripts/test-raphael-core.js
 * Teste automatizado de integração para o motor visual Raphael Core (A Alma da Nexa).
 */

const assert = require("assert");
const { RaphaelMath } = require("../renderer/raphael/raphaelMath.js");
const { RAPHAEL_THEMES } = require("../renderer/raphael/raphaelThemes.js");
const { RaphaelAudioVisualizer } = require("../renderer/raphael/raphaelAudioVisualizer.js");
const { RaphaelRings } = require("../renderer/raphael/raphaelRings.js");
const { RaphaelCore } = require("../renderer/raphael/raphaelCore.js");

console.log("=== Testando Motor Visual Raphael Core (Alma da Nexa) ===\n");

// 1. Validação do RaphaelMath
const rot = RaphaelMath.rotate3D(10, 0, 0, 0, Math.PI / 2, 0);
assert.ok(Math.abs(rot.x) < 0.001, "Rotação Y em 90 graus deve zerar X");
assert.ok(Math.abs(rot.z - (-10)) < 0.001, "Rotação Y em 90 graus deve projetar Z em -10");

const proj = RaphaelMath.project3D(0, 0, 0, 180, 180, 300);
assert.strictEqual(proj.x, 180, "Ponto (0,0) centralizado deve projetar no centro 180");
assert.strictEqual(proj.y, 180, "Ponto (0,0) centralizado deve projetar no centro 180");
assert.strictEqual(proj.scale, 1.0, "Escala na origem focal deve ser 1.0");

const lerped = RaphaelMath.lerpColor({ r: 0, g: 0, b: 0 }, { r: 100, g: 200, b: 50 }, 0.5);
assert.strictEqual(lerped.r, 50, "Lerp R deve ser 50");
assert.strictEqual(lerped.g, 100, "Lerp G deve ser 100");
assert.strictEqual(lerped.b, 25, "Lerp B deve ser 25");
console.log("  [OK] Teste 1: RaphaelMath validado com sucesso.");

// 2. Validação dos Temas e Estados
const expectedStates = ["IDLE", "LISTENING", "THINKING", "SPEAKING", "WORKING", "SEARCHING", "SLEEPING"];
expectedStates.forEach((state) => {
  assert.ok(RAPHAEL_THEMES[state], `Tema ${state} deve estar definido no catálogo`);
  assert.ok(RAPHAEL_THEMES[state].coreColorPrimary, `Tema ${state} deve possuir coreColorPrimary`);
  assert.ok(RAPHAEL_THEMES[state].particleColors.length > 0, `Tema ${state} deve possuir paleta de partículas`);
});
console.log("  [OK] Teste 2: Todos os 7 estados e paletas cromáticas validados.");

// 3. Validação do RaphaelRings
const rings = new RaphaelRings();
assert.ok(rings.ringDefinitions.length >= 3, "Devem existir ao menos 3 auréolas orbitais concêntricas");
assert.ok(rings.particles.length > 200, "Devem existir mais de 200 partículas tridimensionais nas auréolas");
assert.ok(rings.sphericalParticles.length > 50, "Deve existir nuvem esférica de partículas cósmicas");

rings.update(0.016, RAPHAEL_THEMES.IDLE, { bass: 0.5, mid: 0.3, treble: 0.2, amplitude: 0.4 }, 1.0);
assert.ok(typeof rings.particles[0].worldX === "number", "Posição worldX deve ser numérica");
assert.ok(typeof rings.particles[0].worldZ === "number", "Posição worldZ deve ser numérica");
assert.ok(typeof rings.sphericalParticles[0].worldX === "number", "Posição esférica worldX deve ser numérica");
console.log("  [OK] Teste 3: Rotação giroscópica e física 3D dos anéis validadas.");

// 4. Validação do RaphaelAudioVisualizer
const audioVis = new RaphaelAudioVisualizer();
audioVis.update(0.016, true);
const metrics = audioVis.getMetrics();
assert.ok(typeof metrics.bass === "number", "Métrica bass deve ser numérica");
assert.ok(typeof metrics.amplitude === "number", "Métrica amplitude deve ser numérica");
console.log("  [OK] Teste 4: Analisador de áudio espectral e métricas FFT validados.");

// 5. Validação do RaphaelCore e Renderização Canvas
const core = new RaphaelCore();
assert.strictEqual(core.getCurrentState(), "IDLE", "Estado inicial deve ser IDLE");

core.setState("THINKING");
assert.strictEqual(core.getCurrentState(), "THINKING", "Estado deve transicionar para THINKING");
assert.ok(core.shockwaves.length > 0, "Mudança de estado deve emitir onda de choque de plasma");

core.update(0.016);

let drawCallCount = 0;
const mockCtx = {
  clearRect: () => {},
  save: () => {},
  restore: () => {},
  beginPath: () => {},
  arc: () => { drawCallCount++; },
  fill: () => {},
  stroke: () => {},
  createRadialGradient: () => ({ addColorStop: () => {} })
};

core.render(mockCtx, 360, 360);
assert.ok(drawCallCount > 50, "Renderizador deve desenhar partículas, corona, núcleo e anéis");
// 6. Validação de Carregamento em Ambiente de Scripts de Navegador (sem conflito de escopo)
const vm = require("vm");
const fs = require("fs");
const path = require("path");

const browserCtx = vm.createContext({
  console,
  window: {},
  document: {},
  Image: function() {},
  AudioContext: function() {
    return {
      createAnalyser: () => ({ fftSize: 512, frequencyBinCount: 256, smoothingTimeConstant: 0.8 }),
      createMediaElementSource: () => ({ connect: () => {} }),
      destination: {}
    };
  }
});
browserCtx.window = browserCtx;
browserCtx.globalThis = browserCtx;

const scriptsToLoad = [
  "renderer/raphael/raphaelMath.js",
  "renderer/raphael/raphaelThemes.js",
  "renderer/raphael/raphaelAudioVisualizer.js",
  "renderer/raphael/raphaelRings.js",
  "renderer/raphael/raphaelCore.js"
];

scriptsToLoad.forEach((rel) => {
  const code = fs.readFileSync(path.join(__dirname, "..", rel), "utf8");
  vm.runInContext(code, browserCtx);
});

assert.ok(typeof browserCtx.RaphaelCore === "function", "RaphaelCore deve estar instanciável no escopo global do navegador");
const browserInstance = new browserCtx.RaphaelCore();
assert.strictEqual(browserInstance.getCurrentState(), "IDLE", "RaphaelCore instanciado no browser deve iniciar em IDLE");
console.log("  [OK] Teste 6: Carregamento sequencial em ambiente de navegador (HTML <script>) 100% sem erros de escopo.");

console.log("\n🎉 TODOS OS TESTES DO RAPHAEL CORE PASSARAM COM SUCESSO! 🔮✨");
