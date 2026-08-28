// scripts/test-gradle-nexus-properties.js
const assert = require('assert');
const path = require('path');
const fs = require('fs');
const os = require('os');
const {
  parsePropertiesFile,
  parseMavenSettings,
  getAggregatedProperties,
  getJavaProcessEnv,
  generateGradleInitScript,
} = require('../services/java/javaPropertiesBridge.js');

console.log('=== Testando Bridge de Propriedades e Credenciais Nexus / Gradle (IntelliJ Style) ===\n');

const tmpDir = path.join(os.tmpdir(), 'helper-gradle-nexus-test-' + Date.now());
fs.mkdirSync(tmpDir, { recursive: true });

try {
  // 1. Teste de parse de gradle.properties com credenciais Nexus
  const gradlePropsPath = path.join(tmpDir, 'gradle.properties');
  fs.writeFileSync(gradlePropsPath, `
# Nexus Credentials
nexusUsername=corp.user
nexusPassword=SuperSecretNexusPass123!
customProp=helloWorld
`, 'utf8');

  const parsed = parsePropertiesFile(gradlePropsPath);
  assert.strictEqual(parsed.get('nexusUsername'), 'corp.user');
  assert.strictEqual(parsed.get('nexusPassword'), 'SuperSecretNexusPass123!');
  assert.strictEqual(parsed.get('customProp'), 'helloWorld');
  console.log('  ok   parsePropertiesFile leu propriedades e credenciais com sucesso');

  // 2. Teste de agregação e cross-aliasing de chaves de senha (findProperty, nexPassword, etc.)
  const aggregated = getAggregatedProperties(tmpDir);
  assert.strictEqual(aggregated.get('nexusPassword'), 'SuperSecretNexusPass123!');
  assert.strictEqual(aggregated.get('nexUserPassword'), 'SuperSecretNexusPass123!', 'Deve auto-preencher nexUserPassword');
  assert.strictEqual(aggregated.get('nexPassword'), 'SuperSecretNexusPass123!', 'Deve auto-preencher nexPassword');
  assert.strictEqual(aggregated.get('nexus_password'), 'SuperSecretNexusPass123!', 'Deve auto-preencher nexus_password');
  assert.strictEqual(aggregated.get('findPropertyPassword'), 'SuperSecretNexusPass123!', 'Deve auto-preencher findPropertyPassword');
  assert.strictEqual(aggregated.get('nexusUsername'), 'corp.user');
  assert.strictEqual(aggregated.get('nexUser'), 'corp.user', 'Deve auto-preencher nexUser');
  console.log('  ok   getAggregatedProperties realizou cross-aliasing de todas as variantes de senha e usuario do Nexus');

  // 3. Teste de geração de environment para processos Java/Gradle
  const { env, bestJdk } = getJavaProcessEnv(tmpDir);
  assert.strictEqual(env.ORG_GRADLE_PROJECT_nexusPassword, 'SuperSecretNexusPass123!');
  assert.strictEqual(env.ORG_GRADLE_PROJECT_nexUserPassword, 'SuperSecretNexusPass123!');
  assert.strictEqual(env.ORG_GRADLE_PROJECT_nexPassword, 'SuperSecretNexusPass123!');
  assert(env.JAVA_HOME || process.env.JAVA_HOME || bestJdk, 'Deve configurar JAVA_HOME no ambiente');
  console.log('  ok   getJavaProcessEnv injetou variaveis ORG_GRADLE_PROJECT_* e JAVA_HOME');

  // 4. Teste do init script do Gradle
  const outPrefix = path.join(tmpDir, 'cp-out-');
  const initScript = generateGradleInitScript(outPrefix, tmpDir);
  assert(initScript.includes('SuperSecretNexusPass123!'), 'Init script deve conter a senha injetada');
  assert(initScript.includes('helperIdePrintClasspath'), 'Init script deve conter a task helperIdePrintClasspath');
  assert(initScript.includes('proj.ext.set'), 'Init script deve injetar nas properties ext de todos os projetos');
  console.log('  ok   generateGradleInitScript gerou script de inicializacao com injecao global de credenciais');

  // 5. Teste de parse de settings.xml do Maven
  const mavenSettingsPath = path.join(tmpDir, 'settings.xml');
  fs.writeFileSync(mavenSettingsPath, `
<settings>
  <servers>
    <server>
      <id>nexus-releases</id>
      <username>mvn.user</username>
      <password>MvnSecretPass456</password>
    </server>
  </servers>
</settings>
`, 'utf8');
  const mavenParsed = parseMavenSettings(mavenSettingsPath);
  assert.strictEqual(mavenParsed.servers.length, 1);
  assert.strictEqual(mavenParsed.servers[0].username, 'mvn.user');
  assert.strictEqual(mavenParsed.servers[0].password, 'MvnSecretPass456');
  console.log('  ok   parseMavenSettings extraiu credenciais de servidores Maven/Nexus com sucesso');

  console.log('\nTodos os testes do Bridge Nexus/Gradle passaram com sucesso! 🎉\n');
} finally {
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch (_) {}
}
