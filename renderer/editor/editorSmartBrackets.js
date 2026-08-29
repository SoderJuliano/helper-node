// renderer/editor/editorSmartBrackets.js
// Autofeche de chaves, parênteses, aspas e indentação inteligente em blocos
// (Estilo VS Code e IntelliJ IDEA para Java, JavaScript, TypeScript, Node.js e Spring Boot).
(function () {
  'use strict';

  const PAIRS = {
    '{': '}',
    '(': ')',
    '[': ']',
    '"': '"',
    "'": "'",
    '`': '`'
  };

  const CLOSING_CHARS = new Set(['}', ')', ']', '"', "'", '`']);

  /**
   * Retorna a string de indentação correspondente a 1 nível para o editor.
   */
  function getIndentStep(cm) {
    const indentWithTabs = cm.getOption('indentWithTabs');
    if (indentWithTabs) return '\t';
    const unit = cm.getOption('indentUnit') || cm.getOption('tabSize') || 4;
    return ' '.repeat(unit);
  }

  /**
   * Trata o pressionamento da tecla Enter dentro de pares de chaves / parênteses / colchetes
   * Expandindo o bloco em múltiplas linhas com a indentação correta do IntelliJ / VS Code.
   */
  function handleSmartEnter(cm) {
    const doc = cm.getDoc();
    const cursor = doc.getCursor();
    const lineText = doc.getLine(cursor.line) || '';
    
    const beforeCursor = lineText.slice(0, cursor.ch);
    const afterCursor = lineText.slice(cursor.ch);

    const prevChar = beforeCursor.slice(-1);
    const nextChar = afterCursor.charAt(0);

    // Caso 1: Cursor exatamente entre { e } ou ( e ) ou [ e ]
    const isMatchingPair = (
      (prevChar === '{' && nextChar === '}') ||
      (prevChar === '(' && nextChar === ')') ||
      (prevChar === '[' && nextChar === ']')
    );

    if (isMatchingPair) {
      const baseIndent = (lineText.match(/^\s*/) || [''])[0];
      const indentStep = getIndentStep(cm);

      cm.operation(() => {
        // Substitui a quebra de linha por 2 linhas: a do meio com indentação extra e a de baixo fechando a chave
        doc.replaceRange('\n' + baseIndent + indentStep + '\n' + baseIndent, cursor, cursor);
        doc.setCursor({ line: cursor.line + 1, ch: baseIndent.length + indentStep.length });
      });
      return true;
    }

    // Caso 2: Linha termina com { aberta sem fechar e usuário pressiona Enter
    // Ex: "public void execute() {" no final da linha
    const trimmedBefore = beforeCursor.trimEnd();
    if (trimmedBefore.endsWith('{') && afterCursor.trim() === '') {
      // Verifica se a chave já tem par fechando abaixo ou se é uma nova chave aberta
      const baseIndent = (lineText.match(/^\s*/) || [''])[0];
      const indentStep = getIndentStep(cm);

      // Checa se há uma chave fechando no documento correspondente
      const totalLines = doc.lineCount();
      let openCount = 0;
      for (let i = 0; i <= cursor.line; i++) {
        const l = doc.getLine(i);
        openCount += (l.match(/\{/g) || []).length;
        openCount -= (l.match(/\}/g) || []).length;
      }
      let remainingClose = 0;
      for (let i = cursor.line + 1; i < totalLines; i++) {
        const l = doc.getLine(i);
        remainingClose += (l.match(/\}/g) || []).length;
        remainingClose -= (l.match(/\{/g) || []).length;
      }

      if (openCount > remainingClose) {
        // Falta fechar chave: insere quebra indentada e a chave fechando na linha seguinte
        cm.operation(() => {
          doc.replaceRange('\n' + baseIndent + indentStep + '\n' + baseIndent + '}', cursor, cursor);
          doc.setCursor({ line: cursor.line + 1, ch: baseIndent.length + indentStep.length });
        });
        return true;
      }
    }

    // Comportamento padrão inteligente: quebra com indentação da linguagem
    if (typeof cm.execCommand === 'function') {
      cm.execCommand('newlineAndIndent');
      return true;
    }
    return false;
  }

  /**
   * Trata o Backspace para apagar pares vazios como {}, (), [], "", '', ``.
   */
  function handleSmartBackspace(cm) {
    const doc = cm.getDoc();
    if (doc.somethingSelected()) return false;

    const cursor = doc.getCursor();
    if (cursor.ch === 0) return false;

    const lineText = doc.getLine(cursor.line) || '';
    const prevChar = lineText.charAt(cursor.ch - 1);
    const nextChar = lineText.charAt(cursor.ch);

    if (PAIRS[prevChar] && PAIRS[prevChar] === nextChar) {
      cm.operation(() => {
        doc.replaceRange('', { line: cursor.line, ch: cursor.ch - 1 }, { line: cursor.line, ch: cursor.ch + 1 });
        doc.setCursor({ line: cursor.line, ch: cursor.ch - 1 });
      });
      return true;
    }
    return false;
  }

  /**
   * Trata digitação de caracteres de abertura e fechamento.
   */
  function handleCharacterInput(cm, char) {
    const doc = cm.getDoc();
    const cursor = doc.getCursor();
    const lineText = doc.getLine(cursor.line) || '';
    const nextChar = lineText.charAt(cursor.ch);

    // 1. Se tem texto selecionado e digitou abertura/aspas -> envolve o texto selecionado
    if (doc.somethingSelected() && PAIRS[char]) {
      const selected = doc.getSelection();
      const closeChar = PAIRS[char];
      doc.replaceSelection(char + selected + closeChar, 'around');
      return true;
    }

    // 2. Se digitou caractere de fechamento e o cursor já está antes desse caractere -> Pula por cima (type-over)
    if (CLOSING_CHARS.has(char) && nextChar === char) {
      doc.setCursor({ line: cursor.line, ch: cursor.ch + 1 });
      return true;
    }

    // 3. Se digitou caractere de abertura -> insere o par e posiciona o cursor no meio
    if (PAIRS[char]) {
      // Não auto-fecha aspas simples se for um apóstrofo dentro de uma palavra (ex: don't)
      if (char === "'" && cursor.ch > 0 && /[\w]/.test(lineText.charAt(cursor.ch - 1))) {
        return false;
      }

      // Se o próximo caractere for uma letra ou número, não auto-fecha aspas para evitar poluição
      if ((char === '"' || char === "'" || char === '`') && /[\w\d]/.test(nextChar)) {
        return false;
      }

      const closeChar = PAIRS[char];
      cm.operation(() => {
        doc.replaceRange(char + closeChar, cursor, cursor);
        doc.setCursor({ line: cursor.line, ch: cursor.ch + 1 });
      });
      return true;
    }

    return false;
  }

  /**
   * Conecta os comportamentos inteligentes de brackets ao editor CodeMirror.
   */
  function attach(cm) {
    if (!cm || cm._smartBracketsAttached) return;
    cm._smartBracketsAttached = true;

    // Habilita as opções nativas do CodeMirror se os addons estiverem carregados
    try {
      cm.setOption('autoCloseBrackets', true);
      cm.setOption('matchBrackets', true);
      cm.setOption('autoCloseTags', true);
    } catch (_) {}

    // Registra interceptador de teclas
    cm.on('keydown', (editor, ev) => {
      // Enter
      if (ev.key === 'Enter' && !ev.ctrlKey && !ev.metaKey && !ev.altKey && !ev.shiftKey) {
        // Se houver hint / autocomplete aberto, deixa o hint tratar
        if (editor.state && editor.state.completionActive) return;
        if (window.EditorAutocomplete && window.EditorAutocomplete.getGhostTextMarker && window.EditorAutocomplete.getGhostTextMarker()) {
          return;
        }

        const handled = handleSmartEnter(editor);
        if (handled) {
          ev.preventDefault();
          ev.stopPropagation();
        }
        return;
      }

      // Backspace
      if (ev.key === 'Backspace' && !ev.ctrlKey && !ev.metaKey && !ev.altKey && !ev.shiftKey) {
        const handled = handleSmartBackspace(editor);
        if (handled) {
          ev.preventDefault();
          ev.stopPropagation();
        }
        return;
      }

      // Interceptação de caracteres ({, }, (, ), [, ], ", ', `)
      if (
        (PAIRS[ev.key] || CLOSING_CHARS.has(ev.key)) &&
        !ev.ctrlKey && !ev.metaKey && !ev.altKey
      ) {
        const handled = handleCharacterInput(editor, ev.key);
        if (handled) {
          ev.preventDefault();
          ev.stopPropagation();
        }
      }
    });
  }

  window.EditorSmartBrackets = {
    attach,
    handleSmartEnter,
    handleSmartBackspace,
    handleCharacterInput,
    getIndentStep,
    PAIRS
  };
})();
