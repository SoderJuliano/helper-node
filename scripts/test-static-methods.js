const assert = require('assert');
const path = require('path');
const fs = require('fs');
const os = require('os');
const symbolIndexer = require('../services/symbolIndexer.js');
const javaImportChecker = require('../services/javaImportChecker.js');

console.log('=== Testando Navegação por Ctrl+Click em Métodos Estáticos ===\n');

// 1. Teste de Métodos Estáticos Locais (JS / TS / Java / Python)
const tmpDir = path.join(os.tmpdir(), 'helper-static-test-' + Date.now());
fs.mkdirSync(tmpDir, { recursive: true });

try {
  // Arquivo JS com método estático
  const jsFile = path.join(tmpDir, 'MyUtils.js');
  fs.writeFileSync(jsFile, `
class MyUtils {
  static isEmpty(str) {
    return !str || str.length === 0;
  }
  static async processData(data) {
    return data;
  }
}
module.exports = MyUtils;
  `);

  // Arquivo Java local com métodos estáticos genéricos e estáticos simples
  const javaFile = path.join(tmpDir, 'FileUtils.java');
  fs.writeFileSync(javaFile, `
package com.test;
import java.util.Map;

public class FileUtils {
    public static boolean isBlank(String str) {
        return str == null || str.trim().isEmpty();
    }
    public static <K, V> Map<K, V> emptyMap() {
        return Map.of();
    }
}
  `);

  symbolIndexer.indexWorkspace(tmpDir);

  // A. Teste de indexação de `static isEmpty` em JS
  const jsMatches = symbolIndexer.findDefinition(jsFile, 'isEmpty', 'MyUtils.isEmpty("test")');
  assert.strictEqual(jsMatches.length > 0, true, 'Deve encontrar a definição de static isEmpty em JS');
  assert.strictEqual(jsMatches[0].symbol, 'isEmpty');
  assert.strictEqual(jsMatches[0].line, 3);
  console.log('  ok   static isEmpty em JS indexado e resolvido corretamente na linha 3');

  // B. Teste de indexação de `static async processData` em JS
  const asyncMatches = symbolIndexer.findDefinition(jsFile, 'processData', 'await MyUtils.processData(x)');
  assert.strictEqual(asyncMatches.length > 0, true, 'Deve encontrar a definição de static async processData em JS');
  assert.strictEqual(asyncMatches[0].line, 6);
  console.log('  ok   static async processData em JS indexado e resolvido corretamente na linha 6');

  // C. Teste de método estático com genéricos em Java: `emptyMap`
  const mapMatches = symbolIndexer.findDefinition(javaFile, 'emptyMap', 'Map<String, Object> m = FileUtils.emptyMap();');
  assert.strictEqual(mapMatches.length > 0, true, 'Deve encontrar a definição de método estático com genéricos <K, V>');
  assert.strictEqual(mapMatches[0].line, 9);
  console.log('  ok   public static <K, V> Map<K, V> emptyMap() indexado e resolvido na linha 9');

  // D. Teste de resolução de receptor estático: `FileUtils.isBlank`
  const isBlankMatches = symbolIndexer.findDefinition(javaFile, 'isBlank', 'if (FileUtils.isBlank(s))');
  assert.strictEqual(isBlankMatches.length > 0, true, 'Deve encontrar a definição de isBlank');
  assert.strictEqual(isBlankMatches[0].line, 6);
  console.log('  ok   FileUtils.isBlank resolvido com receptor de classe estática');

  console.log('\n  ok   suíte de navegação estática finalizada com sucesso!');
} finally {
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
}
