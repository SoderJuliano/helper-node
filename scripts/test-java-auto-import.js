// scripts/test-java-auto-import.js
// Testes unitarios para a feature de Auto-Import Java / Spring Boot no modo IDE.

const assert = require('assert');
const JavaAutoImportService = require('../services/java/autoImport/javaAutoImportService.js');
const { extractUnresolvedSymbols } = require('../services/java/autoImport/javaSymbolExtractor.js');
const { rankCandidates } = require('../services/java/autoImport/javaRanker.js');
const { injectImport } = require('../services/java/autoImport/javaImportInjector.js');
const javaImportChecker = require('../services/javaImportChecker.js');

console.log('=== Testando Modulo de Auto-Import Java & Spring Boot (IntelliJ-Style) ===\n');

// 1. Teste de Extracao de Simbolos
const javaSample = `
package com.example.demo;

// import java.util.List; -- comentario nao deve contar
import java.util.List;

public class UserController {
    private ArrayList<String> positions;

    @Autowired
    private UserService userService;

    @GetMapping("/users")
    public ResponseEntity<List<UserDto>> listUsers() {
        Arrays.stream(new String[] { "test" });
        Objects.requireNonNull(positions);
        return ResponseEntity.ok().body(userService.findAll());
    }
}
`;

const symbols = extractUnresolvedSymbols(javaSample);
const symNames = symbols.map(s => s.name);

assert(symNames.includes('ArrayList'), 'ArrayList deve ser detectado');
assert(symNames.includes('Autowired'), '@Autowired deve ser detectado');
assert(symNames.includes('GetMapping'), '@GetMapping deve ser detectado');
assert(symNames.includes('ResponseEntity'), 'ResponseEntity deve ser detectado');
assert(symNames.includes('Arrays'), 'Arrays deve ser detectado');
assert(symNames.includes('Objects'), 'Objects deve ser detectado');
assert(!symNames.includes('List'), 'List ja esta importado e NAO deve estar nas pendencias');
assert(!symNames.includes('String'), 'String e do java.lang e NAO deve estar nas pendencias');
assert(!symNames.includes('UserController'), 'UserController e a propria classe declarada');
console.log('  ok   JavaSymbolExtractor extraiu simbolos com precisao (ignorando java.lang, imports existentes e classe local)');

// 2. Teste de Ranking & Priorizacao (Spring Boot & JDK)
const autowiredSuggestions = rankCandidates('Autowired');
assert.equal(autowiredSuggestions[0].fqn, 'org.springframework.beans.factory.annotation.Autowired');

const restControllerSuggestions = rankCandidates('RestController');
assert.equal(restControllerSuggestions[0].fqn, 'org.springframework.web.bind.annotation.RestController');

const arrayListSuggestions = rankCandidates('ArrayList');
assert.equal(arrayListSuggestions[0].fqn, 'java.util.ArrayList');

const arraysSuggestions = rankCandidates('Arrays');
assert.equal(arraysSuggestions[0].fqn, 'java.util.Arrays');

const dateSuggestions = rankCandidates('Date');
assert.equal(dateSuggestions[0].fqn, 'java.util.Date', 'java.util.Date deve ter precedencia sobre java.sql.Date');

console.log('  ok   JavaRanker prioriza Spring Boot e Core Java precisamente como no IntelliJ');

// 3. Teste de Injecao de Imports (sorted, grouped, deduplicated)
const initialCode = `
package com.example.demo;

import java.util.List;

public class Test {}
`;

const updated = injectImport(initialCode, 'java.util.ArrayList');
assert(updated.includes('import java.util.ArrayList;'), 'Deve incluir ArrayList');
assert(updated.includes('import java.util.List;'), 'Deve preservar List');
assert(updated.indexOf('ArrayList') < updated.indexOf('List;'), 'ArrayList deve estar ordenado alfabeticamente antes de List');

// Injeta Novamente (deve ignorar porque ja existe)
const reinjected = injectImport(updated, 'java.util.ArrayList');
assert.equal(reinjected, updated, 'Import duplicado deve ser ignorado');
console.log('  ok   JavaImportInjector insere imports ordenados e evita duplicacao');

// 4. Teste do Servico Auto-Import e Diagnosticos
const filePath = 'C:/projects/demo/src/main/java/com/example/demo/UserController.java';
const diags = JavaAutoImportService.getDiagnostics(filePath, javaSample);
assert(diags.length >= 3, 'Deve gerar diagnosticos para ArrayList, Autowired, GetMapping, ResponseEntity, Arrays');

const arrayListDiag = diags.find(d => d.symbolName === 'ArrayList');
assert(arrayListDiag, 'Diagnostico de ArrayList deve existir');
assert.equal(arrayListDiag.recommendedFqnk || arrayListDiag.suggestions[0], 'java.util.ArrayList');
assert(arrayListDiag.line > 0 && arrayListDiag.col > 0, 'Linha e coluna devem ser validas');

const allDiags = javaImportChecker.getDiagnostics(filePath, javaSample);
assert(allDiags.some(d => d.symbolName === 'ArrayList'), 'javaImportChecker deve retornar auto-imports');
console.log('  ok   JavaAutoImportService e javaImportChecker geram diagnosticos com sugestoes prontas para o CodeMirror');

console.log('\nTodos os testes do Auto-Import Java & Spring Boot passaram com sucesso! ί\n\ninfo: Feature pronta para uso no modo IDE.');
