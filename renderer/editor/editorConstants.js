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
  };

  const LANG_LABEL_BY_EXT = {
    js: 'JS', jsx: 'JSX', mjs: 'JS', cjs: 'JS', ts: 'TS', tsx: 'TSX',
    java: 'JAVA', cs: 'C#', c: 'C', h: 'C', cpp: 'C++', hpp: 'C++',
    py: 'PY', html: 'HTML', htm: 'HTML', css: 'CSS', scss: 'SCSS', xml: 'XML',
    json: 'JSON', md: 'MD', sh: 'SH', bash: 'SH', yml: 'YAML', yaml: 'YAML',
    sql: 'SQL', go: 'GO', rs: 'RUST', php: 'PHP', rb: 'RUBY',
  };

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
    normPath,
    extOf,
    getFileName,
  };
})();
