// services/gitConflictService.js
// Detecção de conflitos Git, extração 3-way (Base, Ours, Theirs), cálculo de chunks e resolução de merge.

const fs = require('fs');
const path = require('path');
const { execFile, execFileSync } = require('child_process');

function execGit(args, cwd, timeoutMs = 5000) {
  return new Promise((resolve) => {
    execFile('git', ['-C', cwd, ...args], { timeout: timeoutMs, encoding: 'utf8', maxBuffer: 1024 * 1024 * 20 }, (err, stdout, stderr) => {
      resolve({ err, stdout: stdout || '', stderr: stderr || '' });
    });
  });
}

// Algoritmo LCS Otimizado para Diff de Linhas com Trim de Prefixo e Sufixo
function computeLcs(a, b) {
  const n = a.length;
  const m = b.length;

  // 1. Trim de prefixo idêntico
  let start = 0;
  while (start < n && start < m && a[start] === b[start]) {
    start++;
  }

  // 2. Trim de sufixo idêntico
  let endA = n - 1;
  let endB = m - 1;
  while (endA >= start && endB >= start && a[endA] === b[endB]) {
    endA--;
    endB--;
  }

  const aToB = new Map();
  const bToA = new Map();

  // Mapeia prefixo idêntico
  for (let i = 0; i < start; i++) {
    aToB.set(i, i);
    bToA.set(i, i);
  }

  const subN = endA - start + 1;
  const subM = endB - start + 1;

  // LCS apenas no miolo modificado
  if (subN > 0 && subM > 0) {
    const dp = Array.from({ length: subN + 1 }, () => new Int32Array(subM + 1));
    for (let i = subN - 1; i >= 0; i--) {
      for (let j = subM - 1; j >= 0; j--) {
        if (a[start + i] === b[start + j]) {
          dp[i][j] = dp[i + 1][j + 1] + 1;
        } else {
          dp[i][j] = Math.max(dp[i + 1][j], dp[i][j + 1]);
        }
      }
    }

    let i = 0, j = 0;
    while (i < subN && j < subM) {
      if (a[start + i] === b[start + j]) {
        const actualA = start + i;
        const actualB = start + j;
        aToB.set(actualA, actualB);
        bToA.set(actualB, actualA);
        i++;
        j++;
      } else if (dp[i + 1][j] >= dp[i][j + 1]) {
        i++;
      } else {
        j++;
      }
    }
  }

  // Mapeia sufixo idêntico
  const suffixLen = n - (endA + 1);
  for (let k = 0; k < suffixLen; k++) {
    const actualA = endA + 1 + k;
    const actualB = endB + 1 + k;
    aToB.set(actualA, actualB);
    bToA.set(actualB, actualA);
  }

  return { aToB, bToA };
}

// Extrai os hunks de modificação entre Base e uma versão modificada
function computeDiffHunks(baseLines, modLines) {
  const { aToB, bToA } = computeLcs(baseLines, modLines);
  const hunks = [];
  let b = 0, m = 0;

  while (b < baseLines.length || m < modLines.length) {
    if (b < baseLines.length && m < modLines.length && aToB.get(b) === m) {
      b++;
      m++;
    } else {
      const bStart = b;
      const mStart = m;

      // Avança até o próximo ponto sincronizado
      while (b < baseLines.length || m < modLines.length) {
        if (b < baseLines.length && m < modLines.length && aToB.get(b) === m) {
          break;
        }
        if (b < baseLines.length && (!aToB.has(b) || aToB.get(b) < m)) {
          b++;
        } else if (m < modLines.length && !bToA.has(m)) {
          m++;
        } else {
          if (b < baseLines.length) b++;
          if (m < modLines.length) m++;
        }
      }

      hunks.push({
        baseStart: bStart,
        baseEnd: b, // exclusivo
        modStart: mStart,
        modEnd: m, // exclusivo
        modLines: modLines.slice(mStart, m)
      });
    }
  }

  return hunks;
}

// Alinhamento 3-Way entre Base, Ours e Theirs
function align3Way(baseLines, oursLines, theirsLines) {
  if (baseLines.length === 0) {
    // Caso especial: arquivo adicionado em ambos (AA) sem ancestral base comum
    const { aToB: oursToTheirs } = computeLcs(oursLines, theirsLines);
    const chunks = [];
    let o = 0, t = 0;
    let chunkIndex = 0;

    while (o < oursLines.length || t < theirsLines.length) {
      if (o < oursLines.length && t < theirsLines.length && oursLines[o] === theirsLines[t]) {
        const eqOurs = [];
        const startO = o + 1;
        const startT = t + 1;
        while (o < oursLines.length && t < theirsLines.length && oursLines[o] === theirsLines[t]) {
          eqOurs.push(oursLines[o]);
          o++;
          t++;
        }
        chunks.push({
          id: `chunk_${chunkIndex++}`,
          type: 'EQUAL',
          leftLines: eqOurs,
          baseLines: [],
          rightLines: [...eqOurs],
          leftStartLine: startO,
          leftEndLine: o,
          rightStartLine: startT,
          rightEndLine: t,
          baseStartLine: 1,
          baseEndLine: 1
        });
      } else {
        const diffO = [];
        const diffT = [];
        const startO = o + 1;
        const startT = t + 1;
        while ((o < oursLines.length && !oursToTheirs.has(o)) || (t < theirsLines.length && oursToTheirs.get(o) !== t)) {
          if (o < oursLines.length && !oursToTheirs.has(o)) {
            diffO.push(oursLines[o]);
            o++;
          }
          if (t < theirsLines.length && !Array.from(oursToTheirs.values()).includes(t)) {
            diffT.push(theirsLines[t]);
            t++;
          }
          if (o >= oursLines.length && t >= theirsLines.length) break;
          if (o < oursLines.length && t < theirsLines.length && oursLines[o] === theirsLines[t]) break;
        }

        chunks.push({
          id: `chunk_${chunkIndex++}`,
          type: 'CONFLICT',
          leftLines: diffO,
          baseLines: [],
          rightLines: diffT,
          leftStartLine: startO,
          leftEndLine: Math.max(startO, o),
          rightStartLine: startT,
          rightEndLine: Math.max(startT, t),
          baseStartLine: 1,
          baseEndLine: 1
        });
      }
    }
    return chunks;
  }

  const hunksOurs = computeDiffHunks(baseLines, oursLines);
  const hunksTheirs = computeDiffHunks(baseLines, theirsLines);

  // Combina e mescla intervalos da Base
  const intervals = [];
  for (const h of hunksOurs) intervals.push({ start: h.baseStart, end: h.baseEnd });
  for (const h of hunksTheirs) intervals.push({ start: h.baseStart, end: h.baseEnd });

  intervals.sort((a, b) => a.start - b.start || a.end - b.end);

  const mergedIntervals = [];
  for (const iv of intervals) {
    if (mergedIntervals.length === 0) {
      mergedIntervals.push({ start: iv.start, end: iv.end });
    } else {
      const last = mergedIntervals[mergedIntervals.length - 1];
      if (iv.start <= last.end) {
        last.end = Math.max(last.end, iv.end);
      } else {
        mergedIntervals.push({ start: iv.start, end: iv.end });
      }
    }
  }

  const chunks = [];
  let curB = 0;
  let chunkIndex = 0;

  // Função auxiliar para extrair linhas de uma versão para um intervalo da base
  const getSlice = (baseStart, baseEnd, modLines, hunks) => {
    const matchingHunks = hunks.filter(h => h.baseStart >= baseStart && h.baseEnd <= baseEnd);
    if (matchingHunks.length === 0) {
      return baseLines.slice(baseStart, baseEnd);
    }
    const result = [];
    let b = baseStart;
    for (const h of matchingHunks) {
      if (h.baseStart > b) {
        result.push(...baseLines.slice(b, h.baseStart));
      }
      result.push(...h.modLines);
      b = h.baseEnd;
    }
    if (b < baseEnd) {
      result.push(...baseLines.slice(b, baseEnd));
    }
    return result;
  };

  let leftLineCounter = 1;
  let rightLineCounter = 1;

  for (const iv of mergedIntervals) {
    // Trecho anterior inalterado (EQUAL)
    if (iv.start > curB) {
      const eqLines = baseLines.slice(curB, iv.start);
      chunks.push({
        id: `chunk_${chunkIndex++}`,
        type: 'EQUAL',
        leftLines: eqLines,
        baseLines: eqLines,
        rightLines: eqLines,
        leftStartLine: leftLineCounter,
        leftEndLine: leftLineCounter + eqLines.length - 1,
        rightStartLine: rightLineCounter,
        rightEndLine: rightLineCounter + eqLines.length - 1,
        baseStartLine: curB + 1,
        baseEndLine: iv.start
      });
      leftLineCounter += eqLines.length;
      rightLineCounter += eqLines.length;
    }

    const baseSlice = baseLines.slice(iv.start, iv.end);
    const leftSlice = getSlice(iv.start, iv.end, oursLines, hunksOurs);
    const rightSlice = getSlice(iv.start, iv.end, theirsLines, hunksTheirs);

    const baseStr = baseSlice.join('\n');
    const leftStr = leftSlice.join('\n');
    const rightStr = rightSlice.join('\n');

    const leftChanged = leftStr !== baseStr;
    const rightChanged = rightStr !== baseStr;
    const sameEdit = leftStr === rightStr;

    let type = 'CONFLICT';
    if (!leftChanged && !rightChanged) type = 'EQUAL';
    else if (leftChanged && !rightChanged) type = 'LEFT_ONLY';
    else if (!leftChanged && rightChanged) type = 'RIGHT_ONLY';
    else if (sameEdit) type = 'SAME_CHANGE';

    chunks.push({
      id: `chunk_${chunkIndex++}`,
      type,
      leftLines: leftSlice,
      baseLines: baseSlice,
      rightLines: rightSlice,
      leftStartLine: leftLineCounter,
      leftEndLine: leftLineCounter + Math.max(0, leftSlice.length - 1),
      rightStartLine: rightLineCounter,
      rightEndLine: rightLineCounter + Math.max(0, rightSlice.length - 1),
      baseStartLine: iv.start + 1,
      baseEndLine: Math.max(iv.start + 1, iv.end)
    });

    leftLineCounter += leftSlice.length;
    rightLineCounter += rightSlice.length;
    curB = iv.end;
  }

  // Linhas finais inalteradas (EQUAL)
  if (curB < baseLines.length) {
    const eqLines = baseLines.slice(curB);
    chunks.push({
      id: `chunk_${chunkIndex++}`,
      type: 'EQUAL',
      leftLines: eqLines,
      baseLines: eqLines,
      rightLines: eqLines,
      leftStartLine: leftLineCounter,
      leftEndLine: leftLineCounter + eqLines.length - 1,
      rightStartLine: rightLineCounter,
      rightEndLine: rightLineCounter + eqLines.length - 1,
      baseStartLine: curB + 1,
      baseEndLine: baseLines.length
    });
  }

  return chunks;
}

// Fallback: Parser de marcadores Git caso não haja stages (:1, :2, :3)
function parseConflictMarkers(fileContent) {
  const lines = fileContent.split(/\r?\n/);
  const chunks = [];
  let chunkIndex = 0;
  let state = 'OUTSIDE';
  let curOurs = [];
  let curBase = [];
  let curTheirs = [];
  let curEqual = [];

  for (let idx = 0; idx < lines.length; idx++) {
    const line = lines[idx];
    if (line.startsWith('<<<<<<<')) {
      if (curEqual.length > 0) {
        chunks.push({
          id: `chunk_${chunkIndex++}`,
          type: 'EQUAL',
          leftLines: [...curEqual],
          baseLines: [...curEqual],
          rightLines: [...curEqual],
          leftStartLine: 1, leftEndLine: 1, rightStartLine: 1, rightEndLine: 1, baseStartLine: 1, baseEndLine: 1
        });
        curEqual = [];
      }
      state = 'OURS';
      curOurs = [];
      curBase = [];
      curTheirs = [];
    } else if (line.startsWith('|||||||') && state === 'OURS') {
      state = 'BASE';
    } else if (line.startsWith('=======') && (state === 'OURS' || state === 'BASE')) {
      state = 'THEIRS';
    } else if (line.startsWith('>>>>>>>') && state === 'THEIRS') {
      chunks.push({
        id: `chunk_${chunkIndex++}`,
        type: 'CONFLICT',
        leftLines: [...curOurs],
        baseLines: [...curBase],
        rightLines: [...curTheirs],
        leftStartLine: 1, leftEndLine: 1, rightStartLine: 1, rightEndLine: 1, baseStartLine: 1, baseEndLine: 1
      });
      curOurs = [];
      curBase = [];
      curTheirs = [];
      state = 'OUTSIDE';
    } else {
      if (state === 'OUTSIDE') curEqual.push(line);
      else if (state === 'OURS') curOurs.push(line);
      else if (state === 'BASE') curBase.push(line);
      else if (state === 'THEIRS') curTheirs.push(line);
    }
  }

  if (curEqual.length > 0) {
    chunks.push({
      id: `chunk_${chunkIndex++}`,
      type: 'EQUAL',
      leftLines: [...curEqual],
      baseLines: [...curEqual],
      rightLines: [...curEqual],
      leftStartLine: 1, leftEndLine: 1, rightStartLine: 1, rightEndLine: 1, baseStartLine: 1, baseEndLine: 1
    });
  }

  return chunks;
}

const GitConflictService = {
  // Detecta se o repositório possui conflitos e lista os arquivos não resolvidos
  async detectGitConflicts(projectPath) {
    if (!projectPath || !fs.existsSync(projectPath)) {
      return { hasConflicts: false, count: 0, conflictFiles: [], currentBranch: '', incomingBranch: '', mergeState: 'none' };
    }

    try {
      const gitDir = path.join(projectPath, '.git');
      let mergeState = 'none';

      if (fs.existsSync(gitDir)) {
        if (fs.existsSync(path.join(gitDir, 'MERGE_HEAD'))) mergeState = 'merge';
        else if (fs.existsSync(path.join(gitDir, 'rebase-merge')) || fs.existsSync(path.join(gitDir, 'rebase-apply'))) mergeState = 'rebase';
        else if (fs.existsSync(path.join(gitDir, 'CHERRY_PICK_HEAD'))) mergeState = 'cherry-pick';
        else if (fs.existsSync(path.join(gitDir, 'REVERT_HEAD'))) mergeState = 'revert';
      }

      // Obtém branch atual
      const branchRes = await execGit(['rev-parse', '--abbrev-ref', 'HEAD'], projectPath);
      const currentBranch = branchRes.stdout.trim() || 'HEAD';

      // Obtém incoming branch / descrição
      let incomingBranch = 'Incoming (Theirs)';
      if (fs.existsSync(gitDir)) {
        const mergeMsgPath = path.join(gitDir, 'MERGE_MSG');
        if (fs.existsSync(mergeMsgPath)) {
          try {
            const firstLine = fs.readFileSync(mergeMsgPath, 'utf8').split('\n')[0].trim();
            if (firstLine) {
              const match = firstLine.match(/Merge (?:branch|remote-tracking branch|commit) ['"]?([^'"]+)['"]?/i);
              if (match && match[1]) incomingBranch = match[1];
              else incomingBranch = firstLine;
            }
          } catch (_) {}
        }
      }

      // Executa git status para achar arquivos com conflito (unmerged)
      const statusRes = await execGit(['-c', 'core.quotepath=false', 'status', '--porcelain', '-uall'], projectPath);
      const conflictFiles = [];
      const lines = statusRes.stdout.split('\n');

      const conflictCodes = new Set(['UU', 'AA', 'UD', 'DU', 'UA', 'AU', 'DD']);

      for (const line of lines) {
        if (!line || line.length < 3) continue;
        const code = line.substring(0, 2);
        let relPath = line.substring(3).trim();
        if (relPath.includes(' -> ')) {
          relPath = relPath.split(' -> ')[1].trim();
        }
        if (relPath.startsWith('"') && relPath.endsWith('"')) {
          relPath = relPath.substring(1, relPath.length - 1);
        }
        relPath = relPath.replace(/\\/g, '/');

        if (conflictCodes.has(code)) {
          conflictFiles.push({ path: relPath, code, status: 'unmerged' });
        }
      }

      const hasConflicts = conflictFiles.length > 0 || (mergeState !== 'none' && conflictFiles.length > 0);

      return {
        hasConflicts,
        count: conflictFiles.length,
        conflictFiles,
        currentBranch,
        incomingBranch,
        mergeState,
        projectPath
      };
    } catch (e) {
      console.warn('[GitConflictService] Erro ao detectar conflitos:', e.message);
      return { hasConflicts: false, count: 0, conflictFiles: [], currentBranch: '', incomingBranch: '', mergeState: 'none' };
    }
  },

  // Obtém os dados 3-way (Base, Ours, Theirs e Chunks) de um arquivo específico
  async getFile3WayData(projectPath, relPath) {
    if (!projectPath || !relPath) {
      return { ok: false, error: 'Caminho do projeto ou arquivo inválido' };
    }

    try {
      const gitRelPath = String(relPath || '').replace(/\\/g, '/').replace(/^\/+/, '');
      const fullPath = path.join(projectPath, gitRelPath);
      const statusInfo = await this.detectGitConflicts(projectPath);

      // Tenta obter as 3 versões dos stages do git index (:1 = BASE, :2 = OURS, :3 = THEIRS)
      const baseRes = await execGit(['show', `:1:${gitRelPath}`], projectPath);
      const oursRes = await execGit(['show', `:2:${gitRelPath}`], projectPath);
      const theirsRes = await execGit(['show', `:3:${gitRelPath}`], projectPath);

      let baseText = baseRes.err ? '' : baseRes.stdout;
      let oursText = oursRes.err ? '' : oursRes.stdout;
      let theirsText = theirsRes.err ? '' : theirsRes.stdout;
      let chunks = [];

      // Se temos pelo menos uma versão válida nos stages (ou ambos)
      if (!oursRes.err || !theirsRes.err || !baseRes.err) {
        const baseLines = baseText ? baseText.split(/\r?\n/) : [];
        const oursLines = oursText ? oursText.split(/\r?\n/) : [];
        const theirsLines = theirsText ? theirsText.split(/\r?\n/) : [];
        chunks = align3Way(baseLines, oursLines, theirsLines);
      } else {
        // Fallback: Lê o arquivo com marcadores no disco
        let diskContent = '';
        if (fs.existsSync(fullPath)) {
          diskContent = fs.readFileSync(fullPath, 'utf8');
        }
        if (diskContent.includes('<<<<<<<') && diskContent.includes('>>>>>>>')) {
          chunks = parseConflictMarkers(diskContent);
          oursText = chunks.map(c => c.leftLines.join('\n')).filter(Boolean).join('\n');
          theirsText = chunks.map(c => c.rightLines.join('\n')).filter(Boolean).join('\n');
          baseText = chunks.map(c => c.baseLines.join('\n')).filter(Boolean).join('\n');
        } else {
          // Arquivo sem marcadores no disco (fallback com linhas completas)
          const lines = diskContent ? diskContent.split(/\r?\n/) : [];
          chunks = [{
            id: 'chunk_0',
            type: 'CONFLICT',
            leftLines: [...lines],
            baseLines: [],
            rightLines: [...lines],
            leftStartLine: 1,
            leftEndLine: Math.max(1, lines.length),
            rightStartLine: 1,
            rightEndLine: Math.max(1, lines.length),
            baseStartLine: 1,
            baseEndLine: 1
          }];
          oursText = diskContent;
          theirsText = diskContent;
          baseText = '';
        }
      }

      // Constrói o resultado inicial (com blocos não conflitantes auto-aplicados)
      const initialResultLines = [];
      for (const chunk of chunks) {
        if (chunk.type === 'EQUAL' || chunk.type === 'SAME_CHANGE') {
          initialResultLines.push(...chunk.leftLines);
        } else if (chunk.type === 'LEFT_ONLY') {
          initialResultLines.push(...chunk.leftLines);
        } else if (chunk.type === 'RIGHT_ONLY') {
          initialResultLines.push(...chunk.rightLines);
        } else if (chunk.type === 'CONFLICT') {
          // Marcador visual no resultado inicial
          initialResultLines.push(`<<<<<<< ${statusInfo.currentBranch || 'Ours'}`);
          initialResultLines.push(...chunk.leftLines);
          initialResultLines.push('=======');
          initialResultLines.push(...chunk.rightLines);
          initialResultLines.push(`>>>>>>> ${statusInfo.incomingBranch || 'Theirs'}`);
        }
      }

      const totalConflicts = chunks.filter(c => c.type === 'CONFLICT').length;
      const totalNonConflicts = chunks.filter(c => c.type === 'LEFT_ONLY' || c.type === 'RIGHT_ONLY').length;

      return {
        ok: true,
        relPath: gitRelPath,
        fullPath,
        currentBranch: statusInfo.currentBranch,
        incomingBranch: statusInfo.incomingBranch,
        baseText,
        oursText,
        theirsText,
        chunks,
        initialResult: initialResultLines.join('\n'),
        totalConflicts,
        totalNonConflicts
      };
    } catch (e) {
      console.warn('[GitConflictService] Erro ao extrair dados 3-way:', e.message);
      return { ok: false, error: e.message };
    }
  },

  // Salva o arquivo resolvido e executa `git add`
  async saveResolvedFile(projectPath, relPath, content) {
    if (!projectPath || !relPath) {
      return { ok: false, error: 'Parâmetros inválidos' };
    }

    try {
      const gitRelPath = String(relPath || '').replace(/\\/g, '/').replace(/^\/+/, '');
      const fullPath = path.join(projectPath, gitRelPath);
      const parentDir = path.dirname(fullPath);
      if (!fs.existsSync(parentDir)) {
        fs.mkdirSync(parentDir, { recursive: true });
      }

      fs.writeFileSync(fullPath, content, 'utf8');

      // Executa git add
      const addRes = await execGit(['add', gitRelPath], projectPath);
      if (addRes.err) {
        return { ok: false, error: addRes.stderr || addRes.err.message };
      }

      const remaining = await this.detectGitConflicts(projectPath);
      return { ok: true, remainingConflicts: remaining.count, conflictFiles: remaining.conflictFiles };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  },

  // Aborta a operação de merge / rebase
  async abortMerge(projectPath) {
    if (!projectPath) return { ok: false, error: 'Projeto não especificado' };

    try {
      const gitDir = path.join(projectPath, '.git');
      let command = ['merge', '--abort'];

      if (fs.existsSync(gitDir)) {
        if (fs.existsSync(path.join(gitDir, 'rebase-merge')) || fs.existsSync(path.join(gitDir, 'rebase-apply'))) {
          command = ['rebase', '--abort'];
        } else if (fs.existsSync(path.join(gitDir, 'CHERRY_PICK_HEAD'))) {
          command = ['cherry-pick', '--abort'];
        } else if (fs.existsSync(path.join(gitDir, 'REVERT_HEAD'))) {
          command = ['revert', '--abort'];
        }
      }

      const res = await execGit(command, projectPath);
      if (res.err) {
        // Fallback genérico
        const fallbackRes = await execGit(['reset', '--merge'], projectPath);
        if (fallbackRes.err) {
          return { ok: false, error: res.stderr || fallbackRes.stderr };
        }
      }

      return { ok: true };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }
};

module.exports = { GitConflictService, align3Way, parseConflictMarkers, computeLcs, computeDiffHunks };
