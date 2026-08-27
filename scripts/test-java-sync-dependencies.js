// scripts/test-java-sync-dependencies.js
// Testes para deteccao e reindexacao / sincronizacao de dependencias Maven e Gradle.

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { detectProjectType, clearCacheForProject, syncDependencies } = require('../services/java/javaSyncDependencies.js');
const javaImportChecker = require('../services/javaImportChecker.js');

console.log('=== Testando Deteccao e Sincronizacao de Dependencias Java (Maven / Gradle) ===\n');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'helper-sync-test-'));

try {
  // 1. Teste do Maven
  const mavenDir = path.join(tmpDir, 'my-maven-project');
  fs.mkdirSync(mavenDir, { recursive: true });
  fs.writeFileSync(path.join(mavenDir, 'pom.xml'), '<project><groupId>com.example</groupId><artifactId>demo</artifactId><version>1.0</version></project>');

  const mavenDetected = detectProjectType(mavenDir);
  assert(mavenDetected.isJavaProject, 'Deve detectar que e um projeto Java');
  assert.equal(mavenDetected.type, 'maven', 'Deve detectar tipo Maven');
  assert(path.normalize(mavenDetected.rootDir) === path.normalize(mavenDir), 'RootDir Maven deve coincidir');
  console.log('  ok   Maven (diretorio com pom.xml) detectado com sucesso');

  // 2. Teste do Gradle
  const gradleDir = path.join(tmpDir, 'my-gradle-project');
  fs.mkdirSync(gradleDir, { recursive: true });
  fs.writeFileSync(path.join(gradleDir, 'build.gradle'), 'plugins { id "java" }');
  fs.writeFileSync(path.join(gradleDir, 'settings.gradle'), 'rootProject.name = "demo"');

  const gradleDetected = detectProjectType(gradleDir);
  assert(gradleDetected.isJavaProject, 'Deve detectar que e um projeto Java');
  assert.equal(gradleDetected.type, 'gradle', 'Deve detectar tipo Gradle');
  console.log('  ok   Gradle (diretorio com build.gradle e settings.gradle) detectado com sucesso');

  // 3. Teste de Diretorio Nao-Java
  const nonJavaDir = path.join(tmpDir, 'non-java');
  fs.mkdirSync(nonJavaDir, { recursive: true });
  const nonJavaDetected = detectProjectType(nonJavaDir);
  assert(!nonJavaDetected.isJavaProject, 'Diretorio sem pom/gradle nao deve ser projeto Java');
  console.log('  ok   Diretorio nao-Java rejeitado corretamente');

  // 4. Teste do javaImportChecker detect & sync
  assert(typeof javaImportChecker.detectProjectType === 'function', 'detectProjectType deve estar exportado');
  assert(typeof javaImportChecker.syncDependencies === 'function', 'syncDependencies deve estar exportado');
  console.log('  ok   javaImportChecker exporta metodos de deteccao e sincronizacao');

  console.log('\nTodos os testes de Deteccao e Sincronizacao passaram com sucesso! ί\n');
} finally {
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch (_) {}
}
