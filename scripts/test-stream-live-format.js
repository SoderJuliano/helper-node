// scripts/test-stream-live-format.js
const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const mdCode = fs.readFileSync('renderer/markdownRenderer.js', 'utf8');
const context = { window: {}, document: { getElementById: () => null }, navigator: { clipboard: {} } };
context.window = context;
vm.createContext(context);
vm.runInContext(mdCode, context);

function prepareLiveStreamingMarkdown(text) {
  if (!text) return '';
  let live = text;
  const lines = live.split('\n');
  let insideCodeFence = false;
  for (let i = 0; i < lines.length; i++) {
    if (/^\s*`{3,}/.test(lines[i])) {
      insideCodeFence = !insideCodeFence;
    }
  }
  if (insideCodeFence) {
    live += '\n```';
  }
  return live;
}

console.log('=== Testando Pré-Formatação Ao Vivo de Stream Markdown ===\n');

// 1. Bloco de código aberto no meio do stream
console.log('1. Testando bloco de código aberto durante o stream...');
const partialCode = 'Aqui está o exemplo:\n```javascript\nconst total = 42;\nfunction calc() {\n    return total * 2;';
const preparedCode = prepareLiveStreamingMarkdown(partialCode);
const htmlCode = context.renderMarkdown(preparedCode, 'stream');
assert.ok(htmlCode.includes('<pre>'), 'Deve conter tag <pre>');
assert.ok(htmlCode.includes('<code'), 'Deve conter tag <code>');
assert.ok(htmlCode.includes('class="language-javascript"'), 'Deve detectar language-javascript');
assert.ok(htmlCode.includes('return total * 2;'), 'Deve conter o código digitado');
console.log('  ok   Bloco de código formatado e fechado dinamicamente com destaque de sintaxe');

// 2. Tabela no meio do stream
console.log('2. Testando tabela durante o stream...');
const partialTable = 'Tabela de status:\n| ID | Nome | Status |\n|---|---|---|\n| 1 | Teste | Ativo |';
const htmlTable = context.renderMarkdown(partialTable, 'stream');
assert.ok(htmlTable.includes('<table class="markdown-table">'), 'Deve formatar a tabela');
console.log('  ok   Tabela formatada com sucesso');

// 3. Texto com links de arquivos durante o stream
console.log('3. Testando links de arquivos durante o stream...');
const partialLinks = 'Edit: `services/gitDiff/gitDiffService.js` para adicionar função.';
const htmlLinks = context.renderMarkdown(partialLinks, 'stream');
assert.ok(htmlLinks.includes('chat-file-link'), 'Deve conter link interativo para arquivo');
console.log('  ok   Links de arquivos e badges interativos renderizados ao vivo');

console.log('\nTodos os testes de pré-formatação ao vivo passaram com sucesso! 🎉\n');
