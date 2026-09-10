/**
 * scripts/test-nexa-voice-intent.js
 * Teste unitário para o Classificador de Intenção do Modo de Voz Ativo Nexa.
 */

const assert = require("assert");
const NexaIntentClassifier = require("../services/nexaVoiceAssistant/nexaIntentClassifier");

console.log("🧪 Iniciando testes de Intent Classifier da Nexa...\n");

// 1. Casos de IGNORAR (Ruído, conversa de terceiros, sem wake word)
{
  const res = NexaIntentClassifier.classify("vamos almoçar que horas hoje?");
  assert.strictEqual(res.action, "IGNORE", "Conversa paralela sem 'Nexa' deve ser ignorada");
  console.log("✅ Caso 1: Conversa paralela sem wake word -> IGNORE");
}

{
  const res = NexaIntentClassifier.classify("");
  assert.strictEqual(res.action, "IGNORE", "Texto vazio deve ser ignorado");
  console.log("✅ Caso 2: Texto vazio -> IGNORE");
}

// 2. Casos de APRESENTAÇÃO A TERCEIROS (3ª Pessoa) -> Deve reagir com animação silenciosa sem falar
{
  const res = NexaIntentClassifier.classify("Pessoal, essa aqui é a Nexa, minha assistente pessoal");
  assert.strictEqual(res.action, "REACT_ANIMATION_ONLY", "Apresentação em 3ª pessoa deve ser animação apenas");
  assert.strictEqual(res.animation, "wave", "Deve acenar amigavelmente na apresentação");
  console.log("✅ Caso 3: Apresentação em 3ª pessoa -> REACT_ANIMATION_ONLY (wave)");
}

{
  const res = NexaIntentClassifier.classify("Aqui estou gravando um vídeo pro YouTube mostrando a Nexa");
  assert.strictEqual(res.action, "REACT_ANIMATION_ONLY", "Menção de vídeo/gravação da Nexa deve ser animação apenas");
  console.log("✅ Caso 4: Menção da Nexa em gravação de vídeo -> REACT_ANIMATION_ONLY");
}

// 3. Casos de PEDIDOS DE GESTOS / ANIMAÇÕES ESPECÍFICAS
{
  const res = NexaIntentClassifier.classify("Nexa, manda um coração");
  assert.strictEqual(res.action, "REACT_ANIMATION_ONLY");
  assert.strictEqual(res.animation, "heart");
  console.log("✅ Caso 5: Pedido de coração -> REACT_ANIMATION_ONLY (heart)");
}

{
  const res = NexaIntentClassifier.classify("Nexa, dá um tchauzinho");
  assert.strictEqual(res.action, "REACT_ANIMATION_ONLY");
  assert.strictEqual(res.animation, "wave");
  console.log("✅ Caso 6: Pedido de tchauzinho -> REACT_ANIMATION_ONLY (wave)");
}

{
  const res = NexaIntentClassifier.classify("Nexa, faz uma dancinha");
  assert.strictEqual(res.action, "REACT_ANIMATION_ONLY");
  assert.strictEqual(res.animation, "dance");
  console.log("✅ Caso 7: Pedido de dança -> REACT_ANIMATION_ONLY (dance)");
}

{
  const res = NexaIntentClassifier.classify("Nexa, hora do café");
  assert.strictEqual(res.action, "REACT_ANIMATION_ONLY");
  assert.strictEqual(res.animation, "coffee");
  console.log("✅ Caso 8: Pedido de café -> REACT_ANIMATION_ONLY (coffee)");
}

// 4. Casos de PERGUNTAS E COMANDOS DIRETOS
{
  const res = NexaIntentClassifier.classify("Nexa, qual é a previsão do tempo hoje?");
  assert.strictEqual(res.action, "RESPOND_AUDIO_AND_CHAT");
  assert.strictEqual(res.cleanedQuery, "qual é a previsão do tempo hoje?");
  console.log("✅ Caso 9: Pergunta direta de clima -> RESPOND_AUDIO_AND_CHAT (limpo)");
}

{
  const res = NexaIntentClassifier.classify("Ei Nexa, como funciona polimorfismo no Java?");
  assert.strictEqual(res.action, "RESPOND_AUDIO_AND_CHAT");
  assert.strictEqual(res.cleanedQuery, "como funciona polimorfismo no Java?");
  console.log("✅ Caso 10: Pergunta técnica direta -> RESPOND_AUDIO_AND_CHAT (limpo)");
}

{
  const res = NexaIntentClassifier.classify("Oi Nexa, tudo bem?");
  assert.strictEqual(res.action, "RESPOND_AUDIO_AND_CHAT");
  assert.strictEqual(res.isCasualGreeting, true);
  console.log("✅ Caso 11: Saudação casual -> RESPOND_AUDIO_AND_CHAT (casual)");
}

// 5. Casos de JANELA DE FOLLOW-UP ATIVA (Sem precisar falar 'Nexa')
{
  const res = NexaIntentClassifier.classify("E como eu compilo isso?", { followUpActive: true });
  assert.strictEqual(res.action, "RESPOND_AUDIO_AND_CHAT", "Em follow-up ativo, responde sem exigir 'Nexa'");
  assert.strictEqual(res.cleanedQuery, "E como eu compilo isso?");
  console.log("✅ Caso 12: Pergunta em janela de follow-up ativa -> RESPOND_AUDIO_AND_CHAT");
}

console.log("\n🎉 Todos os 12 testes do Intent Classifier passaram com sucesso!");
