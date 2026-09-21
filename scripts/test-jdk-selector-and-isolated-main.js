// scripts/test-jdk-selector-and-isolated-main.js
// Testes para seleção customizada de JDK e execução de main isolado (Java 21/25+ instance main / Unnamed Classes)

const assert = require('assert');
const path = require('path');
const fs = require('fs');

const {
  AppRunnerService,
  JdkDetector,
  BuildToolDetector,
  JavaParser,
  IntelliJConfigExtractor,
} = require('../services/appRunner');

console.log('=== Testando Seleção de JDK e Execução de Main Isolado (Java 21/25+) ===\n');

// 1. Teste de detecção de Java 25+ instance main (void main() sem classe ou em classe isolada)
console.log('1. Testando JavaParser com "void main()" (Java 21/25+ Unnamed Classes e Instance Mains)...');

const unnamedClassSample = `
void main() {
    System.out.println("Hello from isolated Java 25 main test!");
}
`;

const parsedUnnamed = JavaParser.parse(unnamedClassSample, 'ScratchTest.java');
assert.strictEqual(parsedUnnamed.isSpringBoot, false, 'Unnamed class scratch NÃO deve ser Spring Boot');
assert.strictEqual(parsedUnnamed.isUnnamedClass, true, 'Deve identificar Unnamed Class');
assert.strictEqual(parsedUnnamed.mainMethods.length, 1);
assert.strictEqual(parsedUnnamed.mainMethods[0].isInstanceMain, true, 'Deve identificar instance main void main()');
assert.strictEqual(parsedUnnamed.mainMethods[0].isIsolatedMain, true, 'Deve marcar como isolated main');
assert.strictEqual(parsedUnnamed.mainMethods[0].line, 2);
console.log('  ok   void main() detectado como instance main e isolated main com linha 2');

const classicIsolatedSample = `
public class QuickMathTest {
    public static void main(String[] args) {
        int res = 2 + 2;
        System.out.println("Result: " + res);
    }
}
`;

const parsedClassic = JavaParser.parse(classicIsolatedSample, 'QuickMathTest.java');
assert.strictEqual(parsedClassic.isSpringBoot, false, 'Classe sem anotações Spring NÃO é Spring Boot');
assert.strictEqual(parsedClassic.mainMethods.length, 1);
assert.strictEqual(parsedClassic.mainMethods[0].isSpringBoot, false);
assert.strictEqual(parsedClassic.mainMethods[0].isIsolatedMain, true, 'Deve marcar como main isolado');
console.log('  ok   Main clássico em classe simples detectado como main isolado (não Spring Boot)');

const springBootProjectSample = `
package com.casasbahia.pikachu;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;

@SpringBootApplication
public class PikachuApplication {
    public static void main(String[] args) {
        SpringApplication.run(PikachuApplication.class, args);
    }
}
`;

const parsedSpringBoot = JavaParser.parse(springBootProjectSample, 'PikachuApplication.java');
assert.strictEqual(parsedSpringBoot.isSpringBoot, true, 'Deve identificar @SpringBootApplication');
assert.strictEqual(parsedSpringBoot.mainMethods[0].isSpringBoot, true);
assert.strictEqual(parsedSpringBoot.mainMethods[0].isIsolatedMain, false);
console.log('  ok   PikachuApplication com @SpringBootApplication detectada como Spring Boot app completa');

// 2. Teste do BuildToolDetector para Main Isolado vs Spring Boot
console.log('\n2. Testando BuildToolDetector para Main Isolado vs Spring Boot...');

const mockGradleDir = 'C:/projects/pikachu';
const mockGradleInfo = {
  type: 'gradle',
  tool: 'gradle',
  hasWrapper: true,
  wrapperCmd: 'C:/projects/pikachu/gradlew.bat',
  fallbackCmd: 'gradle.bat',
  isSpringBoot: true,
  projectDir: mockGradleDir,
};

const mockJdk27 = {
  id: 'C:/Users/soder/.jdks/openjdk-27',
  displayName: 'openjdk-27 java version "27"',
  majorVersion: 27,
  javaPath: 'C:/Users/soder/.jdks/openjdk-27/bin/java.exe',
  isPreviewSupported: true,
};

// 2.1 Execução de main isolado (arquivo de teste do usuário no projeto)
const isolatedCmd = BuildToolDetector.buildCommand(
  mockGradleInfo,
  {
    kind: 'isolated-main',
    isIsolatedMain: true,
    isInstanceMain: true,
    filePath: 'C:/projects/pikachu/src/test/java/ScratchTest.java',
  },
  { vmOptions: '-Xmx256m' },
  mockJdk27
);

assert.strictEqual(isolatedCmd.executable, 'C:/Users/soder/.jdks/openjdk-27/bin/java.exe', 'Deve usar o binário java do JDK selecionado');
assert(isolatedCmd.args.includes('--enable-preview'), 'Java 27 / instance main deve ter flag --enable-preview');
assert(isolatedCmd.args.includes('-Xmx256m'), 'Deve repassar VM options');
assert(isolatedCmd.args.includes('C:/projects/pikachu/src/test/java/ScratchTest.java'));
assert.strictEqual(isolatedCmd.displayName, 'ScratchTest.main() (Local)');
console.log('  ok   Comando de main isolado gerado corretamente:', isolatedCmd.fullCommand);

// 2.2 Execução do Spring Boot completo
const springBootCmd = BuildToolDetector.buildCommand(
  mockGradleInfo,
  {
    kind: 'app',
    isSpringBoot: true,
    mainClass: 'com.casasbahia.pikachu.PikachuApplication',
  },
  { activeProfiles: 'dev,local' },
  mockJdk27
);

assert.strictEqual(springBootCmd.executable, 'C:/projects/pikachu/gradlew.bat');
assert(springBootCmd.args.includes('bootRun'));
assert(springBootCmd.args.includes('-Dspring.profiles.active=dev,local'));
console.log('  ok   Comando Spring Boot completo preservado:', springBootCmd.fullCommand);

// 3. Testes do JdkDetector (descoberta assíncrona, release parsing e seleção)
console.log('\n3. Testando JdkDetector...');

const allJdks = JdkDetector.detectAll();
assert(allJdks.length > 0, 'Deve detectar JDKs instaladas na máquina');
console.log(`  ok   Detectou ${allJdks.length} JDKs instaladas no sistema:`);
allJdks.forEach(j => {
  console.log(`       - [Java ${j.majorVersion}] ${j.displayName} (${j.source})`);
});

// Teste de seleção de JDK específica
const best27 = JdkDetector.getBestJdk('openjdk-27');
assert(best27 !== null, 'Deve encontrar openjdk-27');
assert.strictEqual(best27.majorVersion, 27);

const best25 = JdkDetector.getBestJdk('ms-25.0.4.1');
assert(best25 !== null, 'Deve encontrar ms-25.0.4.1');
assert.strictEqual(best25.majorVersion, 25);

const best21 = JdkDetector.getBestJdk('jdk-21.0.11.10-hotspot');
assert(best21 !== null, 'Deve encontrar JDK 21');
assert.strictEqual(best21.majorVersion, 21);
console.log('  ok   getBestJdk resolveu com precisão JDK 27, JDK 25 e JDK 21 por preferência');

// 4. Teste de persistência de JDK no runner-config.json
console.log('\n4. Testando persistência de selectedJdkPath e selectedJdkName no IntelliJConfigExtractor...');

const mockProjectDir = path.join(__dirname, 'mock_jdk_project');
fs.mkdirSync(mockProjectDir, { recursive: true });

IntelliJConfigExtractor.saveProjectConfig(mockProjectDir, {
  selectedJdkPath: 'C:/Users/soder/.jdks/openjdk-27',
  selectedJdkName: 'openjdk-27 java version "27"',
  activeProfiles: 'local',
});

const loadedConfig = IntelliJConfigExtractor.getProjectConfig(mockProjectDir);
assert.strictEqual(loadedConfig.selectedJdkPath, 'C:/Users/soder/.jdks/openjdk-27');
assert.strictEqual(loadedConfig.selectedJdkName, 'openjdk-27 java version "27"');
assert.strictEqual(loadedConfig.activeProfiles, 'local');
console.log('  ok   selectedJdkPath e selectedJdkName foram salvos e recuperados com sucesso');

// Limpeza
fs.rmSync(mockProjectDir, { recursive: true, force: true });
try {
  fs.rmSync(IntelliJConfigExtractor.getHelperProjectDir(mockProjectDir), { recursive: true, force: true });
} catch (_) {}

console.log('\nTodos os testes de seleção de JDK e execução isolada passaram com sucesso! (sem emojis)\n');
