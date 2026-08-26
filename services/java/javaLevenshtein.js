// services/java/javaLevenshtein.js

function levenshtein(a, b) {
  const m = a.length, n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const dp = new Array(n + 1);
  for (let j = 0; j <= n; j++) dp[j] = j;
  for (let i = 1; i <= m; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= n; j++) {
      const temp = dp[j];
      dp[j] = a[i - 1] === b[j - 1] ? prev : 1 + Math.min(prev, dp[j], dp[j - 1]);
      prev = temp;
    }
  }
  return dp[n];
}

function suggestForSimpleName(simpleName, simpleNameIndex, limit = 5) {
  const target = simpleName.toLowerCase();
  const candidates = [];
  for (const [name, fqns] of simpleNameIndex.entries()) {
    if (Math.abs(name.length - simpleName.length) > 3) continue;
    const dist = levenshtein(target, name.toLowerCase());
    if (dist <= 2) {
      for (const fqn of fqns) candidates.push({ fqn, dist });
    }
  }
  candidates.sort((a, b) => a.dist - b.dist);
  const out = [];
  const seen = new Set();
  for (const c of candidates) {
    if (seen.has(c.fqn)) continue;
    seen.add(c.fqn);
    out.push(c.fqn);
    if (out.length >= limit) break;
  }
  return out;
}

module.exports = {
  levenshtein,
  suggestForSimpleName,
};
