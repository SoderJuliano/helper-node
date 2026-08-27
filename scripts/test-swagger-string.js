// scripts/test-swagger-string.js
// Testes automatizados para garantir que literais de string (ExampleObject, Swagger, blocos de texto) nunca geram sugestoes de auto-import.

const assert = require('assert');
const { extractUnresolvedSymbols } = require('../services/java/autoImport/javaSymbolExtractor.js');

console.log('=== Testando Ignoro de Strings e Swagger Examples no Auto-Import ===\n');

const javaCode = [
  'package com.example.api.controller;',
  '',
  'import org.springframework.web.bind.annotation.RestController;',
  'import io.swagger.v3.oas.annotations.media.Content;',
  'import io.swagger.v3.oas.annotations.media.ExampleObject;',
  'import io.swagger.v3.oas.annotations.responses.ApiResponse;',
  '',
  '@RestController',
  'public class TransactionController {',
  '    @ApiResponse(content = @Content(examples = @ExampleObject(value = \"{\\\"posicao\\\": \\\"DES\\\"}\")))',
  '    public ResponseEntity<String> getPosicao() {',
  '        String jsonBlock = \"\"\"',
  '        { \"posicao\": \"DES\", \"tipo\": \"SECURE\" }',
  '        \"\"\";',
  '        String pos = \"Posicao: DES\";',
  '        boolean d = ObjectUtils.isNull(pos);',
  '        return ResponseEntity.ok(\"DES\");',
  '    }',
  '}'
].join('\n');

const symbols = extractUnresolvedSymbols(javaCode);
const symbolNames = symbols.map(s => s.name);

console.log('Simbolos extraidos:', symbolNames);

// DET e pecsas de string nao devem existir
assert.strictEqual(symbolNames.includes('DES'), false, 'DES deve ser ignorado porque e uma string');
assert.strictEqual(symbolNames.includes('posicao'), false, 'posicao deve ser ignorado porque e uma string');
assert.strictEqual(symbolNames.includes('SECURE'), false, 'SECURE deve ser ignorado porque e uma string');

// Classes reais devem ser extraidas corretamente
assert.strictEqual(symbolNames.includes('ObjectUtils'), true, 'ObjectUtils deve ser reconhecido como classe para import');
assert.strictEqual(symbolNames.includes('ResponseEntity'), true, 'ResponseEntity deve ser reconhecido como classe para import');

console.log('\nok   Strings literais e swagger examples foram 100% ignorados, e classes reais extraidas corretamente.');
