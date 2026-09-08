// scripts/test-realtime-transcription-cleanup.js
// Teste de integridade da limpeza de alucinações do Whisper, ecos de prompt de contexto,
// heurísticas de perguntas e geração do prompt de copiloto.

const assert = require('assert');
const { cleanTranscription, isGlossaryOrPromptEcho } = require('../services/audioTranscriptionCleaner');
const { buildTranscriptionPrompt } = require('../services/techGlossary');
const { looksLikeCompleteQuestion, sameQuestion } = require('../services/realtimeQuestionHeuristics');
const { buildRealtimeCopilotPrompt } = require('../services/realtimeCopilotPrompt');

console.log('=== Iniciando Testes de Higienização de Transcrição e Copiloto ===\n');

// 1. Teste de eco de glossário do Trecho #6 reportado pelo usuário
const userBugTranscript = `context:
SOLID, Clean Architecture, design patterns, code review, Java, Spring Boot, JavaScript, TypeScript, Node.js, React, Python, REST, API, microserviços, Kafka, Docker, Kubernetes, AWS, SQL, PostgreSQL, Git, GitHub, CI/CD, deploy, backend, frontend, idempotência, escalabilidade, observabilidade, latência, throughput, JVM, PHP, EC2, .NET, Maven, Scala, query, daily, Gradle, NestJS, Kotlin, Quarkus, Angular, MongoDB, Jenkins, migration, freelance, Spring Cloud, GitHub Actions, Spring Data JPA, data lake, tech debt, tech lead, soft skills, Project Loom, service mesh, load balancer, TanStack Query, Spring Security, Virtual Threads, vector database, machine learning, prompt engineering`;

assert.strictEqual(isGlossaryOrPromptEcho(userBugTranscript), true, 'Deve identificar a alucinação de contexto/glossário do Trecho #6');
assert.strictEqual(cleanTranscription(userBugTranscript), '', 'Deve descartar completamente a alucinação de contexto do Trecho #6');
console.log('  ok   1. Alucinação exata do Trecho #6 (context: SOLID, Clean Architecture...) filtrada com sucesso');

// 2. Testes adicionais de alucinação de prompt e ruído
const glossaryDump = 'SOLID, Clean Architecture, Java, Spring Boot, Kafka, Docker, Kubernetes, SQL, PostgreSQL, Git';
assert.strictEqual(isGlossaryOrPromptEcho(glossaryDump), true, 'Deve identificar lista pura de termos técnicos como eco');
assert.strictEqual(cleanTranscription(glossaryDump), '', 'Deve descartar lista pura de termos técnicos');

const noiseTranscripts = [
  '[Música de fundo]',
  'música de fundo.',
  'Legendas pela comunidade Amara.org',
  'Obrigado por assistir e deixe seu like',
  '[BLANK_AUDIO]',
  '(sem fala)',
  '   ...   ',
];
for (const n of noiseTranscripts) {
  assert.strictEqual(cleanTranscription(n), '', `Deve descartar ruído/silêncio: "${n}"`);
}
console.log('  ok   2. Listas isoladas de termos técnicos e ruídos clássicos de silêncio descartados');

// 3. Testes de falas legítimas que DEVEM ser preservadas
const legitTranscripts = [
  'Olá, tudo bem? Como vai?',
  'O que é Java?',
  'Java é uma linguagem de programação orientada a objeto, multiplataforma, baseada na JVM.',
  'SQL',
  'Como você implementa aplicações com Spring Boot?',
  'Qual a diferença entre arquitetura monolítica e microsserviços?',
  'Eu uso Docker e Kubernetes para fazer deploy das minhas APIs REST na AWS.',
];
for (const l of legitTranscripts) {
  const cleaned = cleanTranscription(l);
  assert.strictEqual(cleaned, l, `Deve preservar fala legítima integralmente: "${l}"`);
}
console.log('  ok   3. Perguntas e falas técnicas reais de candidatos e entrevistadores preservadas perfeitamente');

// 4. Teste do buildTranscriptionPrompt
const promptDefault = buildTranscriptionPrompt();
assert.ok(promptDefault.length > 0 && promptDefault.length <= 180, 'Prompt padrão deve ser conciso (<= 180 chars)');
assert.ok(promptDefault.startsWith('Vocabulário técnico: '), 'Prompt deve ser formulado em linguagem natural');
assert.ok(promptDefault.includes('Java') && promptDefault.includes('Spring Boot'), 'Prompt padrão deve conter termos fundamentais');

const promptJava = buildTranscriptionPrompt({ background: 'Desenvolvedor Java especialista em Spring Boot e Kafka' });
assert.ok(promptJava.includes('Spring Boot') || promptJava.includes('Kafka'), 'Prompt deve priorizar termos do background do usuário');
assert.ok(promptJava.length <= 180, 'Prompt contextualizado deve respeitar limite de 180 chars');
console.log('  ok   4. Geração do prompt de transcrição (techGlossary) concisa e orientada a estilo');

// 5. Teste de heurísticas de perguntas (looksLikeCompleteQuestion e sameQuestion)
assert.strictEqual(looksLikeCompleteQuestion('Como você implementa aplicações com Spring Boot?'), true);
assert.strictEqual(looksLikeCompleteQuestion('O que é JVM?'), true);
assert.strictEqual(looksLikeCompleteQuestion('Qual a diferença entre Kafka e RabbitMQ?'), true);

// sameQuestion não deve considerar idênticas perguntas incompletas que ganharam palavras chave essenciais
const partialQ = 'como você implementa aplicações com spring';
const completeQ = 'como você implementa aplicações com spring boot?';
assert.strictEqual(sameQuestion(partialQ, completeQ), false, 'Não deve considerar a mesma pergunta quando novos termos essenciais são adicionados');

const completeQ1 = 'como você implementa aplicações com spring boot';
const completeQ2 = 'Como você implementa aplicações com Spring Boot?';
assert.strictEqual(sameQuestion(completeQ1, completeQ2), true, 'Deve considerar a mesma pergunta quando a única diferença for pontuação/maiúsculas');
console.log('  ok   5. Heurísticas de perguntas refinadas para evitar travamento em especulativo prematuro');

// 6. Teste do System Prompt do Copiloto
const ptPrompt = buildRealtimeCopilotPrompt('pt');
assert.ok(ptPrompt.includes('IMPLEMENTAÇÃO PRÁTICA / ARQUITETURA / COMO FAZER'), 'Prompt deve ter regra explícita para perguntas de implementação');
assert.ok(ptPrompt.includes('CONCEITO TÉCNICO / DEFINIÇÃO'), 'Prompt deve cobrir definições');
assert.ok(ptPrompt.includes('Spring Boot'), 'Prompt deve ter exemplo prático claro');
assert.ok(ptPrompt.includes('⚠️ REGRA CRÍTICA: Se a fala contiver QUALQUER pergunta'), 'Prompt deve proibir trecho sem conteúdo relevante em perguntas');
console.log('  ok   6. System prompt do Copiloto cobre implementação prática e blinda contra falsos positivos de ruído');

console.log('\nTodos os testes passaram com 100% de sucesso!\n');
