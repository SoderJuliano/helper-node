// renderer/editor/editorConstants.js
// Mode mappings, extension utils and normalization for code editor.
(function() {
  'use strict';

  // Garante que o modo Groovy/Gradle funcione mesmo se o script do CDN atrasar ou estiver offline
  if (typeof window !== 'undefined' && window.CodeMirror && window.CodeMirror.defineMIME) {
    try {
      if (!window.CodeMirror.modes['text/x-groovy'] && !window.CodeMirror.modes.groovy && window.CodeMirror.modes.clike) {
        window.CodeMirror.defineMIME('text/x-groovy', {
          name: 'clike',
          keywords: {
            'as': true, 'assert': true, 'break': true, 'case': true, 'catch': true, 'class': true,
            'const': true, 'continue': true, 'def': true, 'default': true, 'do': true, 'else': true,
            'enum': true, 'extends': true, 'finally': true, 'for': true, 'goto': true, 'if': true,
            'implements': true, 'import': true, 'in': true, 'instanceof': true, 'interface': true,
            'native': true, 'new': true, 'package': true, 'return': true, 'super': true, 'switch': true,
            'this': true, 'throw': true, 'throws': true, 'trait': true, 'try': true, 'var': true,
            'while': true, 'plugins': true, 'dependencies': true, 'repositories': true, 'tasks': true,
            'android': true, 'apply': true, 'plugin': true, 'group': true, 'version': true,
            'implementation': true, 'testImplementation': true, 'api': true, 'compileOnly': true,
            'runtimeOnly': true, 'annotationProcessor': true, 'kapt': true, 'sourceCompatibility': true,
            'targetCompatibility': true, 'mavenCentral': true, 'google': true, 'gradlePluginPortal': true
          },
          types: {
            'byte': true, 'short': true, 'int': true, 'long': true, 'float': true, 'double': true,
            'boolean': true, 'char': true, 'void': true, 'String': true, 'Integer': true, 'Boolean': true,
            'List': true, 'Map': true, 'Set': true, 'File': true, 'Task': true, 'Project': true
          },
          blockKeywords: {
            'catch': true, 'class': true, 'do': true, 'else': true, 'finally': true, 'for': true,
            'if': true, 'try': true, 'while': true, 'enum': true, 'trait': true, 'plugins': true,
            'dependencies': true, 'repositories': true, 'tasks': true, 'android': true, 'buildscript': true,
            'subprojects': true, 'allprojects': true, 'publishing': true
          },
          atoms: { 'true': true, 'false': true, 'null': true },
          hooks: {
            '@': function(stream) {
              stream.eatWhile(/[\w\$_]/);
              return 'meta';
            }
          },
          multiLineStrings: true,
          indentStatements: true
        });
      }
    } catch (_) {}
  }

  const CM_MODE_BY_EXT = {
    js: 'javascript', jsx: 'javascript', mjs: 'javascript', cjs: 'javascript',
    ts: { name: 'javascript', typescript: true }, tsx: { name: 'javascript', typescript: true },
    json: { name: 'javascript', json: true }, json5: { name: 'javascript', json: true }, jsonc: { name: 'javascript', json: true },
    java: 'text/x-java', cs: 'text/x-csharp', c: 'text/x-csrc', h: 'text/x-csrc',
    cpp: 'text/x-c++src', hpp: 'text/x-c++src', cc: 'text/x-c++src', cxx: 'text/x-c++src',
    py: 'python', html: 'htmlmixed', htm: 'htmlmixed', xhtml: 'htmlmixed',
    css: 'css', scss: 'css', sass: 'css', less: 'css', xml: 'xml', svg: 'xml', pom: 'xml',
    md: 'markdown', markdown: 'markdown', sh: 'shell', bash: 'shell', zsh: 'shell',
    yml: 'yaml', yaml: 'yaml', sql: 'sql', go: 'go', rs: 'rust', php: 'php', rb: 'ruby',
    kt: 'text/x-kotlin', kts: 'text/x-kotlin',
    groovy: 'text/x-groovy', gradle: 'text/x-groovy',
    properties: 'properties', env: 'properties',
    toml: 'toml', dockerfile: 'dockerfile',
  };

  const LANG_LABEL_BY_EXT = {
    js: 'JS', jsx: 'JSX', mjs: 'JS', cjs: 'JS', ts: 'TS', tsx: 'TSX',
    java: 'JAVA', cs: 'C#', c: 'C', h: 'C', cpp: 'C++', hpp: 'C++',
    py: 'PY', html: 'HTML', htm: 'HTML', css: 'CSS', scss: 'SCSS', xml: 'XML',
    json: 'JSON', json5: 'JSON5', jsonc: 'JSONC', md: 'MD', sh: 'SH', bash: 'SH', yml: 'YAML', yaml: 'YAML',
    sql: 'SQL', go: 'GO', rs: 'RUST', php: 'PHP', rb: 'RUBY',
    kt: 'KOTLIN', kts: 'KOTLIN', groovy: 'GROOVY', gradle: 'GRADLE',
    properties: 'PROPERTIES', env: 'ENV', toml: 'TOML', dockerfile: 'DOCKER',
  };

  const DEFAULT_4_SPACE_EXTS = new Set([
    'java', 'kt', 'kts', 'groovy', 'gradle', 'cs', 'c', 'h', 'cpp', 'hpp',
    'py', 'rs', 'go', 'sql'
  ]);

  function getModeForPath(filePath) {
    if (!filePath) return null;
    const fileName = getFileName(filePath).toLowerCase();
    
    if (fileName === 'build.gradle' || fileName === 'settings.gradle' || fileName.endsWith('.gradle')) {
      return 'text/x-groovy';
    }
    if (fileName === 'build.gradle.kts' || fileName === 'settings.gradle.kts' || fileName.endsWith('.gradle.kts')) {
      return 'text/x-kotlin';
    }
    if (fileName === 'pom.xml' || fileName.endsWith('.pom')) {
      return 'xml';
    }
    if (fileName === 'dockerfile' || fileName.startsWith('dockerfile.')) {
      return 'dockerfile';
    }
    if (fileName === 'jenkinsfile' || fileName.startsWith('jenkinsfile.')) {
      return 'text/x-groovy';
    }
    if (fileName === '.env' || fileName.startsWith('.env.') || fileName.endsWith('.properties') || fileName === '.gitignore' || fileName === '.npmignore') {
      return 'properties';
    }
    if (fileName.endsWith('.json') || fileName === '.eslintrc' || fileName === '.prettierrc' || fileName.startsWith('tsconfig') || fileName === 'package.json') {
      return { name: 'javascript', json: true };
    }
    if (fileName.endsWith('.toml') || fileName === 'cargo.toml') {
      return 'toml';
    }
    if (fileName.endsWith('.yml') || fileName.endsWith('.yaml')) {
      return 'yaml';
    }

    const ext = extOf(filePath);
    return CM_MODE_BY_EXT[ext] || null;
  }

  function getLangLabel(filePath) {
    if (!filePath) return 'TEXTO';
    const fileName = getFileName(filePath).toLowerCase();
    if (fileName === 'build.gradle' || fileName === 'settings.gradle') return 'GRADLE';
    if (fileName === 'build.gradle.kts' || fileName === 'settings.gradle.kts') return 'GRADLE (KTS)';
    if (fileName === 'pom.xml') return 'MAVEN (XML)';
    if (fileName === 'package.json' || fileName.endsWith('.json')) return 'JSON';
    if (fileName === 'dockerfile' || fileName.startsWith('dockerfile.')) return 'DOCKER';
    if (fileName.endsWith('.properties')) return 'PROPERTIES';
    if (fileName.endsWith('.toml')) return 'TOML';
    if (fileName === '.env' || fileName.startsWith('.env.')) return 'ENV';

    const ext = extOf(filePath);
    return LANG_LABEL_BY_EXT[ext] || (ext || 'texto').toUpperCase();
  }

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
    getModeForPath,
    getLangLabel,
  };
})();
