// services/java/javaZipReader.js
const fs = require('fs');
const zlib = require('zlib');

function safeMtimeMs(p) {
  try {
    return fs.statSync(p).mtimeMs;
  } catch (_) {
    return 0;
  }
}

// Cache local de classes em JARs
const jarClassCache = new Map();

function readZipClassEntries(jarPath) {
  const mtime = safeMtimeMs(jarPath);
  const cacheKey = jarPath + '|' + mtime;
  if (jarClassCache.has(cacheKey)) {
    return jarClassCache.get(cacheKey);
  }

  const results = [];
  let fd;
  try {
    fd = fs.openSync(jarPath, 'r');
    const size = fs.fstatSync(fd).size;
    if (size < 22) return results;

    const tailSize = Math.min(size, 65557);
    const tailBuf = Buffer.alloc(tailSize);
    fs.readSync(fd, tailBuf, 0, tailSize, size - tailSize);

    let eocdOffset = -1;
    for (let i = tailBuf.length - 22; i >= 0; i--) {
      if (tailBuf.readUInt32LE(i) === 0x06054b50) { eocdOffset = i; break; }
    }
    if (eocdOffset === -1) return results;

    const totalEntries = tailBuf.readUInt16LE(eocdOffset + 10);
    const centralDirOffset = tailBuf.readUInt32LE(eocdOffset + 16);
    if (centralDirOffset >= size) return results;

    const cdSize = size - centralDirOffset;
    const cdBuf = Buffer.alloc(cdSize);
    fs.readSync(fd, cdBuf, 0, cdSize, centralDirOffset);

    let pos = 0;
    let count = 0;
    while (pos + 46 <= cdBuf.length && count < totalEntries) {
      const sig = cdBuf.readUInt32LE(pos);
      if (sig !== 0x02014b50) break;
      const nameLen = cdBuf.readUInt16LE(pos + 28);
      const extraLen = cdBuf.readUInt16LE(pos + 30);
      const commentLen = cdBuf.readUInt16LE(pos + 32);
      const nameStart = pos + 46;
      if (nameStart + nameLen > cdBuf.length) break;
      const name = cdBuf.toString('utf8', nameStart, nameStart + nameLen);
      if (name.endsWith('.class')) {
        if (name.startsWith('META-INF/versions/')) {
          const m = /^META-INF\/versions\/\d+\/(.+)$/.exec(name);
          if (m && !m[1].startsWith('META-INF/')) results.push(m[1]);
        } else if (!name.startsWith('META-INF/')) {
          results.push(name);
        }
      }
      const entryLen = Math.max(1, 46 + nameLen + extraLen + commentLen);
      pos += entryLen;
      count++;
    }
  } catch (_) {
  } finally {
    if (fd !== undefined) {
      try { fs.closeSync(fd); } catch (_) {}
    }
  }

  jarClassCache.set(cacheKey, results);
  return results;
}

function readZipEntryRawBuffer(zipPath, entryName) {
  let fd;
  try {
    fd = fs.openSync(zipPath, 'r');
    const size = fs.fstatSync(fd).size;
    if (size < 22) return null;

    const tailSize = Math.min(size, 65557);
    const tailBuf = Buffer.alloc(tailSize);
    fs.readSync(fd, tailBuf, 0, tailSize, size - tailSize);

    let eocdOffset = -1;
    for (let i = tailBuf.length - 22; i >= 0; i--) {
      if (tailBuf.readUInt32LE(i) === 0x06054b50) { eocdOffset = i; break; }
    }
    if (eocdOffset === -1) return null;

    const totalEntries = tailBuf.readUInt16LE(eocdOffset + 10);
    const centralDirOffset = tailBuf.readUInt32LE(eocdOffset + 16);
    if (centralDirOffset >= size) return null;

    const cdSize = size - centralDirOffset;
    const cdBuf = Buffer.alloc(cdSize);
    fs.readSync(fd, cdBuf, 0, cdSize, centralDirOffset);

    let pos = 0;
    let count = 0;
    let localHeaderOffset = -1;
    let compMethod = -1;
    let compSize = -1;
    const normEntryName = entryName.replace(/\\/g, '/').replace(/^\/+/, '');

    while (pos + 46 <= cdBuf.length && count < totalEntries) {
      const sig = cdBuf.readUInt32LE(pos);
      if (sig !== 0x02014b50) break;
      const method = cdBuf.readUInt16LE(pos + 10);
      const csize = cdBuf.readUInt32LE(pos + 20);
      const nameLen = cdBuf.readUInt16LE(pos + 28);
      const extraLen = cdBuf.readUInt16LE(pos + 30);
      const commentLen = cdBuf.readUInt16LE(pos + 32);
      const lho = cdBuf.readUInt32LE(pos + 42);
      const nameStart = pos + 46;
      if (nameStart + nameLen > cdBuf.length) break;
      const name = cdBuf.toString('utf8', nameStart, nameStart + nameLen);
      if (name === normEntryName || name.endsWith('/' + normEntryName)) {
        localHeaderOffset = lho;
        compMethod = method;
        compSize = csize;
        break;
      }
      const entryLen = Math.max(1, 46 + nameLen + extraLen + commentLen);
      pos += entryLen;
      count++;
    }
    if (localHeaderOffset === -1) return null;

    const lfhBuf = Buffer.alloc(30);
    fs.readSync(fd, lfhBuf, 0, 30, localHeaderOffset);
    if (lfhBuf.readUInt32BE(0) !== 0x504B0304 && lfhBuf.readUInt32LE(0) !== 0x04034b50) return null;
    const lNameLen = lfhBuf.readUInt16LE(26);
    const lExtraLen = lfhBuf.readUInt16LE(28);
    const dataOffset = localHeaderOffset + 30 + lNameLen + lExtraLen;

    const dataBuf = Buffer.alloc(compSize);
    fs.readSync(fd, dataBuf, 0, compSize, dataOffset);

    if (compMethod === 0) return dataBuf;
    if (compMethod === 8) return zlib.inflateRawSync(dataBuf);
    return null;
  } catch (_) {
    return null;
  } finally {
    if (fd !== undefined) {
      try { fs.closeSync(fd); } catch (_) {}
    }
  }
}

function readZipEntryContent(zipPath, entryName) {
  const buf = readZipEntryRawBuffer(zipPath, entryName);
  return buf ? buf.toString('utf8') : null;
}

module.exports = {
  jarClassCache,
  readZipClassEntries,
  readZipEntryRawBuffer,
  readZipEntryContent,
};
