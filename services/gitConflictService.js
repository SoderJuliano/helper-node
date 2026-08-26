// services/gitConflictService.js
// Detecção de conflitos Git, extração 3-way (Base, Ours, Theirs), cálculo de chunks e resolução de merge.

const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const {
  computeLcs,
  computeDiffHunks,
  align3Way,
  parseConflictMarkers,
} = require('./gitConflict/gitConflictDiff');

function execGit(args, cwd, timeoutMs = 5000) {
  return new Promise((resolve) => {
    execFile('git', ['-C', cwd, ...args], { timeout: timeoutMs, encoding: 'utf8', maxBuffer: 1024 * 1024 * 20 }, (err, stdout, stderr) => {
      resolve({ err, stdout: stdout || '', stderr: stderr || '' });
    });
  });
}

const GitConflictService = {
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

      const branchRes = await execGit(['rev-parse', '--abbrev-ref', 'HEAD'], projectPath);
      const currentBranch = branchRes.stdout.trim() || 'HEAD';

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

  async getFile3WayData(projectPath, relPath) {
    if (!projectPath || !relPath) {
      return { ok: false, error: 'Caminho do projeto ou arquivo inválido' };
    }

    try {
      const gitRelPath = String(relPath || '').replace(/\\/g, '/').replace(/^\/+/, '');
      const fullPath = path.join(projectPath, gitRelPath);
      const statusInfo = await this.detectGitConflicts(projectPath);

      const baseRes = await execGit(['show', `:1:${gitRelPath}`], projectPath);
      const oursRes = await execGit(['show', `:2:${gitRelPath}`], projectPath);
      const theirsRes = await execGit(['show', `:3:${gitRelPath}`], projectPath);

      let baseText = baseRes.err ? '' : baseRes.stdout;
      let oursText = oursRes.err ? '' : oursRes.stdout;
      let theirsText = theirsRes.err ? '' : theirsRes.stdout;
      let chunks = [];

      if (!oursRes.err || !theirsRes.err || !baseRes.err) {
        const baseLines = baseText ? baseText.split(/\r?\n/) : [];
        const oursLines = oursText ? oursText.split(/\r?\n/) : [];
        const theirsLines = theirsText ? theirsText.split(/\r?\n/) : [];
        chunks = align3Way(baseLines, oursLines, theirsLines);
      } else {
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

      const initialResultLines = [];
      for (const chunk of chunks) {
        if (chunk.type === 'EQUAL' || chunk.type === 'SAME_CHANGE') {
          initialResultLines.push(...chunk.leftLines);
        } else if (chunk.type === 'LEFT_ONLY') {
          initialResultLines.push(...chunk.leftLines);
        } else if (chunk.type === 'RIGHT_ONLY') {
          initialResultLines.push(...chunk.rightLines);
        } else if (chunk.type === 'CONFLICT') {
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

module.exports = {
  GitConflictService,
  align3Way,
  parseConflictMarkers,
  computeLcs,
  computeDiffHunks,
};
