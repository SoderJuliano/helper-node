// scripts/test-smart-brackets.js
const assert = require('assert');
const path = require('path');
const fs = require('fs');

console.log('=== Testando Smart Brackets, Fechamento de Chaves e Expansão de Blocos (IntelliJ / VS Code Style) ===\n');

// Mock browser environment
global.window = {};
require('../renderer/editor/editorSmartBrackets.js');

const {
  handleSmartEnter,
  handleSmartBackspace,
  handleCharacterInput,
  getIndentStep,
  PAIRS
} = global.window.EditorSmartBrackets;

// 1. Testa pares suportados
assert.strictEqual(PAIRS['{'], '}', 'Par de { deve ser }');
assert.strictEqual(PAIRS['('], ')', 'Par de ( deve ser )');
assert.strictEqual(PAIRS['['], ']', 'Par de [ deve ser ]');
assert.strictEqual(PAIRS['"'], '"', 'Par de " deve ser "');
assert.strictEqual(PAIRS["'"], "'", "Par de ' deve ser '");
assert.strictEqual(PAIRS['`'], '`', 'Par de ` deve ser `');
console.log('  ok   Pares de chaves, colchetes, parenteses e aspas registrados corretamente');

// Helper para criar mock de CodeMirror
function createMockCm(initialText, cursorLine = 0, cursorCh = 0, indentUnit = 4) {
  let lines = initialText.split('\n');
  let cur = { line: cursorLine, ch: cursorCh };
  let selected = '';

  const doc = {
    getLine: (n) => lines[n] !== undefined ? lines[n] : '',
    lineCount: () => lines.length,
    getCursor: () => ({ ...cur }),
    setCursor: (pos) => { cur = { ...pos }; },
    somethingSelected: () => !!selected,
    getSelection: () => selected,
    replaceSelection: (text) => {
      // Simples substituição de seleção
      selected = '';
    },
    replaceRange: (text, from, to) => {
      if (!to) to = from;
      const beforeLine = lines[from.line] || '';
      const afterLine = lines[to.line] || '';
      const prefix = beforeLine.slice(0, from.ch);
      const suffix = afterLine.slice(to.ch);

      const inserted = text.split('\n');
      if (inserted.length === 1) {
        lines[from.line] = prefix + inserted[0] + suffix;
      } else {
        const newLines = [];
        newLines.push(prefix + inserted[0]);
        for (let i = 1; i < inserted.length - 1; i++) {
          newLines.push(inserted[i]);
        }
        newLines.push(inserted[inserted.length - 1] + suffix);
        lines.splice(from.line, (to.line - from.line) + 1, ...newLines);
      }
    }
  };

  return {
    getDoc: () => doc,
    getOption: (opt) => {
      if (opt === 'indentUnit') return indentUnit;
      if (opt === 'tabSize') return indentUnit;
      if (opt === 'indentWithTabs') return false;
      return null;
    },
    operation: (fn) => fn(),
    getValue: () => lines.join('\n'),
    getLines: () => lines,
    getCur: () => cur
  };
}

// 2. Testa digitação de '{' abrindo e fechando automaticamente '{}'
{
  const cm = createMockCm('public class UserService ');
  cm.getDoc().setCursor({ line: 0, ch: 25 });
  const handled = handleCharacterInput(cm, '{');
  assert(handled, 'handleCharacterInput deve tratar {');
  assert.strictEqual(cm.getValue(), 'public class UserService {}');
  assert.deepStrictEqual(cm.getCur(), { line: 0, ch: 26 }, 'Cursor deve estar posicionado entre { e }');
  console.log('  ok   Digitacao de { cria {} e posiciona o cursor no meio');
}

// 3. Testa Enter entre { e } expandindo bloco em 3 linhas com 4 espaços (Java / Spring Boot)
{
  const cm = createMockCm('public class UserService {}', 0, 26, 4);
  const handled = handleSmartEnter(cm);
  assert(handled, 'handleSmartEnter deve tratar Enter entre chaves');
  const expected = 'public class UserService {\n    \n}';
  assert.strictEqual(cm.getValue(), expected, 'Deve quebrar em bloco com 4 espacos de indentacao');
  assert.deepStrictEqual(cm.getCur(), { line: 1, ch: 4 }, 'Cursor deve estar na linha do meio com 4 espacos');
  console.log('  ok   Enter entre chaves expande o bloco com indentacao de 4 espacos (Java/Spring Boot)');
}

// 4. Testa Enter em método Java aninhado
{
  const cm = createMockCm('    public void saveUser() {}', 0, 28, 4);
  const handled = handleSmartEnter(cm);
  assert(handled);
  const expected = '    public void saveUser() {\n        \n    }';
  assert.strictEqual(cm.getValue(), expected);
  assert.deepStrictEqual(cm.getCur(), { line: 1, ch: 8 }, 'Indentacao base (4) + nivel extra (4) = 8 espacos');
  console.log('  ok   Enter em metodo aninhado respeita e adiciona indentacao base + nivel extra');
}

// 5. Testa Enter entre { e } em JavaScript / Node.js (2 espaços)
{
  const cm = createMockCm('app.get("/api/users", (req, res) => {})', 0, 37, 2);
  const handled = handleSmartEnter(cm);
  assert(handled);
  const expected = 'app.get("/api/users", (req, res) => {\n  \n})';
  assert.strictEqual(cm.getValue(), expected);
  assert.deepStrictEqual(cm.getCur(), { line: 1, ch: 2 }, 'Cursor com 2 espacos em JS');
  console.log('  ok   Enter entre chaves em JavaScript / Node.js formata bloco com 2 espacos');
}

// 6. Testa Backspace inteligente apagando o par {}
{
  const cm = createMockCm('const obj = {};', 0, 13);
  const handled = handleSmartBackspace(cm);
  assert(handled, 'handleSmartBackspace deve tratar {} vazio');
  assert.strictEqual(cm.getValue(), 'const obj = ;');
  assert.deepStrictEqual(cm.getCur(), { line: 0, ch: 12 });
  console.log('  ok   Backspace entre chaves vazias apaga ambos os caracteres simultaneamente');
}

// 7. Testa Type-Over (pular fechamento já existente ao digitar })
{
  const cm = createMockCm('function test() {}', 0, 17);
  const handled = handleCharacterInput(cm, '}');
  assert(handled, 'Type-over deve tratar fechamento');
  assert.strictEqual(cm.getValue(), 'function test() {}', 'Nao deve duplicar a chave');
  assert.deepStrictEqual(cm.getCur(), { line: 0, ch: 18 }, 'Cursor deve pular para depois da chave');
  console.log('  ok   Type-over ao digitar } pula o caractere existente sem duplicar');
}

// 8. Testa Enter em linha que termina com { aberta (ex: public class App {)
{
  const cm = createMockCm('public class App {', 0, 18, 4);
  const handled = handleSmartEnter(cm);
  assert(handled);
  const expected = 'public class App {\n    \n}';
  assert.strictEqual(cm.getValue(), expected);
  assert.deepStrictEqual(cm.getCur(), { line: 1, ch: 4 });
  console.log('  ok   Enter ao final de linha com { aberta cria quebra e chave fechando abaixo');
}

console.log('\nTodos os testes de Smart Brackets e Expansão de Blocos passaram com 100% de sucesso! 🎉\n');
