/**
 * scripts/test-nexa-voice-context.js
 * Teste unitário para o Gerenciador de Contexto e Slot-Filling do Modo de Voz Nexa.
 */

const assert = require("assert");
const NexaConversationContext = require("../services/nexaVoiceAssistant/nexaConversationContext");

console.log("🧪 Iniciando testes de Nexa Conversation Context & Slot-Filling...\n");

// 1. Slot-Filling de Clima (Weather)
{
  const ctx = new NexaConversationContext({ ttlMs: 1000 });
  ctx.recordTurn("Qual é a previsão do tempo?", "Para qual cidade você gostaria de saber?");
  
  assert.strictEqual(ctx.hasActiveContext(), true);
  
  const enriched = ctx.enrichQueryWithContext("Curitiba");
  assert.strictEqual(enriched, "Qual é a previsão do tempo para Curitiba?");
  console.log("✅ Caso 1: Slot-filling de clima ('Curitiba' -> 'Qual é a previsão do tempo para Curitiba?')");
}

// 2. Expiração de TTL
{
  const ctx = new NexaConversationContext({ ttlMs: 50 });
  ctx.recordTurn("Qual é a previsão do tempo?", "Para qual cidade?");
  
  setTimeout(() => {
    assert.strictEqual(ctx.hasActiveContext(), false, "Contexto deve expirar após o TTL");
    const enriched = ctx.enrichQueryWithContext("Curitiba");
    assert.strictEqual(enriched, "Curitiba", "Sem contexto ativo, deve manter a query original");
    console.log("✅ Caso 2: Expiração de contexto via TTL");
  }, 70);
}

// 3. Slot-Filling de Download
{
  const ctx = new NexaConversationContext({ ttlMs: 1000 });
  ctx.recordTurn("Nexa, baixa um arquivo para mim", "Claro! De qual link?");
  
  const enriched = ctx.enrichQueryWithContext("https://example.com/model.glb");
  assert.strictEqual(enriched, "Baixe o arquivo da URL: https://example.com/model.glb");
  console.log("✅ Caso 3: Slot-filling de download com URL");
}

// 4. Limpeza explícita
{
  const ctx = new NexaConversationContext({ ttlMs: 5000 });
  ctx.recordTurn("Pergunta de teste", "Resposta de teste");
  ctx.clear();
  assert.strictEqual(ctx.hasActiveContext(), false);
  console.log("✅ Caso 4: Limpeza explícita de contexto (clear)");
}
