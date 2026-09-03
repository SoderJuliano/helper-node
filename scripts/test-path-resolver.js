// scripts/test-path-resolver.js
// Testa a resolução resiliente de caminhos no workspace (pathResolver.js).

const assert = require('assert');
const path = require('path');
const fs = require('fs');

const { resolveWorkspaceFilePath, findFileRecursively } = require('../main/helpers/pathResolver.js');

console.log('=== Testando Utilitário PathResolver (Workspace File Lookup) ===\n');

const mockProjectRoot = path.resolve(__dirname, '..');
const mockWorkspace = {
  getProjectPath: () => mockProjectRoot,
  list: () => [{ type: 'dir', path: mockProjectRoot }],
  resolvePortalPath: (p) => p,
};

// 1. Resolução de caminho com leading slash no Windows (/services/workspace/store.js)
console.log('1. Testando leading slash (/services/workspace/store.js)...');
const resLeadingSlash = resolveWorkspaceFilePath('/services/workspace/store.js', mockWorkspace);
assert.strictEqual(resLeadingSlash, path.resolve(mockProjectRoot, 'services/workspace/store.js'));
console.log('  ok   Leading slash resolvido para a pasta do projeto (evitando raiz C:\\)');

// 2. Resolução de caminho com prefixo do nome do projeto (helper-node/services/workspace/store.js)
console.log('2. Testando prefixo de pasta do projeto (helper-node/services/...)...');
const projectName = path.basename(mockProjectRoot);
const resProjectPrefix = resolveWorkspaceFilePath(`${projectName}/services/workspace/store.js`, mockWorkspace);
assert.strictEqual(resProjectPrefix, path.resolve(mockProjectRoot, 'services/workspace/store.js'));
console.log('  ok   Prefixo duplicado do projeto removido e resolvido corretamente');

// 3. Resolução de caminho com número de linha (:42 ou #L42 ou (lines 1-50))
console.log('3. Testando caminhos com sufixos de linha (:42, #L42, (lines 1-50))...');
const resColon = resolveWorkspaceFilePath('services/workspace/store.js:42', mockWorkspace);
assert.strictEqual(resColon, path.resolve(mockProjectRoot, 'services/workspace/store.js'));

const resHash = resolveWorkspaceFilePath('services/workspace/store.js#L15', mockWorkspace);
assert.strictEqual(resHash, path.resolve(mockProjectRoot, 'services/workspace/store.js'));

const resLines = resolveWorkspaceFilePath('services/workspace/store.js (lines 1-50)', mockWorkspace);
assert.strictEqual(resLines, path.resolve(mockProjectRoot, 'services/workspace/store.js'));
console.log('  ok   Sufixos de linha e intervalos removidos para abertura do arquivo');

// 4. Resolução de caminho com elipse (.../services/workspace/store.js)
console.log('4. Testando elipse (.../services/...)...');
const resEllipsis = resolveWorkspaceFilePath('.../services/workspace/store.js', mockWorkspace);
assert.strictEqual(resEllipsis, path.resolve(mockProjectRoot, 'services/workspace/store.js'));
console.log('  ok   Elipses removidas com sucesso');

// 5. Resolução rápida de arquivo por basename em subpastas comuns
console.log('5. Testando subpastas comuns e busca recursiva...');
const resDeep = resolveWorkspaceFilePath('copilot-cli/CopilotCliProcess.js', mockWorkspace);
assert.strictEqual(resDeep, path.resolve(mockProjectRoot, 'services/providers/copilot-cli/CopilotCliProcess.js'));
console.log('  ok   Busca recursiva encontrou arquivo em subdiretório profundo');

// 6. Resolução apenas com nome do arquivo sem caminho (link incompleto da IA)
console.log('6. Testando link incompleto contendo apenas o nome do arquivo (CopilotCliProcess.js)...');
const resBasenameOnly = resolveWorkspaceFilePath('CopilotCliProcess.js', mockWorkspace);
assert.strictEqual(resBasenameOnly, path.resolve(mockProjectRoot, 'services/providers/copilot-cli/CopilotCliProcess.js'));
console.log('  ok   Arquivo localizado imediatamente pelo nome no projeto');

// 7. Resolução de nome sem extensão (ex: CopilotCliProcess -> CopilotCliProcess.js)
console.log('7. Testando nome sem extensão...');
const resNoExt = resolveWorkspaceFilePath('CopilotCliProcess', mockWorkspace);
assert.strictEqual(resNoExt, path.resolve(mockProjectRoot, 'services/providers/copilot-cli/CopilotCliProcess.js'));
console.log('  ok   Extensão comum detectada e resolvida com sucesso');

// 8. Resolução de caminho absoluto incorreto no Windows (C:/wrong/path/CopilotCliProcess.js)
console.log('8. Testando caminho absoluto incorreto com letra de unidade no Windows...');
const resWrongDrive = resolveWorkspaceFilePath('C:/wrong/virtual/path/CopilotCliProcess.js', mockWorkspace);
assert.strictEqual(resWrongDrive, path.resolve(mockProjectRoot, 'services/providers/copilot-cli/CopilotCliProcess.js'));
console.log('  ok   Drive letter incorreto removido e arquivo localizado no projeto');

// 9. Resolução com nomes separados por espaço ou snake_case (ex: copilot_cli_process -> CopilotCliProcess.js)
console.log('9. Testando variação alfanumérica/snake_case...');
const resAlnum = resolveWorkspaceFilePath('copilot_cli_process', mockWorkspace);
assert.strictEqual(resAlnum, path.resolve(mockProjectRoot, 'services/providers/copilot-cli/CopilotCliProcess.js'));
console.log('  ok   Match alfanumérico flexível encontrou o arquivo');

console.log('\nTodos os testes do PathResolver passaram com sucesso! 🎉\n');
