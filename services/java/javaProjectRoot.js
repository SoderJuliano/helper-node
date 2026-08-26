// services/java/javaProjectRoot.js
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function normalizePath(p) {
  if (!p) return '';
  let norm = path.normalize(p).replace(/\\/g, '/');
  if (norm.length >= 2 && norm[1] === ':') {
    norm = norm[0].toUpperCase() + norm.substring(1);
  }
  return norm;
}

function safeMtimeMs(p) {
  try {
    return fs.statSync(p).mtimeMs;
  } catch (_) {
    return 0;
  }
}

function hashOf(str) {
  return crypto.createHash('md5').update(str).digest('hex').slice(0, 16);
}

function findJavaProjectRoot(filePath) {
  if (!filePath) return null;
  let cleanPath = filePath;
  if (cleanPath.includes('.jar!')) {
    cleanPath = cleanPath.split('.jar!')[0];
  }
  let res = _searchJavaProjectRoot(cleanPath);
  if (!res) {
    try {
      const { workspace } = require('../../main/globals.js');
      const dir = (workspace && workspace.list ? workspace.list() : []).find((a) => a.type === 'dir');
      if (dir && dir.path) {
        res = _searchJavaProjectRoot(dir.path);
      }
    } catch (_) {}
  }
  return res;
}

function _searchJavaProjectRoot(filePath) {
  let dir = path.dirname(filePath);
  const fsRoot = path.parse(dir).root;
  let type = null;
  let moduleDir = null;
  let buildFile = null;

  while (dir && dir.length >= fsRoot.length) {
    if (!type) {
      if (fs.existsSync(path.join(dir, 'pom.xml'))) {
        type = 'maven';
        moduleDir = dir;
        buildFile = path.join(dir, 'pom.xml');
        return { type, rootDir: dir, moduleDir, buildFile };
      }
      const bg = path.join(dir, 'build.gradle');
      const bgk = path.join(dir, 'build.gradle.kts');
      if (fs.existsSync(bg) || fs.existsSync(bgk)) {
        type = 'gradle';
        moduleDir = dir;
        buildFile = fs.existsSync(bg) ? bg : bgk;
      }
    }

    if (type === 'gradle') {
      const hasSettings = fs.existsSync(path.join(dir, 'settings.gradle')) ||
        fs.existsSync(path.join(dir, 'settings.gradle.kts'));
      const hasWrapper = fs.existsSync(path.join(dir, 'gradlew')) ||
        fs.existsSync(path.join(dir, 'gradlew.bat'));
      if (hasSettings || hasWrapper) {
        return { type: 'gradle', rootDir: dir, moduleDir, buildFile };
      }
    }

    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  if (type === 'gradle') {
    return { type: 'gradle', rootDir: moduleDir, moduleDir, buildFile };
  }
  return null;
}

module.exports = {
  normalizePath,
  safeMtimeMs,
  hashOf,
  findJavaProjectRoot,
  _searchJavaProjectRoot,
};
