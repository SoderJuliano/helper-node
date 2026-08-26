// renderer/editor/editorConstants.js
// Mode mappings, extension utils and normalization for code editor.
(function() {
  'use strict';

  const CM_MODE_BY_EXT = {
    js: 'javascript', jsx: 'javascript', mjs: 'javascript', cjs: 'javascript',
    ts: { name: 'javascript', typescript: true }, tsx: { name: 'javascript', typescript: true },
    json: { name: 'javascript', json: true },
    java: 'text/x-java', cs: 'text/x-csharp', c: 'text/x-csrc', h: 'text/x-csrc',
    cpp: 'text/x-c++src', hpp: 'text/x-c++src',
    py: 'python', html: 'htmlmixed', htm: 'htmlmixed',
    css: 'css', scss: 'css', xml: 'xml',
    md: 'markdown', sh: 'shell', bash: 'shell',
    yml: 'yaml', yaml: 'yaml', sql: 'sql', go: 'go', rs: 'rust', php: 'php', rb: 'ruby',
    kt: 'text/x-kotlin', kts: 'text/x-kotlin',
    groovy: 'text/x-groovy', gradle: 'text/x-groovy',
  };

  const LANG_LABEL_BY_EXT = {
    js: 'JS', jsx: 'JSX', mjs: 'JS', cjs: 'JS', ts: 'TS', tsx: 'TSX',
    java: 'JAVA', cs: 'C#', c: 'C', h: 'C', cpp: 'C++', hpp: 'C++',
    py: 'PY', html: 'HTML', htm: 'HTML', css: 'CSS', scss: 'SCSS', xml: 'XML',
    json: 'JSON', md: 'MD', sh: 'SH', bash: 'SH', yml: 'YAML', yaml: 'YAML',
    sql: 'SQL', go: 'GO', rs: 'RUST', php: 'PHP', rb: 'RUBY',
    kt: 'KOTLIN', kts: 'KOTLIN', groovy: 'GROOVY', gradle: 'GRADLE',
  };

  const DEFAULT_4_SPACE_EXTS = new Set([
    'java', 'kt', 'kts', 'groovy', 'gradle', 'cs', 'c', 'h', 'cpp', 'hpp',
    'py', 'rs', 'go', 'sql'
  ]);

  function detectIndentation(content, ext) {
    const defaultUnit = DEFAULT_4_SPACE_EXTS.has(ext) ? 4 : 2;
    if (!content || typeof content !== 'string') {
      return { indentUnit: defaultUnit, tabSize: defaultUnit, indentWithTabs: false };
    }

    const lines = content.split(/\r?\n/).slice(0, 300);
    let tabCount = 0;
    let space2Count = 0;
    let space4Count = 0;

    for (const line of lines) {
      if (!line.trim() || line.trim().startsWith('*') || line.trim().startsWith('//') || line.trim().startsWith('/*')) continue;
      const leadingTabs = line.match(/^\t+/);
      const leadingSpaces = line.match(/^ +/);
      if (leadingTabs) {
        tabCount++;
      } else if (leadingSpaces) {
        const len = leadingSpaces[0].length;
        if (len % 4 === 0 && len % 2 === 0) {
          space4Count++;
        } else if (len % 2 === 0) {
          space2Count++;
        }
      }
    }

    if (tabCount > space2Count && tabCount > space4Count) {
      return { indentUnit: defaultUnit, tabSize: defaultUnit, indentWithTabs: true };
    }
    if (space4Count > 0 && space4Count >= space2Count && DEFAULT_4_SPACE_EXTS.has(ext)) {
      return { indentUnit: 4, tabSize: 4, indentWithTabs: false };
    }
    if (space4Count > space2Count * 2) {
      return { indentUnit: 4, tabSize: 4, indentWithTabs: false };
    }
    if (space2Count > space4Count * 2) {
      return { indentUnit: 2, tabSize: 2, indentWithTabs: false };
    }
    return { indentUnit: defaultUnit, tabSize: defaultUnit, indentWithTabs: false };
  }

  function normPath(p) {
    if (!p) return '';
    let norm = String(p).replace(/\\/g, '/');
    if (norm.length >= 2 && norm[1] === ':') {
      norm = norm[0].toUpperCase() + norm.substring(1);
    }
    return norm;
  }

  function extOf(p) {
    const m = /\.([a-zA-Z0-9]+)$/.exec(p || '');
    return m ? m[1].toLowerCase() : '';
  }

  function getFileName(p) {
    if (!p) return '';
    const norm = String(p).replace(/\\/g, '/');
    return norm.split('/').pop() || norm;
  }

  window.EditorConstants = {
    CM_MODE_BY_EXT,
    LANG_LABEL_BY_EXT,
    DEFAULT_4_SPACE_EXTS,
    detectIndentation,
    normPath,
    extOf,
    getFileName,
  };
})();
