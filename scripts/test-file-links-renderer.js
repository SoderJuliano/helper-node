// scripts/test-file-links-renderer.js
// Testa a renderização de links de arquivos, ações Edit/Read do Copilot CLI e utilitários de path.

const assert = require('assert');
const fs = require('fs');
const path = require('path');

console.log('=== Testando Renderizador de Links de Arquivos e Ações Edit/Read ===\n');

// Carrega o módulo de renderização de markdown simulando o ambiente de window
const markdownRendererCode = fs.readFileSync(path.join(__dirname, '../renderer/markdownRenderer.js'), 'utf8');

const mockWindow = {
  electronAPI: {
    getLanguage: async () => 'pt-br',
    copyToClipboard: () => true
  }
};

const fn = new Function('window', 'document', 'navigator', markdownRendererCode);
fn(mockWindow, { getElementById: () => null, addEventListener: () => {} }, {});

const { renderMarkdown, parseFilePathAndLine, isLikelyFilePath } = mockWindow;

// 1. Testes de parseFilePathAndLine
console.log('1. Testando parseFilePathAndLine...');
assert.deepStrictEqual(
  parseFilePathAndLine('file:///C:/Users/soder/Documents/helper-node/main/ipc/chat.js#L42'),
  { path: 'C:/Users/soder/Documents/helper-node/main/ipc/chat.js', line: 42 }
);
assert.deepStrictEqual(
  parseFilePathAndLine('main/ipc/chat.js:105'),
  { path: 'main/ipc/chat.js', line: 105 }
);
assert.deepStrictEqual(
  parseFilePathAndLine('services/historyFormatter.js'),
  { path: 'services/historyFormatter.js', line: undefined }
);
assert.deepStrictEqual(
  parseFilePathAndLine('`package.json`'),
  { path: 'package.json', line: undefined }
);
assert.deepStrictEqual(
  parseFilePathAndLine('(services/historyFormatter.js).'),
  { path: 'services/historyFormatter.js', line: undefined }
);
assert.deepStrictEqual(
  parseFilePathAndLine('services/workspace/store.js (lines 1-50)'),
  { path: 'services/workspace/store.js', line: 1 }
);
assert.deepStrictEqual(
  parseFilePathAndLine('.../main/ipc/chat.js:42'),
  { path: 'main/ipc/chat.js', line: 42 }
);
console.log('  ok   parseFilePathAndLine extrai caminhos limpos e linhas (#L, : e (lines...))');

// 2. Testes de isLikelyFilePath
console.log('2. Testando isLikelyFilePath...');
assert.strictEqual(isLikelyFilePath('main/ipc/chat.js'), true);
assert.strictEqual(isLikelyFilePath('services/historyFormatter.js'), true);
assert.strictEqual(isLikelyFilePath('package.json'), true);
assert.strictEqual(isLikelyFilePath('styles/chat.css'), true);
assert.strictEqual(isLikelyFilePath('C:\\Windows\\system.ini'), true);
assert.strictEqual(isLikelyFilePath('texto normal com espaços'), false);
assert.strictEqual(isLikelyFilePath('https://google.com'), false);
assert.strictEqual(isLikelyFilePath('const x = 10;'), false);
console.log('  ok   isLikelyFilePath distingue caminhos de código e texto comum');

// 3. Testes de Markdown Links [label](target)
console.log('3. Testando links markdown no renderMarkdown...');
const mdLinkText = 'Confira o arquivo [chat.js](file:///C:/Users/soder/Documents/helper-node/main/ipc/chat.js#L42) para detalhes.';
const mdHtml = renderMarkdown(mdLinkText, 'test');
assert(mdHtml.includes('chat-file-link'), 'Deve conter a classe chat-file-link');
assert(mdHtml.includes('data-file-path="C:/Users/soder/Documents/helper-node/main/ipc/chat.js"'), 'Deve conter data-file-path correto');
assert(mdHtml.includes('data-line="42"'), 'Deve conter data-line="42"');
console.log('  ok   Markdown link [file](file://...) vira link clicável de arquivo com linha');

// 4. Testes de Ações Edit / Read do Copilot CLI
console.log('4. Testando Ações Edit e Read do Copilot CLI...');
const copilotStdout = `
● Edit services/providers/copilot-cli/CopilotCliProcess.js
● Read services/historyFormatter.js
● Read services/workspace/store.js (lines 1-50)
Edit: main/ipc/chat.js
Read: package.json
* Edit \`renderer/markdownRenderer.js\`
* Read \`styles/chat.css\`
`;
const copilotHtml = renderMarkdown(copilotStdout, 'test');
assert(copilotHtml.includes('badge-edit'), 'Deve conter badge-edit');
assert(copilotHtml.includes('badge-read'), 'Deve conter badge-read');
assert(copilotHtml.includes('data-file-path="services/providers/copilot-cli/CopilotCliProcess.js"'), 'Deve conter link para CopilotCliProcess.js');
assert(copilotHtml.includes('data-file-path="services/historyFormatter.js"'), 'Deve conter link para historyFormatter.js');
assert(copilotHtml.includes('data-file-path="services/workspace/store.js"'), 'Deve conter link para store.js');
assert(copilotHtml.includes('data-line="1"'), 'Deve conter data-line="1"');
assert(copilotHtml.includes('data-file-path="main/ipc/chat.js"'), 'Deve conter link para chat.js');
assert(copilotHtml.includes('data-file-path="package.json"'), 'Deve conter link para package.json');
assert(copilotHtml.includes('data-file-path="renderer/markdownRenderer.js"'), 'Deve conter link para markdownRenderer.js');
assert(copilotHtml.includes('data-file-path="styles/chat.css"'), 'Deve conter link para chat.css');
console.log('  ok   Ações Edit e Read do Copilot CLI viram badges com links clicáveis de arquivo');

// 5. Testes de URLs web
console.log('5. Testando links web...');
const webLinkText = 'Veja a documentação em [GitHub Copilot](https://docs.github.com/copilot).';
const webHtml = renderMarkdown(webLinkText, 'test');
assert(webHtml.includes('chat-web-link'), 'Deve conter classe chat-web-link');
assert(webHtml.includes('target="_blank"'), 'Deve abrir em nova janela/externo');
console.log('  ok   Links web são marcados com chat-web-link e target=_blank');

console.log('\nTodos os testes de links de arquivos e ações Edit/Read passaram com sucesso! 🎉\n');
