// services/providers/gemini-cli/GeminiCliBinary.js
const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const CANDIDATE_COMMANDS = ['agy', 'gemini', 'gemini-cli'];

async function resolveBinary() {
  if (process.platform === 'win32') {
    const localAgy = path.join(os.homedir(), 'AppData', 'Local', 'agy', 'bin', 'agy.exe');
    if (fs.existsSync(localAgy)) {
      return localAgy;
    }
  }

  const locator = process.platform === 'win32' ? 'where.exe' : 'which';
  for (const cmd of CANDIDATE_COMMANDS) {
    try {
      const fullPath = await new Promise((resolve, reject) => {
        execFile(locator, [cmd], (err, stdout) => {
          if (err || !stdout) return reject(err || new Error('not found'));
          const lines = stdout.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
          const exePath = lines.find(s => /\.exe$/i.test(s));
          resolve(exePath || lines[0]);
        });
      });
      return fullPath;
    } catch (_) {
      // try next candidate
    }
  }
  return null;
}

module.exports = { resolveBinary, CANDIDATE_COMMANDS };
