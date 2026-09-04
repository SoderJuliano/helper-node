// scripts/test-multi-project-runner.js
// Teste de integracao e unitario para Multi-Project Workspace e Multi-Instance App Runner

const assert = require('assert');
const path = require('path');
const fs = require('fs');

const { MultiProjectService, MultiRunnerService } = require('../services/multiProject');
const { buildContextBlock } = require('../services/workspace/contextBuilder');
const store = require('../services/workspace/store');
const { IntelliJConfigExtractor } = require('../services/appRunner');

console.log('=== Testando Módulo Multi-Project Workspace & Concurrent App Runner ===\n');

const isWin = process.platform === 'win32';
const mockRootA = path.join(__dirname, 'mock_proj_a');
const mockRootB = path.join(__dirname, 'mock_proj_b');

async function runAllTests() {
  try {
    store.clear();

    fs.mkdirSync(path.join(mockRootA, 'src', 'main', 'java', 'com', 'example', 'a'), { recursive: true });
    fs.writeFileSync(path.join(mockRootA, 'pom.xml'), '<project></project>', 'utf8');
    fs.writeFileSync(path.join(mockRootA, 'src', 'main', 'java', 'com', 'example', 'a', 'AppA.java'), 'public class AppA {}', 'utf8');

    fs.mkdirSync(path.join(mockRootB, 'src', 'main', 'java', 'com', 'example', 'b'), { recursive: true });
    fs.writeFileSync(path.join(mockRootB, 'build.gradle'), '// gradle build', 'utf8');
    fs.writeFileSync(path.join(mockRootB, 'src', 'main', 'java', 'com', 'example', 'b', 'AppB.java'), 'public class AppB {}', 'utf8');

    // 1. Testes de Attach Multi-Project no Workspace
    console.log('1. Testando MultiProjectService.attachProject & listAttachedProjects...');
    
    await MultiProjectService.attachProject(mockRootA, { trustAgy: false });
    assert.strictEqual(MultiProjectService.isMultiProject(), false, 'Com 1 projeto nao e multi-project');
    
    await MultiProjectService.attachProject(mockRootB, { trustAgy: false });
    assert.strictEqual(MultiProjectService.isMultiProject(), true, 'Com 2 projetos deve ser multi-project');
    
    const roots = MultiProjectService.getProjectRoots();
    assert.strictEqual(roots.length, 2, 'Deve ter 2 roots de projetos');
    assert(roots.includes(path.resolve(mockRootA)));
    assert(roots.includes(path.resolve(mockRootB)));
    console.log('  ok   MultiProjectService anexou ambos os projetos mantendo os anteriores');

    // 2. Testes de Coleta da Arvore Multi-Project
    console.log('2. Testando MultiProjectService.collectMultiProjectEntries (Multi-Root Tree)...');
    const mockHelpers = {
      detectJavaProjectType: (p, names) => {
        if (names && names.has('pom.xml')) return 'maven';
        if (names && names.has('build.gradle')) return 'gradle';
        return null;
      },
      walkTreeInto: (entries, dirPath, depth, maxDepth, globalLimit) => {
        try {
          const list = fs.readdirSync(dirPath, { withFileTypes: true });
          for (const item of list) {
            entries.push({
              path: path.join(dirPath, item.name),
              name: item.name,
              depth,
              isDir: item.isDirectory(),
            });
          }
        } catch (_) {}
      },
      collectProjectEntries: (root) => [{ path: root, name: path.basename(root), depth: 0, isDir: true }],
    };

    const multiTree = MultiProjectService.collectMultiProjectEntries(mockHelpers);
    assert.strictEqual(multiTree.isMulti, true);
    assert.strictEqual(multiTree.roots.length, 2);
    assert(multiTree.entries.some(e => e.isRoot && e.name === 'mock_proj_a'));
    assert(multiTree.entries.some(e => e.isRoot && e.name === 'mock_proj_b'));
    assert(multiTree.entries.some(e => e.synthetic === 'java-deps' && e.javaType === 'maven'));
    assert(multiTree.entries.some(e => e.synthetic === 'java-deps' && e.javaType === 'gradle'));
    console.log('  ok   Arvore multi-raiz gerada com nos raiz separados e Dependencias Maven/Gradle independentes');

    // 3. Testes do Contexto de IA com Multi-Projeto
    console.log('3. Testando geracao de contexto de IA com Multi-Projeto...');
    const aiContext = await buildContextBlock({ modelKey: 'gpt-4.1', force: true });
    assert(aiContext !== null);
    assert(aiContext.includes('mock_proj_a'), 'Contexto deve conter mock_proj_a');
    assert(aiContext.includes('mock_proj_b'), 'Contexto deve conter mock_proj_b');
    console.log('  ok   Contexto de IA gerado com blueprints e listagens de todos os projetos anexados');

    // 4. Testes de Isolamento de Variaveis de Ambiente por Projeto
    console.log('4. Testando isolamento de runner-config.json por projeto...');
    IntelliJConfigExtractor.saveProjectConfig(mockRootA, {
      activeProfiles: 'dev-a',
      env: { SERVICE_NAME: 'service-a', PORT: '8080' },
    });
    IntelliJConfigExtractor.saveProjectConfig(mockRootB, {
      activeProfiles: 'prod-b',
      env: { SERVICE_NAME: 'service-b', PORT: '8081' },
    });

    const cfgA = IntelliJConfigExtractor.getEffectiveConfig(mockRootA);
    const cfgB = IntelliJConfigExtractor.getEffectiveConfig(mockRootB);

    assert.strictEqual(cfgA.activeProfiles, 'dev-a');
    assert.strictEqual(cfgA.effectiveEnvs.SERVICE_NAME, 'service-a');
    assert.strictEqual(cfgA.effectiveEnvs.PORT, '8080');

    assert.strictEqual(cfgB.activeProfiles, 'prod-b');
    assert.strictEqual(cfgB.effectiveEnvs.SERVICE_NAME, 'service-b');
    assert.strictEqual(cfgB.effectiveEnvs.PORT, '8081');
    console.log('  ok   Configuracoes, perfis e variaveis de ambiente 100% isoladas por projeto');

    // 5. Testes de Execução Concorrente no MultiRunnerService
    console.log('5. Testando MultiRunnerService com execucao concorrente simultanea...');
    const multiRunner = new MultiRunnerService();

    // Scripts dummy para execucao
    const scriptA = path.join(mockRootA, isWin ? 'runA.bat' : 'runA.sh');
    const scriptB = path.join(mockRootB, isWin ? 'runB.bat' : 'runB.sh');

    fs.writeFileSync(scriptA, isWin
      ? '@echo off\r\necho Tomcat started on port 8080 (http)\r\necho LOG_FROM_PROJ_A\r\n'
      : '#!/bin/sh\necho "Tomcat started on port 8080 (http)"\necho "LOG_FROM_PROJ_A"\n', 'utf8');

    fs.writeFileSync(scriptB, isWin
      ? '@echo off\r\necho Tomcat started on port 8081 (http)\r\necho LOG_FROM_PROJ_B\r\n'
      : '#!/bin/sh\necho "Tomcat started on port 8081 (http)"\necho "LOG_FROM_PROJ_B"\n', 'utf8');

    if (!isWin) {
      fs.chmodSync(scriptA, 0o755);
      fs.chmodSync(scriptB, 0o755);
    }

    const collectedLogs = { A: '', B: '' };
    const detectedPorts = { A: null, B: null };

    multiRunner.on('data', ({ runId, chunk }) => {
      if (runId.includes('mock_proj_a')) collectedLogs.A += chunk;
      if (runId.includes('mock_proj_b')) collectedLogs.B += chunk;
    });

    multiRunner.on('app-event', ({ runId, type, port }) => {
      if (type === 'server-started') {
        if (runId.includes('mock_proj_a')) detectedPorts.A = port;
        if (runId.includes('mock_proj_b')) detectedPorts.B = port;
      }
    });

    const runA = multiRunner.start(mockRootA, { kind: 'app', displayName: 'ServiceA', executable: scriptA });
    const runB = multiRunner.start(mockRootB, { kind: 'app', displayName: 'ServiceB', executable: scriptB });

    assert.notStrictEqual(runA.runId, runB.runId, 'IDs de execucao devem ser distintos');
    assert.strictEqual(multiRunner.getAllRunners().length, 2, 'Devem existir 2 runners instanciados');

    let waited = 0;
    while (waited < 3500 && (!collectedLogs.A.includes('LOG_FROM_PROJ_A') || !collectedLogs.B.includes('LOG_FROM_PROJ_B'))) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      waited += 100;
    }

    assert(collectedLogs.A.includes('LOG_FROM_PROJ_A'), 'Log de A deve ser coletado');
    assert(collectedLogs.B.includes('LOG_FROM_PROJ_B'), 'Log de B deve ser coletado');
    assert.strictEqual(detectedPorts.A, 8080, 'Porta 8080 deve ser detectada para o projeto A');
    assert.strictEqual(detectedPorts.B, 8081, 'Porta 8081 deve ser detectada para o projeto B');

    console.log('  ok   Logs e portas transmitidos e roteados simultaneamente para cada aba');

    // Testa parada individual
    multiRunner.stop(runA.runId);
    assert.strictEqual(multiRunner.getStatus(runA.runId).status, 'stopped');

    // Testa parada total
    multiRunner.stopAll();
    assert.strictEqual(multiRunner.getRunningCount(), 0);

    // Limpeza dos mocks
    try {
      fs.rmSync(mockRootA, { recursive: true, force: true });
      fs.rmSync(mockRootB, { recursive: true, force: true });
      store.clear();
    } catch (_) {}

    console.log('  ok   MultiRunnerService encerra processos individualmente e em lote');
    console.log('\nTodos os testes do Multi-Project Workspace e Multi-Runner passaram com sucesso! 🚀\n');
    process.exit(0);
  } catch (err) {
    try {
      fs.rmSync(mockRootA, { recursive: true, force: true });
      fs.rmSync(mockRootB, { recursive: true, force: true });
      store.clear();
    } catch (_) {}
    console.error('Erro nos testes:', err);
    process.exit(1);
  }
}

runAllTests();
