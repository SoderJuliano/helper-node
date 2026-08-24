// main/helpers/workspace.js
const {
  electron, path, os, crypto, exec, spawn, util, fs, fs2,
  BackendService, GeminiCliProvider, ClaudeCliProvider, TesseractService,
  OpenAIService, RealtimeAssistantService, RealtimeOpenAiService, ipcService,
  configService, edition, knowledgeBase, fileEditService, historyService,
  helperTools, workspace, agenticWorkflow, ollamaAgenticWorkflow,
  translationAssistant, visionGuide, platformScreenCapture, runTestMode,
  analyzeInterviewImage, cloudTranscribeAudio,
  APP_ICON, HIDE_FROM_TASKBAR, IMAGE_COOLDOWN_MS, AUDIO_TMP_DIR,
  audioFilePath, SCREENSHOT_DIRS, PROJECT_SEARCH_SKIP_DIRS, TREE_HEAVY_DIRS,
  OS_LIVE_CONTINUATION_WINDOW_MS, OS_LIVE_SAMPLE_RATE, OS_LIVE_SILENCE_RMS,
  OS_LIVE_SILENCE_MS, OS_LIVE_MAX_MS, OS_LIVE_TMP_DIR,
  state, helpers
} = require('../globals.js');

helpers.computeLineDiff = function(oldText, newText) {
  const a = String(oldText || "").split("\n");
  const b = String(newText || "").split("\n");
  const n = a.length, m = b.length;
  
  if (n > 2000 || m > 2000) {
      // Se for muito grande, tenta usar git diff --no-index temporariamente no disco para não estourar memória O(N^2)
      try {
          const fs = require('fs');
          const path = require('path');
          const tmpO = path.join(require('os').tmpdir(), 'old_diff_' + Date.now());
          const tmpN = path.join(require('os').tmpdir(), 'new_diff_' + Date.now());
          fs.writeFileSync(tmpO, oldText || "");
          fs.writeFileSync(tmpN, newText || "");
          let diffOut = "";
          try {
              require('child_process').execSync(`git diff --no-index -U99999 "${tmpO}" "${tmpN}"`, { encoding: 'utf8', maxBuffer: 1024*1024*50 });
          } catch(err) {
              diffOut = err.stdout || "";
          }
          fs.unlinkSync(tmpO);
          fs.unlinkSync(tmpN);
          
          if (diffOut) {
              const diffLines = diffOut.split('\n');
              const lines = [];
              let ln = 1;
              let inHunk = false;
              for (const line of diffLines) {
                  if (line.startsWith('@@ ')) { inHunk = true; continue; }
                  if (!inHunk) continue;
                  
                  if (line.startsWith('-')) {
                      lines.push({ t: "del", text: line.substring(1) });
                  } else if (line.startsWith('+')) {
                      lines.push({ t: "add", text: line.substring(1), ln: ln++ });
                  } else if (line.startsWith(' ')) {
                      lines.push({ t: "ctx", text: line.substring(1), ln: ln++ });
                  }
              }
              return lines.length > 0 ? lines : null;
          }
      } catch(e) {
          console.warn("git diff no-index fallback failed:", e.message);
      }
      return null;
  }
  
  const dp = [];
  for (let i = 0; i <= n; i++) dp.push(new Int32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const lines = [];
  let i = 0, j = 0, ln = 1;
  while (i < n && j < m) {
    if (a[i] === b[j]) { lines.push({ t: "ctx", text: a[i], ln: ln++ }); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) { lines.push({ t: "del", text: a[i] }); i++; }
    else { lines.push({ t: "add", text: b[j], ln: ln++ }); j++; }
  }
  while (i < n) { lines.push({ t: "del", text: a[i] }); i++; }
  while (j < m) { lines.push({ t: "add", text: b[j], ln: ln++ }); j++; }
  return lines;
}

helpers.isLikelyBinaryBuffer = function(buffer) {
  if (!buffer || !buffer.length) return false;
  const limit = Math.min(buffer.length, 1024);
  let suspicious = 0;
  for (let i = 0; i < limit; i += 1) {
    const byte = buffer[i];
    if (byte === 0) return true;
    if ((byte < 7 || (byte > 14 && byte < 32)) && byte !== 9 && byte !== 10 && byte !== 13) suspicious += 1;
  }
  return suspicious / limit > 0.2;
}

// Detecta se uma pasta é a raiz de um projeto Java (Maven ou Gradle) — usado
// pra pendurar o nó sintético "Dependencies" dentro do PRÓPRIO projeto na
// árvore (uma pasta aberta pode conter vários projetos, cada um com as suas).
function detectJavaProjectType(absPath) {
  try {
    if (fs2.existsSync(path.join(absPath, 'pom.xml'))) return 'maven';
    if (fs2.existsSync(path.join(absPath, 'build.gradle')) || fs2.existsSync(path.join(absPath, 'build.gradle.kts'))) return 'gradle';
  } catch (_) {}
  return null;
}
helpers.detectJavaProjectType = detectJavaProjectType;

helpers.pushTreeNode = function(entries, absPath, name, depth, isDir) {
  const heavy = isDir && TREE_HEAVY_DIRS.has(name);
  entries.push(
    heavy
      ? { path: absPath, name, depth, isDir, lazy: true }
      : { path: absPath, name, depth, isDir }
  );
  if (isDir) {
    const javaType = detectJavaProjectType(absPath);
    if (javaType) {
      entries.push({ path: absPath, name: 'Dependencies', depth: depth + 1, isDir: true, lazy: true, synthetic: 'java-deps', javaType });
    }
  }
  return heavy;
}

// Marca a pasta como "filhos não vieram completos" para a árvore saber que
// precisa buscar sob demanda ao expandir.
//
// Sem isto, uma pasta cortada pelo limite global ficava MUDA: aparecia na
// árvore, não era `lazy` (então o renderer não buscava nada) e não tinha filho
// nenhum — clicar nela não fazia absolutamente nada, pra sempre. Era metade do
// sintoma de "clico 7-10 vezes até abrir".
function markIncomplete(entries, absPath) {
  for (let i = entries.length - 1; i >= 0; i--) {
    if (entries[i].path === absPath) { entries[i].lazy = true; return; }
  }
}

helpers.walkTreeInto = function(entries, dirPath, depth, localBudget, globalLimit) {
  let dirEntries = [];
  try {
    dirEntries = fs2.readdirSync(dirPath, { withFileTypes: true });
  } catch (_) {
    return 0;
  }
  dirEntries.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
  let used = 0;
  for (const dirent of dirEntries) {
    // Parou no meio: o que sobrou desta pasta será buscado sob demanda.
    if (entries.length >= globalLimit || used >= localBudget) {
      markIncomplete(entries, dirPath);
      return used;
    }
    const absPath = path.join(dirPath, dirent.name);
    const isDir = dirent.isDirectory();
    const heavy = helpers.pushTreeNode(entries, absPath, dirent.name, depth, isDir);
    used += 1;
    if (isDir && !heavy) {
      // Filhos herdam o que sobrou do budget local (não o global) — garante
      // que essa subárvore nunca ultrapasse sua cota, seja lá quão profunda for.
      used += helpers.walkTreeInto(entries, absPath, depth + 1, localBudget - used, globalLimit);
    }
  }
  return used;
}

helpers.collectProjectEntriesAsync = async function(root, limit = 2000) {
  const entries = [];
  const rootJavaType = detectJavaProjectType(root);
  if (rootJavaType) {
    entries.push({ path: root, name: 'Dependencies', depth: 0, isDir: true, lazy: true, synthetic: 'java-deps', javaType: rootJavaType });
  }

  let topLevel = [];
  try {
    topLevel = await fs.promises.readdir(root, { withFileTypes: true });
  } catch (_) {
    return entries;
  }
  topLevel.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));

  for (const dirent of topLevel) {
    const absPath = path.join(root, dirent.name);
    const isDir = dirent.isDirectory();
    // No nível raiz, todas as pastas nascem marcadas como lazy para expansão instantânea sob demanda
    entries.push({
      path: absPath,
      name: dirent.name,
      depth: 0,
      isDir,
      ...(isDir ? { lazy: true } : {})
    });
    if (isDir) {
      const javaType = detectJavaProjectType(absPath);
      if (javaType) {
        entries.push({ path: absPath, name: 'Dependencies', depth: 1, isDir: true, lazy: true, synthetic: 'java-deps', javaType });
      }
    }
  }
  return entries;
};

helpers.collectProjectEntries = function(root, limit = 4000, perTopLevelBudget = 800) {
  const entries = [];
  const rootJavaType = detectJavaProjectType(root);
  if (rootJavaType) {
    entries.push({ path: root, name: 'Dependencies', depth: 0, isDir: true, lazy: true, synthetic: 'java-deps', javaType: rootJavaType });
  }

  let topLevel = [];
  try {
    topLevel = fs2.readdirSync(root, { withFileTypes: true });
  } catch (_) {
    return entries;
  }
  topLevel.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));

  for (const dirent of topLevel) {
    const absPath = path.join(root, dirent.name);
    const isDir = dirent.isDirectory();
    entries.push({
      path: absPath,
      name: dirent.name,
      depth: 0,
      isDir,
      ...(isDir ? { lazy: true } : {})
    });
    if (isDir) {
      const javaType = detectJavaProjectType(absPath);
      if (javaType) {
        entries.push({ path: absPath, name: 'Dependencies', depth: 1, isDir: true, lazy: true, synthetic: 'java-deps', javaType });
      }
    }
  }
  return entries;
};

helpers.collectDirChildrenAsync = async function(dirPath, limit = 3000) {
  const entries = [];
  let top = [];
  try {
    top = await fs.promises.readdir(dirPath, { withFileTypes: true });
  } catch (_) {
    return entries;
  }
  top.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));

  for (const dirent of top) {
    if (entries.length >= limit) break;
    const absPath = path.join(dirPath, dirent.name);
    const isDir = dirent.isDirectory();
    entries.push({ path: absPath, name: dirent.name, depth: 0, isDir, ...(isDir ? { lazy: true } : {}) });
    if (isDir) {
      const javaType = detectJavaProjectType(absPath);
      if (javaType) {
        entries.push({ path: absPath, name: 'Dependencies', depth: 1, isDir: true, lazy: true, synthetic: 'java-deps', javaType });
      }
    }
  }
  return entries;
};

// Filhos IMEDIATOS da pasta (síncrono fallback)
helpers.collectDirChildren = function(dirPath, limit = 3000) {
  const entries = [];
  let top = [];
  try {
    top = fs2.readdirSync(dirPath, { withFileTypes: true });
  } catch (_) {
    return entries;
  }
  top.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));

  for (const dirent of top) {
    if (entries.length >= limit) break;
    const absPath = path.join(dirPath, dirent.name);
    const isDir = dirent.isDirectory();
    entries.push({ path: absPath, name: dirent.name, depth: 0, isDir, ...(isDir ? { lazy: true } : {}) });
    if (isDir) {
      const javaType = detectJavaProjectType(absPath);
      if (javaType) {
        entries.push({ path: absPath, name: 'Dependencies', depth: 1, isDir: true, lazy: true, synthetic: 'java-deps', javaType });
      }
    }
  }
  return entries;
};
