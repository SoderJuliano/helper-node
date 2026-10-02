// scripts/test-preference-memory-jsonl.js
// Teste de validação para Memória Ativa de Preferências & Feedback Loop (JSONL).

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

// 1. Configura diretório temporário para isolamento do teste
const testKnowledgeDir = path.join(os.tmpdir(), `test-helper-memory-${Date.now()}`);
fs.mkdirSync(testKnowledgeDir, { recursive: true });
const testJsonlPath = path.join(testKnowledgeDir, 'active_memory.jsonl');

const preferenceMemory = require('../services/preferenceMemoryService');
// Sobrescreve getFilePath para o teste
const originalGetFilePath = preferenceMemory.getFilePath;
preferenceMemory.getFilePath = () => testJsonlPath;

console.log('🧪 Iniciando testes de Memória Ativa (JSONL & Human-in-the-Loop)...');

try {
  // Teste 1: Append de entrada de correção (Human-in-the-Loop)
  const entry1 = preferenceMemory.appendEntry({
    prompt: 'Qual a versão do Java suportada no módulo de pagamentos?',
    rejected: 'O módulo utiliza Java 17.',
    chosen: 'No módulo de pagamentos migramos para Java 21 em 2026.',
    feedback: 'correction',
    model: 'qwen2.5-coder:7b',
    tags: ['java', 'pagamentos'],
  });

  assert(entry1, 'Entrada 1 deve ser criada');
  assert.strictEqual(entry1.feedback, 'correction');
  assert.strictEqual(entry1.chosen, 'No módulo de pagamentos migramos para Java 21 em 2026.');
  assert(fs.existsSync(testJsonlPath), 'Arquivo JSONL deve existir');

  // Teste 2: Append de entrada positiva (Golden Example)
  const entry2 = preferenceMemory.appendEntry({
    prompt: 'Como configurar o connection pool do HikariCP no Spring Boot?',
    chosen: 'Defina spring.datasource.hikari.maximum-pool-size=20 no application.yml.',
    feedback: 'positive',
    model: 'llama3.3:8b',
  });

  assert(entry2, 'Entrada 2 deve ser criada');
  assert.strictEqual(preferenceMemory.getEntryCount(), 2, 'Deve conter 2 registros');

  // Teste 3: Leitura e integridade das linhas no JSONL
  const allEntries = preferenceMemory.getAllEntries();
  assert.strictEqual(allEntries.length, 2);
  assert.strictEqual(allEntries[0].prompt, 'Qual a versão do Java suportada no módulo de pagamentos?');
  assert.strictEqual(allEntries[1].feedback, 'positive');

  // Teste 4: Recuperação por similaridade/palavras-chave (Retrieval)
  const query1 = 'versão do Java no modulo de pagamentos';
  const retrieved = preferenceMemory.retrieve(query1, { topK: 2 });
  assert(retrieved.length >= 1, 'Deve encontrar pelo menos 1 match relevante');
  assert.strictEqual(retrieved[0].id, entry1.id, 'O match mais relevante deve ser a entrada 1');

  // Teste 5: Construção do bloco de contexto para o prompt do LLM
  const promptBlock = preferenceMemory.buildPromptBlock(retrieved);
  assert(promptBlock.includes('[MEMÓRIA ATIVA DE PREFERÊNCIAS & CORREÇÕES DO USUÁRIO (JSONL)]'), 'Deve conter cabeçalho');
  assert(promptBlock.includes('Java 21 em 2026'), 'Deve conter fato corrigido');
  assert(promptBlock.includes('NÃO REPETIR'), 'Deve conter diretiva anti-repetição de rejeitados');

  // Teste 6: Detecção de comandos explícitos de memorização
  const cmd1 = 'salve na sua memória que a porta do redis é 6380';
  const parsed1 = preferenceMemory.detectExplicitMemoryCommand(cmd1);
  assert(parsed1 && parsed1.isExplicit, 'Deve detectar comando de salvar memória');
  assert.strictEqual(parsed1.fact, 'a porta do redis é 6380');

  const cmd2 = 'lembre-se que usamos Postgres 16 em produção';
  const parsed2 = preferenceMemory.detectExplicitMemoryCommand(cmd2);
  assert(parsed2 && parsed2.isExplicit, 'Deve detectar comando lembre-se que');
  assert.strictEqual(parsed2.fact, 'usamos Postgres 16 em produção');

  const regularQuery = 'Como criar um controller REST no Spring?';
  const parsedRegular = preferenceMemory.detectExplicitMemoryCommand(regularQuery);
  assert.strictEqual(parsedRegular, null, 'Pergunta comum não deve ser detectada como comando explícito');

  // Teste 7: Configuração de ligar/desligar memória ativa
  const configService = require('../services/configService');
  const initialCfg = configService.getPreferenceMemoryConfig();
  assert(initialCfg.enabled !== undefined, 'Deve conter propriedade enabled');

  configService.setPreferenceMemoryConfig({ enabled: false });
  assert.strictEqual(configService.getPreferenceMemoryConfig().enabled, false);

  configService.setPreferenceMemoryConfig({ enabled: true });
  assert.strictEqual(configService.getPreferenceMemoryConfig().enabled, true);

  console.log('✅ Todos os testes de Memória Ativa JSONL passaram com 100% de sucesso!');
} finally {
  // Limpeza
  preferenceMemory.getFilePath = originalGetFilePath;
  try {
    fs.rmSync(testKnowledgeDir, { recursive: true, force: true });
  } catch (_) {}
}
