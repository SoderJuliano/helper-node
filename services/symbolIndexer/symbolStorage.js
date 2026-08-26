// services/symbolIndexer/symbolStorage.js
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');
const { normalizePath } = require('./symbolConstants.js');

function getCacheFilePath(projectPath) {
  try {
    const cacheBase = process.env.APPDATA || (process.platform === 'darwin' ? path.join(os.homedir(), 'Library', 'Caches') : path.join(os.homedir(), '.cache'));
    const targetDir = path.join(cacheBase, 'helper-node', 'index-cache');
    if (!fs.existsSync(targetDir)) fs.mkdirSync(targetDir, { recursive: true });
    const hash = crypto.createHash('sha256').update(normalizePath(projectPath)).digest('hex').slice(0, 16);
    return path.join(targetDir, `sym_idx_${hash}.json`);
  } catch (_) {
    return null;
  }
}

function loadDiskCache(indexer, projectPath) {
  const cacheFile = getCacheFilePath(projectPath);
  if (!cacheFile || !fs.existsSync(cacheFile)) return false;
  try {
    const raw = fs.readFileSync(cacheFile, 'utf8');
    const data = JSON.parse(raw);
    if (!data || data.projectPath !== normalizePath(projectPath)) return false;

    indexer.fileMap = new Map(data.fileMap || []);
    indexer.symbolMap = new Map(data.symbolMap || []);
    indexer.implementationsMap = new Map((data.implementationsMap || []).map(([k, v]) => [k, new Set(v)]));
    indexer.usageMap = new Map(data.usageMap || []);
    indexer.fileMtimes = new Map(data.fileMtimes || []);
    return true;
  } catch (_) {
    return false;
  }
}

async function saveDiskCache(indexer, projectPath) {
  const cacheFile = getCacheFilePath(projectPath);
  if (!cacheFile) return;
  try {
    const data = {
      version: 1,
      projectPath: normalizePath(projectPath),
      timestamp: Date.now(),
      fileMap: Array.from(indexer.fileMap.entries()),
      symbolMap: Array.from(indexer.symbolMap.entries()),
      implementationsMap: Array.from(indexer.implementationsMap.entries()).map(([k, set]) => [k, Array.from(set)]),
      usageMap: Array.from(indexer.usageMap.entries()).slice(0, 5000),
      fileMtimes: Array.from(indexer.fileMtimes.entries()),
    };
    await fs.promises.writeFile(cacheFile, JSON.stringify(data), 'utf8');
  } catch (_) {}
}

module.exports = {
  getCacheFilePath,
  loadDiskCache,
  saveDiskCache,
};
