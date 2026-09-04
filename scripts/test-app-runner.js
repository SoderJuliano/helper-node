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

const gradleAppCmd = BuildToolDetector.buildCommand(mockGradleInfo, { kind: 'app', isSpringBoot: true }, {
  activeProfiles: 'dev,local',
  vmOptions: '-Xmx1024m',
  programArgs: '--server.port=8082',
});
assert.strictEqual(gradleAppCmd.executable, 'C:/mock/project/gradlew.bat');
assert(gradleAppCmd.args.includes('bootRun'));
assert(gradleAppCmd.args.includes('-Dspring.profiles.active=dev,local'));
assert(gradleAppCmd.args.includes('--args=--server.port=8082'));

const gradleTestMethodCmd = BuildToolDetector.buildCommand(mockGradleInfo, {
  kind: 'test-method',
  testClass: 'com.example.PaymentServiceTest',
  testMethod: 'testProcessPayment',
}, { activeProfiles: 'test' });
assert.strictEqual(gradleTestMethodCmd.executable, 'C:/mock/project/gradlew.bat');
assert(gradleTestMethodCmd.args.includes('test'));
assert(gradleTestMethodCmd.args.includes('-Dspring.profiles.active=test'));
console.log('  ok   BuildToolDetector gerou comandos Gradle com activeProfiles, VM options e programArgs separados corretamente');

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

const mavenAppCmd = BuildToolDetector.buildCommand(mockMavenInfo, { kind: 'app', isSpringBoot: true }, {
  activeProfiles: 'dev',
  vmOptions: '-Xmx2048m',
  programArgs: '--debug',
});
assert.strictEqual(mavenAppCmd.executable, 'C:/mock/maven-project/mvnw.cmd');
assert(mavenAppCmd.args.includes('spring-boot:run'));
assert(mavenAppCmd.args.includes('-Dspring-boot.run.profiles=dev'));
assert(mavenAppCmd.args.includes('-Dspring-boot.run.jvmArguments=-Xmx2048m'));
assert(mavenAppCmd.args.includes('-Dspring-boot.run.arguments=--debug'));

const mavenTestMethodCmd = BuildToolDetector.buildCommand(mockMavenInfo, {
  kind: 'test-method',
  testClass: 'PaymentServiceTest',
  testMethod: 'testProcessPayment',
});
assert.strictEqual(mavenTestMethodCmd.executable, 'C:/mock/maven-project/mvnw.cmd');
assert.deepStrictEqual(mavenTestMethodCmd.args, ['-B', 'test', '-Dtest=PaymentServiceTest#testProcessPayment']);
console.log('  ok   BuildToolDetector gerou comandos Maven com perfis e JVM arguments');

// 3. Testes do IntelliJConfigExtractor & Custom Overrides
console.log('3. Testando IntelliJConfigExtractor e Precedência do Helper Node...');
const mockIdeaDir = path.join(__dirname, 'mock_idea_test');
const helperConfigPath = IntelliJConfigExtractor.getConfigPath(mockIdeaDir);
if (fs.existsSync(helperConfigPath)) fs.unlinkSync(helperConfigPath);
const helperLegacyPath = IntelliJConfigExtractor.getLegacyEnvPath(mockIdeaDir);
if (fs.existsSync(helperLegacyPath)) fs.unlinkSync(helperLegacyPath);

const ideaSubDir = path.join(mockIdeaDir, '.idea');
fs.mkdirSync(ideaSubDir, { recursive: true });

const mockWorkspaceXml = `
<project version="4">
  <component name="PropertiesComponent"><![CDATA[{
    "keyToString": {
      "last_opened_file_path": "C:/Projects/demo/path",
      "project.structure.last.edited": "Modules",
      "nodejs_package_manager_path": "npm"
    }
  }]]></component>
  <component name="ChatComponent">
    <map>
      <entry key="chat_12345" value="Historico de conversa da IA" />
      <entry key="ai_chat_session" value="data_session" />
      <entry key="com.github.copilot.chat.state" value="copilot_data" />
    </map>
  </component>
  <component name="RunManager">
    <configuration name="DemoApp" type="SpringBootApplicationConfigurationType">
      <option name="VM_PARAMETERS" value="-Dspring.profiles.active=dev -Xmx512m" />
      <option name="PROGRAM_PARAMETERS" value="--server.port=8085" />
      <envs>
        <env name="SPRING_PROFILES_ACTIVE" value="dev" />
        <env name="SERVER_PORT" value="8085" />
        <env name="DB_HOST" value="localhost" />
        <env name="DB_URL" value="jdbc:postgresql://localhost:5432/db?ssl=true&amp;sslmode=require" />
      </envs>
    </configuration>
    <configuration name="GradleRun" type="GradleRunConfiguration">
      <option name="env">
        <map>
          <entry key="GRADLE_ENV_VAR" value="gradle_val" />
        </map>
      </option>
    </configuration>
  </component>
</project>
`;
fs.writeFileSync(path.join(ideaSubDir, 'workspace.xml'), mockWorkspaceXml, 'utf8');
fs.writeFileSync(path.join(ideaSubDir, 'vcs.xml'), '<project version="4"><component name="VcsDirectoryMappings"><mapping directory="C:/repo" vcs="Git" /></component></project>', 'utf8');

// 3.1 Extração inicial do IntelliJ como baseline
const initialConfig = IntelliJConfigExtractor.getProjectConfig(mockIdeaDir);
assert.strictEqual(initialConfig.envVars.SERVER_PORT, '8085');
assert.strictEqual(initialConfig.envVars.DB_HOST, 'localhost');
assert.strictEqual(initialConfig.envVars.DB_URL, 'jdbc:postgresql://localhost:5432/db?ssl=true&sslmode=require', 'XML entities devem ser desescapadas');
assert.strictEqual(initialConfig.envVars.GRADLE_ENV_VAR, 'gradle_val', 'Tags <entry key="..." value="..." /> dentro de RunManager devem ser extraídas');
assert.strictEqual(initialConfig.activeProfiles, 'dev');

// Assegura que nenhuma porcaria de IDE, path do projeto ou chat de IA foi importada
assert.strictEqual(initialConfig.envVars.last_opened_file_path, undefined, 'last_opened_file_path NÃO deve ser importado');
assert.strictEqual(initialConfig.envVars['project.structure.last.edited'], undefined, 'project.structure NÃO deve ser importado');
assert.strictEqual(initialConfig.envVars.chat_12345, undefined, 'chat_12345 NÃO deve ser importado');
assert.strictEqual(initialConfig.envVars.ai_chat_session, undefined, 'ai_chat_session NÃO deve ser importado');
assert.strictEqual(initialConfig.envVars['com.github.copilot.chat.state'], undefined, 'copilot chat NÃO deve ser importado');
console.log('  ok   Baseline inicial importado do IntelliJ (.idea) com sucesso (filtrando lixos de IDE, caminhos e chat de IA)');

// 3.2 Usuário customiza no Helper Node (precedência)
IntelliJConfigExtractor.saveProjectConfig(mockIdeaDir, {
  activeProfiles: 'dev,homolog',
  env: {
    SERVER_PORT: '9090', // Override via env alias
    CUSTOM_HELPER_KEY: 'helper_val', // Nova variável
  },
  vmOptions: '-Xmx1024m',
  programArguments: '--server.port=9090',
});

const effectiveConfig = IntelliJConfigExtractor.getEffectiveConfig(mockIdeaDir);
assert.strictEqual(effectiveConfig.activeProfiles, 'dev,homolog');
assert.strictEqual(effectiveConfig.effectiveEnvs.SERVER_PORT, '9090', 'Override do Helper Node deve ter precedência');
assert.strictEqual(effectiveConfig.effectiveEnvs.CUSTOM_HELPER_KEY, 'helper_val');
assert.strictEqual(effectiveConfig.effectiveEnvs.DB_HOST, 'localhost', 'Variáveis não sobrescritas do IntelliJ devem ser mantidas se fallback ativo');
assert.strictEqual(effectiveConfig.effectiveEnvs.last_opened_file_path, undefined);
assert.strictEqual(effectiveConfig.vmOptions, '-Xmx1024m');
assert.strictEqual(effectiveConfig.programArgs, '--server.port=9090');
console.log('  ok   Customizações do Helper Node têm precedência e aliases (env, programArguments) funcionam');

// 3.3 Teste de Reimportação do IntelliJ
const reimported = IntelliJConfigExtractor.reimportFromIntelliJ(mockIdeaDir);
assert.strictEqual(reimported.envVars.DB_URL, 'jdbc:postgresql://localhost:5432/db?ssl=true&sslmode=require');
assert.strictEqual(reimported.envVars.CUSTOM_HELPER_KEY, 'helper_val', 'Variáveis customizadas do Helper Node devem ser mantidas no reimport');
assert.strictEqual(reimported.envVars.last_opened_file_path, undefined);
console.log('  ok   Reimportação do IntelliJ executada e mesclada com sucesso (mantendo apenas envs reais)');

// 3.4 Teste de Desativação Temporária de Variáveis (Checkbox / disabledEnvs)
IntelliJConfigExtractor.saveProjectConfig(mockIdeaDir, {
  disabledEnvs: ['CUSTOM_HELPER_KEY', 'DB_HOST'],
});
const configWithDisabled = IntelliJConfigExtractor.getEffectiveConfig(mockIdeaDir);
assert.strictEqual(configWithDisabled.disabledEnvs.includes('CUSTOM_HELPER_KEY'), true);
assert.strictEqual(configWithDisabled.disabledEnvs.includes('DB_HOST'), true);
assert.strictEqual(configWithDisabled.effectiveEnvs.CUSTOM_HELPER_KEY, undefined, 'Variável desmarcada NÃO deve constar nas effectiveEnvs');
assert.strictEqual(configWithDisabled.effectiveEnvs.DB_HOST, undefined, 'Variável desmarcada NÃO deve constar nas effectiveEnvs');
assert.strictEqual(configWithDisabled.effectiveEnvs.SERVER_PORT, '9090', 'Variáveis ativas continuam normalmente');

// Reativação
IntelliJConfigExtractor.saveProjectConfig(mockIdeaDir, {
  disabledEnvs: [],
});
const configReenabled = IntelliJConfigExtractor.getEffectiveConfig(mockIdeaDir);
assert.strictEqual(configReenabled.effectiveEnvs.CUSTOM_HELPER_KEY, 'helper_val', 'Variável remarcada volta a ser injetada');
console.log('  ok   Desativação temporária via checkbox (disabledEnvs) filtra a execução sem perder a variável');

// Limpeza da pasta mock
fs.rmSync(mockIdeaDir, { recursive: true, force: true });
try {
  fs.rmSync(IntelliJConfigExtractor.getHelperProjectDir(mockIdeaDir), { recursive: true, force: true });
} catch (_) {}

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

// 6. Testes do RunnerProcess (Spawn & Streaming)
console.log('6. Testando RunnerProcess spawn & streaming...');
const { RunnerProcess } = require('../services/appRunner');
const runner = new RunnerProcess();
let outputCollected = '';

runner.on('data', (chunk) => {
  outputCollected += chunk;
});

const isWin = process.platform === 'win32';
const testScript = isWin ? 'test-dummy.bat' : 'test-dummy.sh';
const testScriptPath = path.join(__dirname, testScript);
const scriptContent = isWin
  ? '@echo off\r\necho PaymentServiceTest ^> testProcessPayment() PASSED\r\necho RUNNER_TEST_OUTPUT_OK\r\n'
  : '#!/bin/sh\necho "PaymentServiceTest > testProcessPayment() PASSED"\necho RUNNER_TEST_OUTPUT_OK\n';
fs.writeFileSync(testScriptPath, scriptContent, 'utf8');
if (!isWin) fs.chmodSync(testScriptPath, 0o755);

// Cria relatório XML de teste simulado
const mockReportsDir = path.join(__dirname, 'build', 'test-results', 'test');
fs.mkdirSync(mockReportsDir, { recursive: true });
const mockXmlReport = `<?xml version="1.0" encoding="UTF-8"?>
<testsuite name="com.example.demo.service.PaymentServiceTest" tests="2" skipped="0" failures="0" errors="0" timestamp="2026-08-25T19:00:00" hostname="DESKTOP" time="0.125">
  <testcase name="testProcessPayment()" classname="com.example.demo.service.PaymentServiceTest" time="0.085"/>
  <testcase name="testWithParams(String)" classname="com.example.demo.service.PaymentServiceTest" time="0.040"/>
</testsuite>`;
fs.writeFileSync(path.join(mockReportsDir, 'TEST-com.example.demo.service.PaymentServiceTest.xml'), mockXmlReport, 'utf8');

const receivedTestEvents = [];
let receivedTestSummary = null;

runner.on('test-event', (evt) => {
  receivedTestEvents.push(evt);
});

runner.on('test-summary', (sum) => {
  receivedTestSummary = sum;
});

// Teste de reexecução / substituição de processo ativo sem erro
const runner2 = new RunnerProcess();
runner2.start({
  executable: testScriptPath,
  args: [],
  cwd: __dirname,
  runMeta: { kind: 'app', displayName: 'FirstRun' },
});
assert.strictEqual(runner2.getStatus().status, 'running');
// Inicia segundo processo imediatamente em cima do primeiro
runner2.start({
  executable: testScriptPath,
  args: [],
  cwd: __dirname,
  runMeta: { kind: 'app', displayName: 'SecondRun' },
});
assert.strictEqual(runner2.getStatus().status, 'running');
assert.strictEqual(runner2.getStatus().currentRun.displayName, 'SecondRun');
runner2.stop();
assert.strictEqual(runner2.getStatus().status, 'stopped');
console.log('  ok   RunnerProcess substitui processo em execucao automaticamente ao iniciar novo');

runner.start({
  executable: testScriptPath,
  args: [],
  cwd: __dirname,
  runMeta: { kind: 'test-class', displayName: 'DummyTest' },
});

assert.strictEqual(runner.getStatus().status, 'running');

runner.on('exit', ({ code }) => {
  try {
    fs.unlinkSync(testScriptPath);
    fs.rmSync(path.join(__dirname, 'build'), { recursive: true, force: true });
  } catch (_) {}
  assert.strictEqual(code, 0);
  assert(outputCollected.includes('RUNNER_TEST_OUTPUT_OK'));
  assert(receivedTestEvents.length > 0, 'Deve ter recebido eventos de teste');
  assert(receivedTestEvents.some(e => e.methodName === 'testProcessPayment' && e.status === 'passed'));
  assert(receivedTestSummary !== null, 'Deve ter recebido resumo de testes');
  assert.strictEqual(receivedTestSummary.passed, 2, '2 testes passaram no resumo XML');
  console.log(`  ok   RunnerProcess capturou ${receivedTestEvents.length} eventos de teste e gerou resumo: ${receivedTestSummary.passed}✓ passados`);
  console.log('  ok   RunnerProcess spawn e streaming executaram com sucesso sem ENOENT');
  console.log('\nTodos os testes unitários do App Runner passaram com sucesso! 🎉\n');
});
