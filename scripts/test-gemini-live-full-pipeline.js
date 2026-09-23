/**
 * scripts/test-gemini-live-full-pipeline.js
 * 
 * Validação de ponta a ponta da arquitetura Gemini Live + Raphael Core + Antigravity CLI (AGY).
 * Testa:
 * 1. Esquema e declaração de ferramentas do Gemini Live
 * 2. Execução de comandos no workspace e leitura de arquivos
 * 3. Ciclo de despacho assíncrono de tool-calls com transição para estado WORKING
 * 4. Streaming de PCM, Barge-in e player Web Audio API
 * 5. Integração com a máquina de estados e fachadas IPC
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

console.log("🚀 Iniciando Testes da Arquitetura Gemini Live + Raphael Core + AGY...\n");

// Mock Electron se necessário
try {
  const electronPath = require.resolve("electron");
  require.cache[electronPath] = {
    id: electronPath,
    filename: electronPath,
    loaded: true,
    exports: {
      app: { getPath: () => "/tmp" },
      ipcMain: {
        handle: () => {},
        on: () => {},
        emit: () => {}
      },
      BrowserWindow: {
        getAllWindows: () => []
      }
    }
  };
} catch (_) {}

async function runTests() {
  // 1. Verificação das Tools declaradas
  const { DEFAULT_LIVE_TOOLS, executeToolCall } = require('../services/geminiLive/geminiLiveTools');
  assert.ok(Array.isArray(DEFAULT_LIVE_TOOLS), "DEFAULT_LIVE_TOOLS deve ser um array");
  const declarations = DEFAULT_LIVE_TOOLS[0].functionDeclarations;
  assert.ok(declarations.length >= 3, "Deve possuir pelo menos 3 ferramentas declaradas");
  
  const toolNames = declarations.map(t => t.name);
  assert.ok(toolNames.includes('execute_code_task'), "Deve incluir execute_code_task");
  assert.ok(toolNames.includes('run_terminal_command'), "Deve incluir run_terminal_command");
  assert.ok(toolNames.includes('read_workspace_file'), "Deve incluir read_workspace_file");
  console.log("  ✅ Teste 1: Ferramentas do Gemini Live (execute_code_task, run_terminal_command, read_workspace_file) declaradas corretamente.");

  // 2. Execução de tool: read_workspace_file
  const readRes = await executeToolCall({
    id: 'call_test_read_1',
    name: 'read_workspace_file',
    args: { filePath: 'package.json' }
  });
  assert.strictEqual(readRes.id, 'call_test_read_1');
  assert.strictEqual(readRes.response.output.status, 'success');
  assert.ok(readRes.response.output.content.includes('"name": "meu-electron-app"'));
  console.log("  ✅ Teste 2: Ferramenta read_workspace_file executou e leu package.json com sucesso.");

  // 3. Execução de tool: run_terminal_command
  const termRes = await executeToolCall({
    id: 'call_test_term_2',
    name: 'run_terminal_command',
    args: { command: 'git status --short' }
  });
  assert.strictEqual(termRes.id, 'call_test_term_2');
  assert.strictEqual(termRes.response.output.status, 'success');
  console.log("  ✅ Teste 3: Ferramenta run_terminal_command executou no workspace local.");

  // 4. Sessão Gemini Live com Mock WebSocket e fluxo de Tool Call
  const { GeminiLiveSession } = require('../services/geminiLive');
  const session = new GeminiLiveSession({
    apiKey: 'mock_key_test',
    systemInstruction: 'Instrução de teste'
  });

  // Mock do WebSocket interno
  let sentPayloads = [];
  session.ws = {
    send: (payloadStr) => {
      sentPayloads.push(JSON.parse(payloadStr));
    },
    close: () => {}
  };
  session.isConnected = true;
  session.isSessionConfigured = true;

  // Verifica envio de PCM Chunk
  const fakePcm = Buffer.alloc(320); // 10ms de áudio a 16kHz
  session.sendAudioChunk(fakePcm);
  assert.strictEqual(sentPayloads.length, 1);
  assert.strictEqual(sentPayloads[0].realtimeInput.audio.mimeType, "audio/pcm;rate=16000");
  console.log("  ✅ Teste 4: sendAudioChunk transmite áudio PCM 16kHz s16le no protocolo da Live API.");

  // 5. Simulação de resposta com áudio falado e Barge-In
  let audioChunksReceived = 0;
  let bargeInFired = false;
  session.on('audio-chunk', () => { audioChunksReceived++; });
  session.on('barge-in', () => { bargeInFired = true; });

  // Mensagem do servidor contendo áudio falado inicial
  session._handleMessage(JSON.stringify({
    serverContent: {
      modelTurn: {
        parts: [
          { inlineData: { mimeType: "audio/pcm;rate=24000", data: Buffer.from("fakeaudio").toString('base64') } },
          { text: "Beleza Juliano! Já estou abrindo o arquivo no AGY..." }
        ]
      }
    }
  }));
  assert.strictEqual(audioChunksReceived, 1);
  assert.strictEqual(session.currentState, "SPEAKING");

  // Interrupção Barge-In
  session._handleMessage(JSON.stringify({
    serverContent: {
      interrupted: true
    }
  }));
  assert.strictEqual(bargeInFired, true);
  assert.strictEqual(session.currentState, "LISTENING");
  console.log("  ✅ Teste 5: Áudio em tempo real e interrupção nativa (Barge-In) validados.");

  // 6. Simulação do fluxo concorrente: Tool Call disparando execução com estado WORKING
  let stateLog = [];
  session.on('state-changed', ({ state }) => stateLog.push(state));

  await session._handleMessage(JSON.stringify({
    toolCall: {
      functionCalls: [
        {
          id: 'call_live_456',
          name: 'read_workspace_file',
          args: { filePath: 'package.json' }
        }
      ]
    }
  }));

  assert.ok(stateLog.includes("WORKING"), "Estado deve ter transitado para WORKING durante a ferramenta");
  
  // Verifica se o sendToolResponse foi enviado de volta ao WebSocket
  const toolResponsePayload = sentPayloads.find(p => p.toolResponse !== undefined);
  assert.ok(toolResponsePayload, "sendToolResponse deve ser emitido de volta para a Live API");
  assert.strictEqual(toolResponsePayload.toolResponse.functionResponses[0].id, 'call_live_456');
  console.log("  ✅ Teste 6: Orquestração de tool-call com transição para WORKING e retorno de toolResponse validado.");

  // 7. Validação do preload.js, nexaRenderer.js e raphaelSubtitles.js
  const preloadContent = fs.readFileSync(path.join(__dirname, "../preload.js"), "utf8");
  assert.ok(preloadContent.includes("onGeminiLiveAudioChunk"), "preload.js deve conter onGeminiLiveAudioChunk");
  assert.ok(preloadContent.includes("onGeminiLiveBargeIn"), "preload.js deve conter onGeminiLiveBargeIn");
  assert.ok(preloadContent.includes("onGeminiLiveTranscript"), "preload.js deve conter onGeminiLiveTranscript");
  assert.ok(preloadContent.includes("onGeminiLiveTurnComplete"), "preload.js deve conter onGeminiLiveTurnComplete");

  const rendererContent = fs.readFileSync(path.join(__dirname, "../renderer/nexa/nexaRenderer.js"), "utf8");
  assert.ok(rendererContent.includes("class PcmStreamPlayer"), "nexaRenderer.js deve conter PcmStreamPlayer");
  assert.ok(rendererContent.includes("updateStreaming"), "nexaRenderer.js deve usar updateStreaming para legendas");

  const subtitlesContent = fs.readFileSync(path.join(__dirname, "../renderer/raphael/raphaelSubtitles.js"), "utf8");
  assert.ok(subtitlesContent.includes("updateStreaming"), "raphaelSubtitles.js deve implementar updateStreaming");
  assert.ok(subtitlesContent.includes("finishStreaming"), "raphaelSubtitles.js deve implementar finishStreaming");

  // 8. Validação de Handshake e Acumulação de Transcrição
  const sessionTrans = new GeminiLiveSession({ apiKey: 'mock_key' });
  let handshakeSent = null;
  sessionTrans.ws = {
    send: (msg) => { handshakeSent = JSON.parse(msg); },
    close: () => {}
  };
  sessionTrans.isConnected = true;
  sessionTrans._sendSetupHandshake();
  assert.ok(handshakeSent.setup.inputAudioTranscription, "Setup deve conter inputAudioTranscription");
  assert.ok(handshakeSent.setup.outputAudioTranscription, "Setup deve conter outputAudioTranscription");

  let capturedTurn = null;
  sessionTrans.on('turn-complete', (data) => { capturedTurn = data; });
  await sessionTrans._handleMessage(JSON.stringify({
    serverContent: {
      inputTranscription: { text: "Bom dia Raphael!" },
      outputTranscription: { text: "Bom dia Juliano! Tudo pronto." },
      turnComplete: true
    }
  }));
  assert.strictEqual(capturedTurn.userText, "Bom dia Raphael!");
  assert.strictEqual(capturedTurn.modelText, "Bom dia Juliano! Tudo pronto.");
  console.log("  ✅ Teste 7 e 8: Setup bidirecional com transcrições, PcmStreamPlayer e RaphaelSubtitles validados.");

  console.log("\n🎉 TODOS OS 8 TESTES DA PIPELINE COMPLETA GEMINI LIVE + RAPHAEL CORE PASSARAM COM SUCESSO!");
}

runTests().catch(err => {
  console.error("❌ Falha nos testes:", err);
  process.exit(1);
});
