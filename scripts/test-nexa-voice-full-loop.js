/**
 * scripts/test-nexa-voice-full-loop.js
 * Teste unitario e de integracao para o ciclo completo do Nexa Voice Assistant.
 */

const assert = require("assert");
const NexaIntentClassifier = require("../services/nexaVoiceAssistant/nexaIntentClassifier");
const NexaConversationContext = require("../services/nexaVoiceAssistant/nexaConversationContext");
const NexaResponseFilter = require("../services/nexaVoiceAssistant/nexaResponseFilter");

console.log("🧪 Testando ciclo completo do Modo de Voz Ativo Nexa...\n");

// 1. Classificação de pergunta com wake word
{
  const transcript = "Nexa, me explica como funciona a injeção de dependências?";
  const classification = NexaIntentClassifier.classify(transcript);
  assert.strictEqual(classification.action, "RESPOND_AUDIO_AND_CHAT");
  assert.strictEqual(classification.cleanedQuery, "me explica como funciona a injeção de dependências?");
  console.log("✅ 1. Classificação de comando de voz bem-sucedida");
}

// 2. Extração de <voice_summary> da resposta
{
  const fakeAiResponse = `Aqui está uma explicação de Injeção de Dependências em Java:
\`\`\`java
@Service
public class OrderService {
    @Autowired
    private PaymentRepository repo;
}
\`\`\`
<voice_summary>Pronto! Expliquei a injeção de dependências e deixei o exemplo de código na tela para você.</voice_summary>`;

  const { voiceSummary, displayText, animation } = NexaResponseFilter.processResponse(fakeAiResponse);
  assert.strictEqual(
    voiceSummary,
    "Pronto! Expliquei a injeção de dependências e deixei o exemplo de código na tela para você."
  );
  assert.strictEqual(animation, "SPEAKING");
  assert.ok(!displayText.includes("<voice_summary>"), "Display text não deve conter a tag voice_summary");
  console.log("✅ 2. Extração de voice_summary pelo NexaResponseFilter bem-sucedida:", voiceSummary);
}

// 3. Verificação de Follow-up (segundo turno de conversa sem falar 'Nexa')
{
  const secondTurn = "E onde coloco a anotação @Component?";
  const followUpClassification = NexaIntentClassifier.classify(secondTurn, { followUpActive: true });
  assert.strictEqual(followUpClassification.action, "RESPOND_AUDIO_AND_CHAT");
  assert.strictEqual(followUpClassification.cleanedQuery, "E onde coloco a anotação @Component?");
  console.log("✅ 3. Follow-up de 8 segundos aceita pergunta sem wake word");
}

// 4. Teste de fallback sem voice_summary
{
  const rawText = "Injeção de dependência é um padrão de design de software em que um objeto recebe outros objetos dos quais depende.";
  const { voiceSummary } = NexaResponseFilter.processResponse(rawText);
  assert(voiceSummary.length > 0 && voiceSummary.length <= 200, "Fallback de resumo curto deve ser conciso");
  console.log("✅ 4. Fallback de resumo conciso bem-sucedido:", voiceSummary);
}

console.log("\n🎉 Todos os testes do ciclo completo da Nexa passaram com sucesso!");
