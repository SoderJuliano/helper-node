// scripts/test-app-runner.js
// Testes unitários para o módulo App Runner (JavaParser, BuildToolDetector, JdkDetector, AppRunnerService)

const assert = require('assert');
const path = require('path');
const fs = require('fs');

const {
  AppRunnerService,
  JdkDetector,
  BuildToolDetector,
  JavaParser,
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
  wrapperCmd: './gradlew',
  fallbackCmd: 'gradle',
  isSpringBoot: true,
  projectDir: '/mock/project',
};

const gradleAppCmd = BuildToolDetector.buildCommand(mockGradleInfo, { kind: 'app', isSpringBoot: true });
assert.strictEqual(gradleAppCmd.executable, './gradlew');
assert.deepStrictEqual(gradleAppCmd.args, ['bootRun']);

const gradleTestMethodCmd = BuildToolDetector.buildCommand(mockGradleInfo, {
  kind: 'test-method',
  testClass: 'com.example.PaymentServiceTest',
  testMethod: 'testProcessPayment',
});
assert.strictEqual(gradleTestMethodCmd.executable, './gradlew');
assert.deepStrictEqual(gradleTestMethodCmd.args, ['test', '--tests', '"com.example.PaymentServiceTest.testProcessPayment"', '--info']);
console.log('  ok   BuildToolDetector gerou comandos Gradle (bootRun e test --tests) corretamente');

// Simulação de projeto Maven
const mockMavenInfo = {
  type: 'maven',
  tool: 'maven',
  hasWrapper: true,
  wrapperCmd: './mvnw',
  fallbackCmd: 'mvn',
  isSpringBoot: true,
  projectDir: '/mock/maven-project',
};

const mavenAppCmd = BuildToolDetector.buildCommand(mockMavenInfo, { kind: 'app', isSpringBoot: true });
assert.strictEqual(mavenAppCmd.executable, './mvnw');
assert.deepStrictEqual(mavenAppCmd.args, ['spring-boot:run']);

const mavenTestMethodCmd = BuildToolDetector.buildCommand(mockMavenInfo, {
  kind: 'test-method',
  testClass: 'PaymentServiceTest',
  testMethod: 'testProcessPayment',
});
assert.strictEqual(mavenTestMethodCmd.executable, './mvnw');
assert.deepStrictEqual(mavenTestMethodCmd.args, ['test', '-Dtest=PaymentServiceTest#testProcessPayment']);
console.log('  ok   BuildToolDetector gerou comandos Maven (spring-boot:run e test -Dtest=...) corretamente');

// 3. Testes do JdkDetector
console.log('3. Testando JdkDetector...');
const jdks = JdkDetector.detectAll();
console.log(`  info JDKs encontradas: ${jdks.length}`);
if (jdks.length > 0) {
  console.log(`  info Melhor JDK detectada: ${jdks[0].version} (${jdks[0].homePath}) via ${jdks[0].source}`);
}
assert(Array.isArray(jdks), 'detectAll deve retornar um array de JDKs');
console.log('  ok   JdkDetector executou busca sem erros');

// 4. Testes da Fachada AppRunnerService
console.log('4. Testando AppRunnerService...');
const status = AppRunnerService.getStatus();
assert.strictEqual(status.status, 'idle');
console.log('  ok   AppRunnerService status inicial é "idle"');

console.log('\nTodos os testes unitários do App Runner passaram com sucesso! 🎉\n');
