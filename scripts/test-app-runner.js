// scripts/test-app-runner.js
// Testes unitários para o módulo App Runner (JavaParser, BuildToolDetector, JdkDetector, IntelliJConfigExtractor, AppRunnerService)

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

console.log('=== Testando Módulo App Runner (IntelliJ-Style Java & Build Tools) ===\n');

// 1. Testes do JavaParser
console.log('1. Testando JavaParser (main methods, Spring Boot e JUnit tests)...');

const springBootSample = `
package com.example.demo;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;

@SpringBootApplication
public class DemoApplication {

    public static void main(String[] args) {
        SpringApplication.run(DemoApplication.class, args);
    }

    public void someHelper() {
        System.out.println("helper");
    }
}
`;

const parsedSpring = JavaParser.parse(springBootSample, 'DemoApplication.java');
assert.strictEqual(parsedSpring.packageName, 'com.example.demo');
assert.strictEqual(parsedSpring.className, 'DemoApplication');
assert.strictEqual(parsedSpring.fullClassName, 'com.example.demo.DemoApplication');
assert.strictEqual(parsedSpring.isSpringBoot, true);
assert.strictEqual(parsedSpring.mainMethods.length, 1);
assert.strictEqual(parsedSpring.mainMethods[0].line, 10);
assert.strictEqual(parsedSpring.mainMethods[0].isSpringBoot, true);
console.log('  ok   JavaParser detectou Spring Boot main() e classe com precisão de linha');

const junitSample = `
package com.example.demo.service;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.params.ParameterizedTest;

public class PaymentServiceTest {

    @Test
    @DisplayName("Deve processar pagamento com sucesso")
    void testProcessPayment() {
        assert(true);
    }

    @ParameterizedTest
    void testWithParams(String input) {
        assert(input != null);
    }

    private void helper() {}
}
`;

const parsedJunit = JavaParser.parse(junitSample, 'src/test/java/PaymentServiceTest.java');
assert.strictEqual(parsedJunit.packageName, 'com.example.demo.service');
assert.strictEqual(parsedJunit.className, 'PaymentServiceTest');
assert.strictEqual(parsedJunit.isTestClass, true);
assert.strictEqual(parsedJunit.testMethods.length, 2);
assert.strictEqual(parsedJunit.testMethods[0].name, 'testProcessPayment');
assert.strictEqual(parsedJunit.testMethods[0].line, 10); // Linha da anotação @Test
assert.strictEqual(parsedJunit.testMethods[1].name, 'testWithParams');
assert.strictEqual(parsedJunit.testMethods[1].line, 16); // Linha da anotação @ParameterizedTest
console.log('  ok   JavaParser detectou métodos @Test e @ParameterizedTest com linhas para a calha');

// 2. Testes do BuildToolDetector
console.log('2. Testando BuildToolDetector...');

// Simulação de projeto Gradle
const mockGradleInfo = {
  type: 'gradle',
  tool: 'gradle',
  hasWrapper: true,
  wrapperCmd: 'C:/mock/project/gradlew.bat',
  fallbackCmd: 'gradle.bat',
  isSpringBoot: true,
  projectDir: 'C:/mock/project',
};

const gradleAppCmd = BuildToolDetector.buildCommand(mockGradleInfo, { kind: 'app', isSpringBoot: true });
assert.strictEqual(gradleAppCmd.executable, 'C:/mock/project/gradlew.bat');
assert.deepStrictEqual(gradleAppCmd.args, ['bootRun', '--console=plain']);

const gradleTestMethodCmd = BuildToolDetector.buildCommand(mockGradleInfo, {
  kind: 'test-method',
  testClass: 'com.example.PaymentServiceTest',
  testMethod: 'testProcessPayment',
});
assert.strictEqual(gradleTestMethodCmd.executable, 'C:/mock/project/gradlew.bat');
assert.deepStrictEqual(gradleTestMethodCmd.args, ['test', '--tests', 'com.example.PaymentServiceTest.testProcessPayment', '--info', '--console=plain']);
console.log('  ok   BuildToolDetector gerou comandos Gradle com unbuffered --console=plain');

// Simulação de projeto Maven
const mockMavenInfo = {
  type: 'maven',
  tool: 'maven',
  hasWrapper: true,
  wrapperCmd: 'C:/mock/maven-project/mvnw.cmd',
  fallbackCmd: 'mvn.cmd',
  isSpringBoot: true,
  projectDir: 'C:/mock/maven-project',
};

const mavenAppCmd = BuildToolDetector.buildCommand(mockMavenInfo, { kind: 'app', isSpringBoot: true });
assert.strictEqual(mavenAppCmd.executable, 'C:/mock/maven-project/mvnw.cmd');
assert.deepStrictEqual(mavenAppCmd.args, ['-B', 'spring-boot:run']);

const mavenTestMethodCmd = BuildToolDetector.buildCommand(mockMavenInfo, {
  kind: 'test-method',
  testClass: 'PaymentServiceTest',
  testMethod: 'testProcessPayment',
});
assert.strictEqual(mavenTestMethodCmd.executable, 'C:/mock/maven-project/mvnw.cmd');
assert.deepStrictEqual(mavenTestMethodCmd.args, ['-B', 'test', '-Dtest=PaymentServiceTest#testProcessPayment']);
console.log('  ok   BuildToolDetector gerou comandos Maven com batch mode -B');

// 3. Testes do IntelliJConfigExtractor
console.log('3. Testando IntelliJConfigExtractor...');
const mockIdeaDir = path.join(__dirname, 'mock_idea_test');
const ideaSubDir = path.join(mockIdeaDir, '.idea');
fs.mkdirSync(ideaSubDir, { recursive: true });

const mockWorkspaceXml = `
<project version="4">
  <component name="RunManager">
    <configuration name="DemoApp" type="SpringBootApplicationConfigurationType">
      <option name="VM_PARAMETERS" value="-Dspring.profiles.active=dev -Xmx512m" />
      <envs>
        <env name="SPRING_PROFILES_ACTIVE" value="dev" />
        <env name="SERVER_PORT" value="8085" />
        <env name="DB_HOST" value="localhost" />
      </envs>
    </configuration>
  </component>
</project>
`;
fs.writeFileSync(path.join(ideaSubDir, 'workspace.xml'), mockWorkspaceXml, 'utf8');

const extracted = IntelliJConfigExtractor.extractEnv(mockIdeaDir);
assert.strictEqual(extracted.envs.SPRING_PROFILES_ACTIVE, 'dev');
assert.strictEqual(extracted.envs.SERVER_PORT, '8085');
assert.strictEqual(extracted.envs.DB_HOST, 'localhost');
assert(extracted.vmOptions.includes('-Dspring.profiles.active=dev'));

const effective = IntelliJConfigExtractor.getEffectiveEnv(mockIdeaDir);
assert.strictEqual(effective.SERVER_PORT, '8085');
console.log('  ok   IntelliJConfigExtractor extraiu variáveis e sincronizou env.json');

// Limpeza da pasta mock
fs.rmSync(mockIdeaDir, { recursive: true, force: true });

// 4. Testes do JdkDetector
console.log('4. Testando JdkDetector...');
const jdks = JdkDetector.detectAll();
console.log(`  info JDKs encontradas: ${jdks.length}`);
if (jdks.length > 0) {
  console.log(`  info Melhor JDK detectada: ${jdks[0].version} (${jdks[0].homePath}) via ${jdks[0].source}`);
}
assert(Array.isArray(jdks), 'detectAll deve retornar um array de JDKs');
console.log('  ok   JdkDetector executou busca sem erros');

// 5. Testes da Fachada AppRunnerService
console.log('5. Testando AppRunnerService...');
const status = AppRunnerService.getStatus();
assert.strictEqual(status.status, 'idle');
console.log('  ok   AppRunnerService status inicial é "idle"');

console.log('\nTodos os testes unitários do App Runner passaram com sucesso! 🎉\n');
