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
assert.ok(ptPrompt.includes('ANTI-DERIVA DE CONTEXTO (ANTI-DRIFT)'), 'Prompt deve conter regras anti-drift');
assert.ok(ptPrompt.includes('PRIORIDADE CRONOLÓGICA MÁXIMA'), 'Prompt deve instruir prioridade cronológica');
console.log('  ok   1. Prompt calibrado com conceitos + sugestão de resposta em 1 linha natural + anti-drift');

// 2. Limpeza de ruídos ("humm...", "###", "Assistente Nexa:")
assert.strictEqual(cleanTranscription('###'), '', 'Deve descartar hashtags isoladas');
assert.strictEqual(cleanTranscription('humm...'), '', 'Deve descartar filler noise humm...');
assert.strictEqual(cleanTranscription('eh...'), '', 'Deve descartar filler noise eh...');
assert.strictEqual(cleanTranscription('Assistente Nexa:'), '', 'Deve descartar eco isolado de prompt');
assert.strictEqual(cleanTranscription('Assistente'), '', 'Deve descartar eco isolado');
console.log('  ok   2. Filtro de ruídos, hesitações e ecos isolados funcionando perfeitamente');

// 3. Normalizações fonéticas de termos Java / Backend
const { normalizeDevPhonetics, mergeContinuationText } = require('../services/audioTranscriptionCleaner');
assert.strictEqual(normalizeDevPhonetics('Strings e lambdas.'), 'Streams e Lambdas.');
assert.strictEqual(normalizeDevPhonetics('string e lambda'), 'Streams e Lambdas');
assert.strictEqual(normalizeDevPhonetics('O que são opcional?'), 'O que são Optional?');
assert.strictEqual(normalizeDevPhonetics('quando evitar opcional'), 'quando evitar Optional');
assert.strictEqual(normalizeDevPhonetics('haximap vs haxitable'), 'HashMap vs Hashtable');
assert.strictEqual(normalizeDevPhonetics('concurrent hasmap'), 'ConcurrentHashMap');
console.log('  ok   3. Normalizações fonéticas para Streams, Lambdas, Optional e HashMaps funcionando');

// 4. Mesclagem inteligente de fala contínua (mergeContinuationText)
const merged1 = mergeContinuationText('Quando você evitaria usar cada', 'Quando você evitaria usar cada um?');
assert.strictEqual(merged1, 'Quando você evitaria usar cada um?', 'Deve deduplicar frase re-transcrita completa no 2º trecho');

const merged2 = mergeContinuationText('O que são Optional,', 'Streams e Lambdas?');
assert.strictEqual(merged2, 'O que são Optional, Streams e Lambdas?', 'Deve concatenar trechos complementares');

const merged3 = mergeContinuationText('Como implementar com Spring Boot', 'Spring Boot e Kafka?');
assert.strictEqual(merged3, 'Como implementar com Spring Boot e Kafka?', 'Deve resolver sobreposição de palavras na fronteira');

console.log('  ok   4. Mesclagem inteligente de fala contínua deduplica e preserva integridade da frase');

console.log('\nTodos os testes de calibração e correções passaram com sucesso!\n');
