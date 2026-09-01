// services/gitDiff/gitDiffAligner.js
// Alinhamento de diff linha a linha (side-by-side) com LCS rápido.

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

function alignDiff(oldText, newText) {
  const oldLines = oldText ? oldText.split(/\r?\n/) : [];
  const newLines = newText ? newText.split(/\r?\n/) : [];

  const rows = [];
  let additions = 0;
  let deletions = 0;

  if (oldLines.length === 0 && newLines.length === 0) {
    return { rows, additions: 0, deletions: 0, totalLines: 0 };
  }

  if (oldLines.length === 0) {
    for (let i = 0; i < newLines.length; i++) {
      rows.push({
        left: { lineNum: null, type: 'empty', text: '' },
        right: { lineNum: i + 1, type: 'insert', text: newLines[i] }
      });
      additions++;
    }
    return { rows, additions, deletions, totalLines: rows.length };
  }

  if (newLines.length === 0) {
    for (let i = 0; i < oldLines.length; i++) {
      rows.push({
        left: { lineNum: i + 1, type: 'delete', text: oldLines[i] },
        right: { lineNum: null, type: 'empty', text: '' }
      });
      deletions++;
    }
    return { rows, additions, deletions, totalLines: rows.length };
  }

  const { aToB } = computeLcs(oldLines, newLines);

  let i = 0;
  let j = 0;
  let oldLineNum = 1;
  let newLineNum = 1;

  while (i < oldLines.length || j < newLines.length) {
    if (i < oldLines.length && j < newLines.length && aToB.get(i) === j) {
      rows.push({
        left: { lineNum: oldLineNum++, type: 'equal', text: oldLines[i] },
        right: { lineNum: newLineNum++, type: 'equal', text: newLines[j] }
      });
      i++;
      j++;
    } else {
      const delBlock = [];
      const insBlock = [];

      while (i < oldLines.length && (!aToB.has(i) || aToB.get(i) < j)) {
        delBlock.push({ lineNum: oldLineNum++, type: 'delete', text: oldLines[i] });
        deletions++;
        i++;
      }

      while (j < newLines.length && (!Array.from(aToB.values()).includes(j) || j < (aToB.get(i) || Infinity))) {
        if (i < oldLines.length && aToB.has(i) && aToB.get(i) === j) {
          break;
        }
        insBlock.push({ lineNum: newLineNum++, type: 'insert', text: newLines[j] });
        additions++;
        j++;
      }

      const maxLen = Math.max(delBlock.length, insBlock.length);
      for (let k = 0; k < maxLen; k++) {
        const left = delBlock[k] || { lineNum: null, type: 'empty', text: '' };
        const right = insBlock[k] || { lineNum: null, type: 'empty', text: '' };
        rows.push({ left, right });
      }
    }
  }

  return { rows, additions, deletions, totalLines: rows.length };
}

module.exports = {
  computeLcs,
  alignDiff
};
