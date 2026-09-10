/**
 * scripts/test-nexa-voice-response-filter.js
 * Teste unitário para o Filtro de Respostas do Modo de Voz Nexa.
 */

const assert = require("assert");
const NexaResponseFilter = require("../services/nexaVoiceAssistant/nexaResponseFilter");

console.log("🧪 Iniciando testes de Nexa Response Filter...\n");

// 1. Resposta com <voice_summary> explícito e código na tela
{
  const fullResponse = `
Aqui está o exemplo de Controller Spring Boot:

\`\`\`java
@RestController
@RequestMapping("/api")
public class TestController {
    @GetMapping("/hello")
    public String hello() { return "Olá!"; }
}
\`\`\`

<voice_summary>Pronto! Criei o controller Spring Boot e deixei o código na tela para você conferir.</voice_summary>
  `.trim();

  const res = NexaResponseFilter.processResponse(fullResponse);

  assert.strictEqual(
    res.voiceSummary,
    "Pronto! Criei o controller Spring Boot e deixei o código na tela para você conferir."
  );
  assert.ok(!res.displayText.includes("<voice_summary>"), "A tag voice_summary deve ser removida da tela");
  assert.ok(res.displayText.includes("@RestController"), "O código deve ser preservado na tela");
  assert.strictEqual(res.animation, "writing_code", "Deve inferir animação writing_code por ter bloco de código");
  console.log("✅ Caso 1: Extração de <voice_summary> com código na tela e animação writing_code");
}

// 2. Resposta com tag de animação explícita <animation>dance</animation>
{
  const fullResponse = `
Parabéns, você finalizou a tarefa com sucesso!

<animation>dance</animation>
<voice_summary>Parabéns! Você arrasou e finalizou tudo com sucesso!</voice_summary>
  `.trim();

  const res = NexaResponseFilter.processResponse(fullResponse);
  assert.strictEqual(res.animation, "dance");
  assert.strictEqual(res.voiceSummary, "Parabéns! Você arrasou e finalizou tudo com sucesso!");
  assert.ok(!res.displayText.includes("<animation>"));
  console.log("✅ Caso 2: Extração de tag de animação explícita (<animation>dance</animation>)");
}

// 3. Fallback quando a IA não envia <voice_summary>
{
  const rawWithoutTag = "Os tipos primitivos no Java são byte, short, int, long, float, double, boolean e char.";
  const res = NexaResponseFilter.processResponse(rawWithoutTag);
  assert.strictEqual(res.voiceSummary, rawWithoutTag);
  console.log("✅ Caso 3: Fallback gracioso quando voice_summary não foi fornecido");
}

console.log("\n🎉 Todos os testes de Response Filter passaram com sucesso!");
