// renderer/editor/editorAiDiff.js
// Visual diff review widgets and inline hunk decorations for AI edits.
(function() {
  'use strict';

  function clearAiDiffDecorations(doc, cm) {
    if (!doc) return;
    if (doc.aiWidgets && doc.aiWidgets.length) {
      doc.aiWidgets.forEach(w => {
        try { w.clear(); } catch (_) {}
      });
      doc.aiWidgets = [];
    }
    if (cm && doc.aiLines && doc.aiLines.length) {
      doc.aiLines.forEach(lineHandle => {
        try {
          cm.removeLineClass(lineHandle, 'background', 'cm-ai-line-diff');
          cm.removeLineClass(lineHandle, 'text', 'cm-ai-line-underline');
          cm.removeLineClass(lineHandle, 'gutter', 'cm-ai-gutter-spark');
        } catch (_) {}
      });
      doc.aiLines = [];
    }
    doc.activeAiDiff = null;
  }

  function applyAiDiffDecorations(doc, cm, activePath, previousContent, freshContent, origin, setSaveStatus) {
    clearAiDiffDecorations(doc, cm);
    if (!cm || !previousContent || !freshContent) return;

    const normOld = previousContent.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    const normNew = freshContent.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    if (normOld === normNew) return;

    const oldLines = normOld.split('\n');
    const newLines = normNew.split('\n');

    const n = oldLines.length, m = newLines.length;
    if (n > 1200 || m > 1200) return;

    const dp = [];
    for (let i = 0; i <= n; i++) dp.push(new Int32Array(m + 1));
    for (let i = n - 1; i >= 0; i--) {
      for (let j = m - 1; j >= 0; j--) {
        dp[i][j] = oldLines[i] === newLines[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
      }
    }

    const changedNewLines = [];
    let i = 0, j = 0;
    while (i < n && j < m) {
      if (oldLines[i] === newLines[j]) {
        i++; j++;
      } else if (dp[i + 1][j] >= dp[i][j + 1]) {
        i++;
      } else {
        changedNewLines.push(j);
        j++;
      }
    }
    while (j < m) {
      changedNewLines.push(j);
      j++;
    }

    if (!changedNewLines.length) return;

    doc.aiLines = [];
    doc.aiWidgets = [];
    doc.activeAiDiff = {
      origin,
      previousContent,
      freshContent,
      filePath: activePath
    };

    const hunks = [];
    let currentHunk = [changedNewLines[0]];
    for (let k = 1; k < changedNewLines.length; k++) {
      if (changedNewLines[k] === changedNewLines[k - 1] + 1) {
        currentHunk.push(changedNewLines[k]);
      } else {
        hunks.push(currentHunk);
        currentHunk = [changedNewLines[k]];
      }
    }
    if (currentHunk.length) hunks.push(currentHunk);

    changedNewLines.forEach(lineIdx => {
      try {
        const handle = cm.getLineHandle(lineIdx);
        if (handle) {
          cm.addLineClass(handle, 'background', 'cm-ai-line-diff');
          cm.addLineClass(handle, 'text', 'cm-ai-line-underline');
          cm.addLineClass(handle, 'gutter', 'cm-ai-gutter-spark');
          doc.aiLines.push(handle);
        }
      } catch (_) {}
    });

    const originLabel = origin === 'copilot-cli' ? 'GitHub Copilot'
      : origin === 'gemini-cli' ? 'Antigravity / Gemini'
      : origin === 'claude-cli' ? 'Claude Code'
      : origin === 'openai' ? 'ChatGPT'
      : (origin || 'IA');

    hunks.forEach(hunk => {
      const lastLineIdx = hunk[hunk.length - 1];
      const bar = document.createElement('div');
      bar.className = 'ai-inline-review-bar';
      bar.innerHTML = `
        <span class="ai-review-label">✨ Alterado por ${originLabel} (${hunk.length} ${hunk.length === 1 ? 'linha' : 'linhas'})</span>
        <div class="ai-review-actions">
          <button class="ai-review-btn ai-review-accept" title="Aceitar alterações">✓ Aceitar</button>
          <button class="ai-review-btn ai-review-revert" title="Reverter para o código original">↺ Reverter</button>
        </div>
      `;

      const acceptBtn = bar.querySelector('.ai-review-accept');
      const revertBtn = bar.querySelector('.ai-review-revert');

      acceptBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        clearAiDiffDecorations(doc, cm);
        if (setSaveStatus) setSaveStatus('Alterações da IA aceitas ✓');
        setTimeout(() => { if (setSaveStatus) setSaveStatus(''); }, 1500);
      });

      revertBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const prev = doc.activeAiDiff ? doc.activeAiDiff.previousContent : previousContent;
        clearAiDiffDecorations(doc, cm);
        doc.content = prev;
        doc.originalContent = prev;
        cm.setValue(prev);
        if (window.electronAPI && window.electronAPI.saveFileContent) {
          await window.electronAPI.saveFileContent(activePath, prev);
        }
        if (setSaveStatus) setSaveStatus('Revertido para o código original ✓');
        setTimeout(() => { if (setSaveStatus) setSaveStatus(''); }, 1800);
      });

      try {
        const widget = cm.addLineWidget(lastLineIdx, bar, { coverGutter: false, noHScroll: true });
        doc.aiWidgets.push(widget);
      } catch (_) {}
    });
  }

  window.EditorAiDiff = {
    clearAiDiffDecorations,
    applyAiDiffDecorations,
  };
})();
