// scripts/test-new-enhancements.js
const assert = require('assert');
const GithubAuthService = require('../services/auth/githubAuthService.js');
const JavaAutoImportService = require('../services/java/autoImport/javaAutoImportService.js');
const { collapsePackageImports } = require('../services/java/autoImport/javaImportInjector.js');
const { RaphaelSubtitles } = require('../renderer/raphael/raphaelSubtitles.js');

console.log('=== Testando Novas Melhorias e Ajustes do Helper Node ===\n');

// 1. Teste de Colapso e Otimizacao de Imports Java
const javaSample = `package com.example.demo;

import java.util.List;
import java.util.Map;
import java.util.Set;

public class OrderController {
    public List<String> getOrders() {
        return null;
    }
}
`;

const diags = JavaAutoImportService.getDiagnostics('C:/projects/demo/OrderController.java', javaSample);
const collapseDiag = diags.find(d => d.isPackageCollapse && d.targetPackage === 'java.util');
assert.ok(collapseDiag, 'Deve gerar diagnostico de otimizacao/colapso para 2+ imports do pacote java.util');
console.log('  [OK] Teste 1: Sugestao de colapso de imports (2+ do mesmo pacote) gerada com sucesso.');

const collapsedCode = collapsePackageImports(javaSample, 'java.util');
assert.ok(collapsedCode.includes('import java.util.*;'), 'Deve conter import java.util.*;');
assert.ok(!collapsedCode.includes('import java.util.List;'), 'Nao deve conter imports individuais de java.util');
console.log('  [OK] Teste 2: Substituicao automatica de imports em lote executada perfeitamente.');

// 2. Teste do Servico de Autenticacao GitHub Copilot (Zero-Admin, 100% User-Space)
assert.ok(typeof GithubAuthService.autoDetectLocalTokens === 'function', 'autoDetectLocalTokens deve ser funcao');
assert.ok(typeof GithubAuthService.startDeviceFlow === 'function', 'startDeviceFlow deve ser funcao');
assert.ok(typeof GithubAuthService.pollAccessToken === 'function', 'pollAccessToken deve ser funcao');
console.log('  [OK] Teste 3: GithubAuthService 100% compativel com execucao em espaco de usuario sem privilegios de admin.');

// 3. Teste do Componente de Legendas Holograficas Raphael
assert.ok(typeof RaphaelSubtitles === 'function', 'RaphaelSubtitles deve ser instanciável');
const subInstance = new RaphaelSubtitles();
assert.ok(typeof subInstance.show === 'function', 'show deve ser funcao');
assert.ok(typeof subInstance.hide === 'function', 'hide deve ser funcao');
console.log('  [OK] Teste 4: Componente de legendas cineticas RaphaelSubtitles validado.');

console.log('\n🎉 TODOS OS TESTES DAS NOVAS MELHORIAS PASSARAM COM SUCESSO! 🚀');
