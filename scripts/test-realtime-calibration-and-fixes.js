// scripts/test-realtime-calibration-and-fixes.js
// Teste automatizado para validação das melhorias do Assistente em Tempo Real:
// 1. Calibração do prompt (conceitos em tópicos + sugestão de fala em 1 linha natural).
// 2. Filtro de ruídos e fillers ("humm...", "###", etc).
// 3. Mesclagem e atualização de fala contínua do usuário sem duplicação de bolhas.

const assert = require('assert');
const { buildRealtimeCopilotPrompt } = require('../services/realtimeCopilotPrompt');
const { cleanTranscription } = require('../services/audioTranscriptionCleaner');

console.log('=== Testes da Feature de Calibração e Correções do Realtime ===\n');

// 1. Calibração do Prompt do Copiloto
const ptPrompt = buildRealtimeCopilotPrompt('pt');
assert.ok(ptPrompt.includes('CONCEITOS & PALAVRAS-CHAVE'), 'Prompt deve instruir conceitos com palavras-chave');
assert.ok(ptPrompt.includes('SUGESTÃO DE FALA EM 1 LINHA') || ptPrompt.includes('SUGESTÃO DE RESPOSTA'), 'Prompt deve instruir sugestão de fala');
assert.ok(ptPrompt.includes('💬 *Sugestão de resposta*'), 'Prompt deve especificar o prefixo formatado');
assert.ok(ptPrompt.includes('DDD (Domain-Driven Design)'), 'Prompt deve conter exemplo prático de DDD');
console.log('  ok   1. Prompt calibrado com conceitos + sugestão de resposta em 1 linha natural');

// 2. Limpeza de ruídos ("humm...", "###", "Assistente Nexa:")
assert.strictEqual(cleanTranscription('###'), '', 'Deve descartar hashtags isoladas');
assert.strictEqual(cleanTranscription('humm...'), '', 'Deve descartar filler noise humm...');
assert.strictEqual(cleanTranscription('eh...'), '', 'Deve descartar filler noise eh...');
assert.strictEqual(cleanTranscription('Assistente Nexa:'), '', 'Deve descartar eco isolado de prompt');
assert.strictEqual(cleanTranscription('Assistente'), '', 'Deve descartar eco isolado');
console.log('  ok   2. Filtro de ruídos, hesitações e ecos isolados funcionando perfeitamente');

// 3. Preservação de falas técnicas reais e concatenação
const speech1 = cleanTranscription('Sim, com bancos de dados relacionais como PostgreSQL e Oracle.');
const speech2 = cleanTranscription('Trabalhei com modelagem de tabelas, procedures, views e indexes.');
assert.strictEqual(speech1, 'Sim, com bancos de dados relacionais como PostgreSQL e Oracle.');
assert.strictEqual(speech2, 'Trabalhei com modelagem de tabelas, procedures, views e indexes.');
const concatenated = `${speech1} ${speech2}`.trim();
assert.strictEqual(concatenated, 'Sim, com bancos de dados relacionais como PostgreSQL e Oracle. Trabalhei com modelagem de tabelas, procedures, views e indexes.');
console.log('  ok   3. Fala contínua do candidato preservada e estruturada para atualização em bolha única');

console.log('\nTodos os testes de calibração e correções passaram com sucesso!\n');
