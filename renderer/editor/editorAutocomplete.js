// renderer/editor/editorAutocomplete.js
// CodeMirror auto-completion and Tutor AI inline ghost suggestions.
(function() {
  'use strict';

  let ghostTextMarker = null;
  let ghostSuggestion = '';
  let charsTypedSinceSuggestion = 0;

  function showIdeNotification(msg) {
    const notif = document.getElementById('ide-tutor-notif');
    const msgEl = document.getElementById('ide-tutor-msg');
    if (!notif || !msgEl) return;
    msgEl.textContent = msg;
    notif.classList.add('visible');
  }

  function hideIdeNotification() {
    const notif = document.getElementById('ide-tutor-notif');
    if (notif) notif.classList.remove('visible');
  }

  function clearGhostText() {
    if (ghostTextMarker) {
      ghostTextMarker.clear();
      ghostTextMarker = null;
    }
    ghostSuggestion = '';
    charsTypedSinceSuggestion = 0;
    hideIdeNotification();
  }

  function acceptGhostText(editor) {
    if (!ghostTextMarker || !ghostSuggestion) return;
    const pos = ghostTextMarker.find();
    if (pos) {
      const suggestion = ghostSuggestion;
      clearGhostText();
      editor.replaceRange(suggestion, pos);
      editor.setCursor(editor.posFromIndex(editor.indexFromPos(pos) + suggestion.length));
    } else {
      clearGhostText();
    }
  }

  async function requestAutocomplete(editor) {
    if (!window.electronAPI || !window.electronAPI.getIdeAutocomplete) return;
    const cursor = editor.getCursor();
    const doc = editor.getDoc();
    
    const content = doc.getValue();
    const cursorIndex = doc.indexFromPos(cursor);
    const prefix = content.slice(Math.max(0, cursorIndex - 500), cursorIndex);
    const suffix = content.slice(cursorIndex, Math.min(content.length, cursorIndex + 500));
    const lang = editor.getOption('mode') || 'text';

    showIdeNotification('Tutor: Analisando contexto...');
    
    const suggestion = await window.electronAPI.getIdeAutocomplete({ prefix, suffix, lang });
    if (!suggestion) {
      hideIdeNotification();
      return;
    }
    
    const newCursor = editor.getCursor();
    if (newCursor.line !== cursor.line || newCursor.ch !== cursor.ch) {
      hideIdeNotification();
      return;
    }
    
    clearGhostText();
    ghostSuggestion = suggestion;
    charsTypedSinceSuggestion = 0;
    
    const span = document.createElement('span');
    span.style.opacity = '0.5';
    span.style.fontStyle = 'italic';
    span.textContent = suggestion;
    span.className = 'ghost-text';
    
    ghostTextMarker = editor.setBookmark(cursor, { widget: span, insertLeft: true });
    showIdeNotification('Tutor: Sugestão (Tab para aceitar, Esc para cancelar)');
  }

  function customHint(editor) {
    const mode = editor.getOption('mode');
    let modeHint = null;
    const cmLib = window.CodeMirror;
    if (!cmLib) return null;
    
    const modeName = (mode && typeof mode === 'object') ? mode.name : mode;
    if (modeName === 'javascript') {
      modeHint = cmLib.hint.javascript;
    } else if (modeName === 'css') {
      modeHint = cmLib.hint.css;
    } else if (modeName === 'htmlmixed' || modeName === 'html' || modeName === 'xml') {
      modeHint = cmLib.hint.html || cmLib.hint.xml;
    }
    
    const anywordHint = cmLib.hint.anyword;
    let result = null;
    
    if (modeHint) {
      try { result = modeHint(editor); } catch (_) {}
    }
    
    if (!result || !result.list || !result.list.length) {
      if (anywordHint) {
        try { result = anywordHint(editor); } catch (_) {}
      }
    } else if (anywordHint) {
      try {
        const anyResult = anywordHint(editor);
        if (anyResult && anyResult.list && anyResult.list.length) {
          const listSet = new Set(result.list.map(item => typeof item === 'string' ? item : item.text));
          anyResult.list.forEach(item => {
            const text = typeof item === 'string' ? item : item.text;
            if (!listSet.has(text)) {
              result.list.push(item);
            }
          });
        }
      } catch (_) {}
    }
    return result;
  }

  window.EditorAutocomplete = {
    showIdeNotification,
    hideIdeNotification,
    clearGhostText,
    acceptGhostText,
    requestAutocomplete,
    customHint,
    getGhostTextMarker: () => ghostTextMarker,
    incrementCharsTyped: () => { charsTypedSinceSuggestion++; return charsTypedSinceSuggestion; },
  };
})();
