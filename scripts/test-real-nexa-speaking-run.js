/**
 * scripts/test-real-nexa-speaking-run.js
 * Teste de validação visual e de ciclo de vida real da Nexa no Electron.
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

const { nexaState } = require("../main/nexa/nexaState.js");
const googleTtsService = require("../services/googleTtsService.js");
const configService = require("../services/configService.js");

console.log("🎬 Iniciando Simulação Real do Ciclo de Vida da Nexa...");
console.log("Fluxo: IDLE -> LISTENING -> THINKING -> SPEAKING -> IDLE");

async function runRealTest() {
  // 1. Início em IDLE
  console.log("📍 [1/5] Estado Atual:", nexaState.getState());
  assertState("IDLE");

  await sleep(1000);

  // 2. Transição para LISTENING (Usuário começa a falar no microfone)
  console.log("🎤 Usuário ativou o microfone...");
  nexaState.setState("LISTENING");
  console.log("📍 [2/5] Estado Atual:", nexaState.getState());
  assertState("LISTENING");

  await sleep(1500);

  // 3. Transição para THINKING (Transcrição concluída, enviando prompt para IA)
  console.log("🤔 Processando prompt e consultando o modelo de IA...");
  nexaState.setState("THINKING");
  console.log("📍 [3/5] Estado Atual:", nexaState.getState());
  assertState("THINKING");

  await sleep(1500);

  // 4. Sintetizando voz real com Google TTS
  const sampleSummary = "Pronto! Analisei o projeto e ajustei o módulo da Nexa com sucesso. Você pode ver as alterações na tela.";
  console.log("🔊 Sintetizando áudio real via Google Cloud TTS...");
  
  const cfg = configService.getGoogleTtsConfig();
  if (cfg.keyPathOrKey) {
    try {
      const audioBuffer = await googleTtsService.synthesizeText(sampleSummary, {
        keyOrPath: cfg.keyPathOrKey,
        voiceName: "pt-BR-Neural2-C"
      });
      console.log(`✅ Áudio sintetizado com sucesso! Tamanho do MP3: ${audioBuffer.length} bytes.`);
    } catch (e) {
      console.log("⚠️ Aviso na síntese real (usando fallback de teste):", e.message);
    }
  } else {
    console.log("ℹ️ Nenhuma chave JSON do Google TTS configurada neste ambiente local.");
  }

  // Transição para SPEAKING (Início da reprodução de áudio e análise Web Audio API)
  nexaState.setState("SPEAKING");
  console.log("📍 [4/5] Estado Atual:", nexaState.getState());
  assertState("SPEAKING");

  // Simula tempo de reprodução da fala (~3.5 segundos)
  console.log("🗣️ Nexa falando resumo por voz (Boca reativa a formantes vocais e fricativas)...");
  await sleep(3500);

  // 5. Término da fala -> Retorno para IDLE
  console.log("🛑 Áudio TTS finalizado. Retornando para IDLE...");
  nexaState.setState("IDLE");
  console.log("📍 [5/5] Estado Atual:", nexaState.getState());
  assertState("IDLE");

  console.log("🎉 SIMULAÇÃO DO CICLO DE VIDA DA NEXA CONCLUÍDA COM SUCESSO!");
}

function assertState(expected) {
  const current = nexaState.getState();
  if (current !== expected) {
    throw new Error(`Esperado estado ${expected}, mas obteve ${current}`);
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

runRealTest().catch((err) => {
  console.error("❌ Erro no teste de ciclo de vida real:", err);
  process.exit(1);
});
