// services/symbolIndexer.js
// Indexador de símbolos autônomo e ultra-rápido para navegação de código (Go to Definition / Implementações)
// Compatível com Windows e Linux (Wayland/KDE/GNOME - Garuda, Arch, Pop!OS, Ubuntu).

const fs = require('fs');
const path = require('path');
const {
  SUPPORTED_EXTS,
  shouldIgnoreDir,
  normalizePath,
} = require('./symbolIndexer/symbolConstants.js');
const {
  getCacheFilePath,
  loadDiskCache,
  saveDiskCache,
} = require('./symbolIndexer/symbolStorage.js');
const {
  indexUsagesInLine,
  parseFileLines,
} = require('./symbolIndexer/symbolParser.js');
const {
  tryResolveFilePath,
  searchDefinitionInFile,
  scanDir,
  findUsages,
  resolveReceiverType,
  findDefinition,
  findImplementations,
  getGutterInfo,
} = require('./symbolIndexer/symbolFinder.js');

class SymbolIndexer {
  constructor() {
    this.projectPath = null;
    this.fileMap = new Map();
    this.implementationsMap = new Map();
    this.symbolMap = new Map();
    this.usageMap = new Map();
    this.usagesTruncated = new Set();
    this.fileMtimes = new Map();
    this.indexingSessionId = 0;
    this.isIndexing = false;
    this.indexingProgress = { total: 0, processed: 0 };
    this._lastNotify = 0;
  }

  reset() {
    this.projectPath = null;
    this.fileMap.clear();
    this.implementationsMap.clear();
    this.symbolMap.clear();
    this.usageMap.clear();
    this.usagesTruncated.clear();
    this.fileMtimes.clear();
    this.isIndexing = false;
    this.indexingProgress = { total: 0, processed: 0 };
  }

  getCacheFilePath(projectPath) {
    return getCacheFilePath(projectPath);
  }

  loadDiskCache(projectPath) {
    return loadDiskCache(this, projectPath);
  }

  async saveDiskCache(projectPath) {
    return saveDiskCache(this, projectPath);
  }

  tryResolveFilePath(currentFilePath, rawPath) {
    return tryResolveFilePath(this, currentFilePath, rawPath);
  }

  async indexWorkspace(projectPath) {
    if (!projectPath || !fs.existsSync(projectPath)) return;
    const currentSession = ++this.indexingSessionId;
    this.projectPath = normalizePath(projectPath);

    const hasCache = this.loadDiskCache(projectPath);
    if (hasCache) {
      this.notifyStatus('ready', { cached: true });
      setTimeout(() => {
        if (this.indexingSessionId === currentSession) {
          this._revalidateWorkspace(currentSession, true);
        }
      }, 500);
      return;
    }

    this.reset();
    this.projectPath = normalizePath(projectPath);
    await this._revalidateWorkspace(currentSession, false);
  }

  async _revalidateWorkspace(currentSession, hasCache) {
    if (this.indexingSessionId !== currentSession) return;
    try {
      const files = await this.scanFilesAsync(this.projectPath);
      if (this.indexingSessionId !== currentSession) return;

      const toIndex = [];
      const filesSet = new Set(files);

      for (const f of files) {
        try {
          const st = fs.statSync(f);
          if (st.size > 200 * 1024) continue;
          const cached = this.fileMtimes.get(f);
          if (!cached || cached.mtimeMs !== st.mtimeMs || cached.size !== st.size) {
            toIndex.push(f);
          }
        } catch (_) {}
      }

      for (const f of this.fileMap.keys()) {
        if (!filesSet.has(f)) {
          this.removeFileFromMaps(f);
        }
      }

      if (toIndex.length > 0) {
        this.isIndexing = true;
        this.indexingProgress = { total: toIndex.length, processed: 0 };
        this.notifyStatus('indexing', { progress: this.indexingProgress });

        const BATCH_SIZE = 15;
        for (let i = 0; i < toIndex.length; i += BATCH_SIZE) {
          if (this.indexingSessionId !== currentSession) return;
          const batch = toIndex.slice(i, i + BATCH_SIZE);
          for (const f of batch) {
            this.indexSingleFile(f);
            this.indexingProgress.processed++;
          }
          this.notifyStatus('indexing', { progress: this.indexingProgress });
          await new Promise((resolve) => setTimeout(resolve, 5));
        }

        this.isIndexing = false;
        await this.saveDiskCache(this.projectPath);
      }

      this.notifyStatus('ready', {
        filesCount: this.fileMap.size,
        symbolsCount: this.symbolMap.size,
        implementationsCount: this.implementationsMap.size,
        usagesSymbolsCount: this.usageMap.size,
      });
    } catch (err) {
      this.isIndexing = false;
      this.notifyStatus('error', { error: err.message });
    }
  }

  async scanFilesAsync(startDir) {
    const results = [];
    const queue = [startDir];
    let dirsVisited = 0;

    while (queue.length > 0) {
      const currentDir = queue.shift();
      try {
        const entries = await fs.promises.readdir(currentDir, { withFileTypes: true });
        for (const entry of entries) {
          const fullPath = path.join(currentDir, entry.name);
          if (entry.isDirectory()) {
            if (shouldIgnoreDir(entry.name, currentDir)) continue;
            queue.push(fullPath);
          } else if (entry.isFile()) {
            const ext = path.extname(entry.name).toLowerCase();
            if (SUPPORTED_EXTS.has(ext)) {
              results.push(normalizePath(fullPath));
            }
          }
        }
      } catch (_) {}

      dirsVisited++;
      if (dirsVisited % 20 === 0) {
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
    }
    return results;
  }

  notifyStatus(status, details = {}) {
    const now = Date.now();
    if (status === 'indexing' && this._lastNotify && now - this._lastNotify < 250) {
      return;
    }
    this._lastNotify = now;
    try {
      const { state } = require('../main/globals.js');
      if (state && state.mainWindow && !state.mainWindow.isDestroyed()) {
        state.mainWindow.webContents.send('symbol-indexer-status', {
          status,
          projectPath: this.projectPath,
          ...details
        });
      }
    } catch (_) {}
  }

  indexSingleFile(filePath, contentOverride = null) {
    const normPath = normalizePath(filePath);
    let content = contentOverride;
    if (content === null) {
      try {
        const stat = fs.statSync(filePath);
        if (stat.size > 200 * 1024) return;
        content = fs.readFileSync(filePath, 'utf8');
        this.fileMtimes.set(normPath, { mtimeMs: stat.mtimeMs, size: stat.size });
      } catch (_) {
        return;
      }
    } else {
      try {
        const stat = fs.statSync(filePath);
        this.fileMtimes.set(normPath, { mtimeMs: stat.mtimeMs, size: stat.size });
      } catch (_) {}
    }

    this.removeFileFromMaps(normPath);
    const fileData = parseFileLines(this, normPath, content);
    this.fileMap.set(normPath, fileData);
  }

  indexUsagesInLine(normPath, lineText, lineNum, getEnclosing) {
    return indexUsagesInLine(this, normPath, lineText, lineNum, getEnclosing);
  }

  addSymbol(name, item) {
    if (!this.symbolMap.has(name)) {
      this.symbolMap.set(name, []);
    }
    this.symbolMap.get(name).push(item);
  }

  removeFileFromMaps(normPath) {
    const existing = this.fileMap.get(normPath);
    if (!existing) return;

    this.symbolMap.forEach((list, name) => {
      this.symbolMap.set(name, list.filter(item => item.filePath !== normPath));
    });

    this.implementationsMap.forEach((set, implName) => {
      const updated = new Set([...set].filter(item => item.filePath !== normPath));
      this.implementationsMap.set(implName, updated);
    });

    this.usageMap.forEach((list, name) => {
      const filtrada = list.filter(u => u.filePath !== normPath);
      if (filtrada.length) this.usageMap.set(name, filtrada);
      else this.usageMap.delete(name);
    });

    this.fileMap.delete(normPath);
    this.fileMtimes.delete(normPath);
  }

  searchDefinitionInFile(filePath, symbolName) {
    return searchDefinitionInFile(filePath, symbolName);
  }

  scanDir(startDir) {
    return scanDir(startDir);
  }

  findUsages(currentFilePath, symbolName) {
    return findUsages(this, currentFilePath, symbolName);
  }

  findDefinition(currentFilePath, symbolName, lineText = '') {
    return findDefinition(this, currentFilePath, symbolName, lineText);
  }

  resolveReceiverType(normCurrent, symbolName, lineText) {
    return resolveReceiverType(this, normCurrent, symbolName, lineText);
  }

  findImplementations(currentFilePath, lineNum, symbolName) {
    return findImplementations(this, currentFilePath, lineNum, symbolName);
  }

  getGutterInfo(currentFilePath) {
    return getGutterInfo(this, currentFilePath);
  }
}

const instance = new SymbolIndexer();
module.exports = instance;
