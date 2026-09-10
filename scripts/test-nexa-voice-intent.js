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

// 6. Casos de VARIAÇÕES FONÉTICAS DO WHISPER (Naxa, Nessa, Néxa)
{
  const res = NexaIntentClassifier.classify("Oi Naxa, tudo bem?");
  assert.strictEqual(res.action, "RESPOND_AUDIO_AND_CHAT");
  assert.strictEqual(res.isCasualGreeting, true);
  console.log("✅ Caso 13: Transcrição fonética 'Oi Naxa, tudo bem?' -> RESPOND_AUDIO_AND_CHAT");
}

{
  const res = NexaIntentClassifier.classify("Nessa, tudo bem?");
  assert.strictEqual(res.action, "RESPOND_AUDIO_AND_CHAT");
  assert.strictEqual(res.isCasualGreeting, true);
  console.log("✅ Caso 14: Transcrição fonética 'Nessa, tudo bem?' -> RESPOND_AUDIO_AND_CHAT");
}

{
  const res = NexaIntentClassifier.classify("Nessa você está aí.");
  assert.strictEqual(res.action, "RESPOND_AUDIO_AND_CHAT");
  assert.strictEqual(res.isCasualGreeting, true);
  console.log("✅ Caso 15: Transcrição fonética 'Nessa você está aí.' -> RESPOND_AUDIO_AND_CHAT");
}

{
  const res = NexaIntentClassifier.classify("Néxa, como crio um controller em Java?");
  assert.strictEqual(res.action, "RESPOND_AUDIO_AND_CHAT");
  assert.strictEqual(res.cleanedQuery, "como crio um controller em Java?");
  console.log("✅ Caso 16: Transcrição acentuada 'Néxa' -> RESPOND_AUDIO_AND_CHAT");
}

{
  const res = NexaIntentClassifier.classify("www.mexa.com/mexa.", { followUpActive: true });
  assert.strictEqual(res.action, "IGNORE", "URL alucinada www.mexa.com/mexa deve ser ignorada mesmo em follow-up");
  console.log("✅ Caso 17: Alucinação 'www.mexa.com/mexa.' -> IGNORE");
}

{
  const res = NexaIntentClassifier.classify("www.mexpress.com/mexpress", { followUpActive: true });
  assert.strictEqual(res.action, "IGNORE", "URL alucinada www.mexpress.com/mexpress deve ser ignorada");
  console.log("✅ Caso 18: Alucinação 'www.mexpress.com/mexpress' -> IGNORE");
}

{
  const res = NexaIntentClassifier.classify("ok", { followUpActive: true });
  assert.strictEqual(res.action, "IGNORE", "Interjeição curta isolada em follow-up deve ser ignorada");
  console.log("✅ Caso 19: Interjeição curta em follow-up -> IGNORE");
}

// 7. Casos de ÁUDIO DE VÍDEOS/PODCASTS/MÚSICA EM AMBIENTE (Mesmo com follow-up ativo)
{
  const videoTranscript = "E o gasto que mais me surpreendeu não foi o aluguel. Eu descobri esse valor com o PR e agora vou te mostrar exatamente pra onde esse dinheiro foi. Eu pago 1870 reais aluguel nesse apartamento que tem dois quartos, dois manheiros e como.";
  const res = NexaIntentClassifier.classify(videoTranscript, { followUpActive: true });
  assert.strictEqual(res.action, "IGNORE", "Narração de vídeo tocando em segundo plano deve ser ignorada");
  assert.strictEqual(res.expireFollowUp, true, "Deve expirar follow-up imediatamente para evitar loop infinito");
  console.log("✅ Caso 20: Narração de vídeo sobre finanças/aluguel em follow-up -> IGNORE (expira follow-up)");
}

{
  const res = NexaIntentClassifier.classify("nessa casa nós temos três quartos e uma sala grande");
  assert.strictEqual(res.action, "IGNORE", "Frase normal em PT-BR iniciando com 'nessa [substantivo]' não é wake word");
  console.log("✅ Caso 21: 'Nessa casa...' em contexto gramatical -> IGNORE");
}

{
  const res = NexaIntentClassifier.classify("nesse vídeo vou te mostrar como criar uma API REST", { followUpActive: true });
  assert.strictEqual(res.action, "IGNORE", "Vídeo de tutorial em background deve ser ignorado");
  console.log("✅ Caso 22: 'Nesse vídeo vou te mostrar...' em follow-up -> IGNORE");
}

{
  const { cleanTranscription } = require("../services/audioTranscriptionCleaner");
  const cleaned = cleanTranscription("Sapshopshopshopshopshopshopshopshopshopshopshopshops national.");
  assert.strictEqual(cleaned, "", "Loop de sílabas alucinadas em música deve ser limpo para vazio");
  const res = NexaIntentClassifier.classify(cleaned);
  assert.strictEqual(res.action, "IGNORE");
  console.log("✅ Caso 23: Loop repetitivo de música ('Sapshopshopshop...') -> Descartado");
}

{
  const { cleanTranscription } = require("../services/audioTranscriptionCleaner");
  const cleaned = cleanTranscription("Steve Vozze, Whisper.");
  assert.strictEqual(cleaned, "", "Alucinação de ruído 'Steve Vozze, Whisper' deve ser limpa para vazio");
  const res = NexaIntentClassifier.classify(cleaned);
  assert.strictEqual(res.action, "IGNORE");
  console.log("✅ Caso 24: Alucinação 'Steve Vozze, Whisper.' -> Descartado");
}

{
  const res = NexaIntentClassifier.classify("Nessa, o que é polimorfismo?");
  assert.strictEqual(res.action, "RESPOND_AUDIO_AND_CHAT");
  assert.strictEqual(res.cleanedQuery, "o que é polimorfismo?");
  console.log("✅ Caso 25: Pergunta direta com vocativo 'Nessa, o que é...' -> RESPOND_AUDIO_AND_CHAT");
}

{
  const res = NexaIntentClassifier.classify("E como eu compilo no Linux?", { followUpActive: true });
  assert.strictEqual(res.action, "RESPOND_AUDIO_AND_CHAT");
  console.log("✅ Caso 26: Pergunta de continuidade em follow-up -> RESPOND_AUDIO_AND_CHAT");
}

{
  const res = NexaIntentClassifier.classify("Mostra o código da classe, Nexa.");
  assert.strictEqual(res.action, "RESPOND_AUDIO_AND_CHAT");
  assert.strictEqual(res.cleanedQuery, "Mostra o código da classe");
  console.log("✅ Caso 27: Vocativo 'Nexa' no final da frase -> RESPOND_AUDIO_AND_CHAT");
}

// 8. Casos de CONVERSA COM FILHOS / FAMÍLIA / TERCEIROS (NUNCA deve responder)
{
  const res = NexaIntentClassifier.classify("Filho, vai almoçar agora que a comida tá na mesa");
  assert.strictEqual(res.action, "IGNORE", "Fala direcionada ao filho deve ser ignorada");
  console.log("✅ Caso 28: 'Filho, vai almoçar...' -> IGNORE");
}

{
  const res = NexaIntentClassifier.classify("Filho, guarda seus brinquedos que já está na hora de dormir");
  assert.strictEqual(res.action, "IGNORE", "Comando para o filho guardar brinquedos deve ser ignorado");
  console.log("✅ Caso 29: 'Filho, guarda seus brinquedos...' -> IGNORE");
}

{
  const res = NexaIntentClassifier.classify("Amor, você viu onde deixei a chave do carro?");
  assert.strictEqual(res.action, "IGNORE", "Pergunta para o cônjuge/família deve ser ignorada");
  console.log("✅ Caso 30: 'Amor, você viu onde deixei...' -> IGNORE");
}

{
  const res = NexaIntentClassifier.classify("Gente, vamos pro almoço e depois a gente volta");
  assert.strictEqual(res.action, "IGNORE", "Fala para colegas/terceiros deve ser ignorada");
  console.log("✅ Caso 31: 'Gente, vamos pro almoço...' -> IGNORE");
}

// 9. Casos de COMANDO DE PARADA / INTERRUPÇÃO (Barge-In)
{
  const res = NexaIntentClassifier.classify("Nexa, para");
  assert.strictEqual(res.action, "STOP_AND_LISTEN", "Comando 'Nexa, para' deve interromper a fala imediatamente");
  console.log("✅ Caso 32: 'Nexa, para' -> STOP_AND_LISTEN");
}

{
  const res = NexaIntentClassifier.classify("Cancela, Nexa");
  assert.strictEqual(res.action, "STOP_AND_LISTEN");
  console.log("✅ Caso 33: 'Cancela, Nexa' -> STOP_AND_LISTEN");
}

{
  const res = NexaIntentClassifier.classify("Silêncio");
  assert.strictEqual(res.action, "STOP_AND_LISTEN");
  console.log("✅ Caso 34: 'Silêncio' -> STOP_AND_LISTEN");
}

// 10. Casos de VERIFICAÇÃO DE FRASE INCOMPLETA (evita corte no meio da fala)
{
  const incomplete = NexaIntentClassifier.isSentenceIncomplete("Nexa, eu queria saber se");
  assert.strictEqual(incomplete, true, "Frase terminando em 'se' deve ser identificada como incompleta");
  console.log("✅ Caso 35: 'Nexa, eu queria saber se' -> isSentenceIncomplete = true");
}

{
  const complete = NexaIntentClassifier.isSentenceIncomplete("Nexa, como funciona polimorfismo em Java?");
  assert.strictEqual(complete, false, "Pergunta completa não deve ser considerada incompleta");
  console.log("✅ Caso 36: 'Nexa, como funciona polimorfismo em Java?' -> isSentenceIncomplete = false");
}

console.log("\n🎉 Todos os 36 testes do Intent Classifier passaram com sucesso!");
