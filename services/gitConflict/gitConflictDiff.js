// services/gitConflict/gitConflictDiff.js
// Algoritmos de LCS, computação de hunks, alinhamento 3-way e parser de marcadores Git.

function computeLcs(a, b) {
  const n = a.length;
  const m = b.length;

  let start = 0;
  while (start < n && start < m && a[start] === b[start]) {
    start++;
  }

  let endA = n - 1;
  let endB = m - 1;
  while (endA >= start && endB >= start && a[endA] === b[endB]) {
    endA--;
    endB--;
  }

  const aToB = new Map();
  const bToA = new Map();

  for (let i = 0; i < start; i++) {
    aToB.set(i, i);
    bToA.set(i, i);
  }

  const subN = endA - start + 1;
  const subM = endB - start + 1;

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

  const suffixLen = n - (endA + 1);
  for (let k = 0; k < suffixLen; k++) {
    const actualA = endA + 1 + k;
    const actualB = endB + 1 + k;
    aToB.set(actualA, actualB);
    bToA.set(actualB, actualA);
  }

  return { aToB, bToA };
}

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
        baseEnd: b,
        modStart: mStart,
        modEnd: m,
        modLines: modLines.slice(mStart, m)
      });
    }
  }

  return hunks;
}

function align3Way(baseLines, oursLines, theirsLines) {
  if (baseLines.length === 0) {
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

function parseConflictMarkers(fileContent) {
  const lines = fileContent.split(/\r?\n/);
  const chunks = [];
  let chunkIndex = 0;
  let state = 'OUTSIDE';
  let curOurs = [];
  let curBase = [];
  let curTheirs = [];
  let curEqual = [];
  let leftLineCounter = 1;
  let rightLineCounter = 1;

  for (let idx = 0; idx < lines.length; idx++) {
    const line = lines[idx];
    if (line.startsWith('<<<<<<<')) {
      if (curEqual.length > 0) {
        const startLeft = leftLineCounter;
        const startRight = rightLineCounter;
        leftLineCounter += curEqual.length;
        rightLineCounter += curEqual.length;
        chunks.push({
          id: `chunk_${chunkIndex++}`,
          type: 'EQUAL',
          leftLines: [...curEqual],
          baseLines: [...curEqual],
          rightLines: [...curEqual],
          leftStartLine: startLeft,
          leftEndLine: leftLineCounter - 1,
          rightStartLine: startRight,
          rightEndLine: rightLineCounter - 1,
          baseStartLine: startLeft,
          baseEndLine: leftLineCounter - 1
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
      const startLeft = leftLineCounter;
      const startRight = rightLineCounter;
      leftLineCounter += curOurs.length;
      rightLineCounter += curTheirs.length;
      chunks.push({
        id: `chunk_${chunkIndex++}`,
        type: 'CONFLICT',
        leftLines: [...curOurs],
        baseLines: [...curBase],
        rightLines: [...curTheirs],
        leftStartLine: startLeft,
        leftEndLine: Math.max(startLeft, leftLineCounter - 1),
        rightStartLine: startRight,
        rightEndLine: Math.max(startRight, rightLineCounter - 1),
        baseStartLine: 1,
        baseEndLine: 1
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
    const startLeft = leftLineCounter;
    const startRight = rightLineCounter;
    leftLineCounter += curEqual.length;
    rightLineCounter += curEqual.length;
    chunks.push({
      id: `chunk_${chunkIndex++}`,
      type: 'EQUAL',
      leftLines: [...curEqual],
      baseLines: [...curEqual],
      rightLines: [...curEqual],
      leftStartLine: startLeft,
      leftEndLine: leftLineCounter - 1,
      rightStartLine: startRight,
      rightEndLine: rightLineCounter - 1,
      baseStartLine: startLeft,
      baseEndLine: leftLineCounter - 1
    });
  }

  return chunks;
}

module.exports = {
  computeLcs,
  computeDiffHunks,
  align3Way,
  parseConflictMarkers,
};
