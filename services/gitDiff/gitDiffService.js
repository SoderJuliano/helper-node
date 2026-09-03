// services/gitDiff/gitDiffService.js
// Detecção de arquivos alterados (unpushed commits, uncommitted, untracked) e geração de diffs.

const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { alignDiff } = require('./gitDiffAligner');

const BINARY_EXTENSIONS = new Set([
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'ico', 'bmp', 'tiff',
  'exe', 'dll', 'so', 'dylib', 'bin', 'dat', 'traineddata',
  'zip', 'tar', 'gz', '7z', 'rar', 'jar', 'war', 'class',
  'pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx',
  'mp3', 'wav', 'ogg', 'mp4', 'avi', 'mkv', 'mov', 'flac', 'webm'
]);

function execGit(args, cwd, timeoutMs = 7000) {
  const finalArgs = ['--no-optional-locks', '-c', 'core.quotepath=false', '-C', cwd, ...args];
  return new Promise((resolve) => {
    execFile('git', finalArgs, { timeout: timeoutMs, encoding: 'utf8', maxBuffer: 1024 * 1024 * 20 }, (err, stdout, stderr) => {
      resolve({ err, stdout: stdout || '', stderr: stderr || '' });
    });
  });
}

function isBinaryPath(relPath) {
  const ext = path.extname(relPath).toLowerCase().replace(/^\./, '');
  return BINARY_EXTENSIONS.has(ext);
}

const GitDiffService = {
  async findBaseCommit(projectPath) {
    // 1. Tenta encontrar a branch de upstream configurada (@{u})
    const upstreamRes = await execGit(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'], projectPath);
    const upstream = upstreamRes.stdout.trim();

    if (upstream && !upstreamRes.err) {
      const mbRes = await execGit(['merge-base', 'HEAD', upstream], projectPath);
      const mb = mbRes.stdout.trim();
      if (mb && !mbRes.err) return { baseRef: mb, upstreamName: upstream };
    }

    // 2. Tenta branches remotas comuns (origin/HEAD, origin/master, origin/main)
    for (const candidate of ['origin/master', 'origin/main', 'origin/HEAD']) {
      const mbRes = await execGit(['merge-base', 'HEAD', candidate], projectPath);
      const mb = mbRes.stdout.trim();
      if (mb && !mbRes.err) return { baseRef: mb, upstreamName: candidate };
    }

    // 3. Se não houver remotos, tenta HEAD ou commit raiz
    const headRes = await execGit(['rev-parse', 'HEAD'], projectPath);
    const head = headRes.stdout.trim();
    if (head && !headRes.err) {
      // Se tiver mais de um commit local, tenta achar a raiz
      const rootRes = await execGit(['rev-list', '--max-parents=0', 'HEAD'], projectPath);
      const root = rootRes.stdout.trim().split(/\r?\n/)[0];
      return { baseRef: root || head, upstreamName: 'HEAD (Local)' };
    }

    // 4. Repositório novo sem commits (empty tree SHA)
    return { baseRef: '4b825dc642cb6eb9a060e54bf8d69288fbee4904', upstreamName: 'Novo Repositório' };
  },

  async getDiffSummary(projectPath) {
    if (!projectPath || !fs.existsSync(projectPath)) {
      return { ok: false, error: 'Diretório do projeto não encontrado.' };
    }

    const gitDir = path.join(projectPath, '.git');
    if (!fs.existsSync(gitDir)) {
      return { ok: false, error: 'O diretório selecionado não é um repositório Git.' };
    }

    try {
      const branchRes = await execGit(['rev-parse', '--abbrev-ref', 'HEAD'], projectPath);
      const currentBranch = branchRes.stdout.trim() || 'master';

      const { baseRef, upstreamName } = await this.findBaseCommit(projectPath);

      // Coleta arquivos com alterações entre baseRef e o diretório de trabalho
      const diffNameRes = await execGit(['diff', '--name-status', baseRef], projectPath);
      const untrackedRes = await execGit(['ls-files', '--others', '--exclude-standard'], projectPath);

      const filesMap = new Map();

      // Processa linhas do diff --name-status (M, A, D, R...)
      const diffLines = diffNameRes.stdout.split(/\r?\n/);
      for (const line of diffLines) {
        if (!line.trim()) continue;
        const parts = line.split(/\t+/);
        const rawCode = parts[0] || 'M';
        const statusCode = rawCode.charAt(0).toUpperCase();
        let relPath = parts[1] || '';
        if (statusCode === 'R' && parts[2]) {
          relPath = parts[2]; // Destino do rename
        }
        relPath = relPath.trim().replace(/\\/g, '/').replace(/^"|"$/g, '');
        if (!relPath) continue;

        let statusText = 'modified';
        if (statusCode === 'A') statusText = 'added';
        else if (statusCode === 'D') statusText = 'deleted';
        else if (statusCode === 'R') statusText = 'renamed';

        filesMap.set(relPath, {
          relPath,
          fileName: path.basename(relPath),
          dirName: path.dirname(relPath) === '.' ? '' : path.dirname(relPath).replace(/\\/g, '/'),
          status: statusText,
          statusCode: statusCode,
          isBinary: isBinaryPath(relPath)
        });
      }

      // Processa arquivos untracked
      const untrackedLines = untrackedRes.stdout.split(/\r?\n/);
      for (const line of untrackedLines) {
        const relPath = line.trim().replace(/\\/g, '/').replace(/^"|"$/g, '');
        if (!relPath) continue;
        if (!filesMap.has(relPath)) {
          filesMap.set(relPath, {
            relPath,
            fileName: path.basename(relPath),
            dirName: path.dirname(relPath) === '.' ? '' : path.dirname(relPath).replace(/\\/g, '/'),
            status: 'untracked',
            statusCode: 'U',
            isBinary: isBinaryPath(relPath)
          });
        }
      }

      const files = Array.from(filesMap.values()).sort((a, b) => a.relPath.localeCompare(b.relPath));

      return {
        ok: true,
        data: {
          projectPath,
          currentBranch,
          upstreamName,
          baseRef,
          filesCount: files.length,
          files
        }
      };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  },

  async getFileDiff(projectPath, relPath, baseRef) {
    if (!projectPath || !relPath) {
      return { ok: false, error: 'Parâmetros inválidos para diff.' };
    }

    try {
      const gitRelPath = String(relPath).replace(/\\/g, '/').replace(/^\/+/, '');
      const fullPath = path.join(projectPath, gitRelPath);
      const isBinary = isBinaryPath(gitRelPath);

      if (isBinary) {
        return {
          ok: true,
          data: {
            relPath: gitRelPath,
            fileName: path.basename(gitRelPath),
            isBinary: true,
            rows: [],
            additions: 0,
            deletions: 0,
            totalLines: 0
          }
        };
      }

      let ref = baseRef;
      if (!ref) {
        const baseInfo = await this.findBaseCommit(projectPath);
        ref = baseInfo.baseRef;
      }

      // Conteúdo antigo (versão no baseRef)
      let oldText = '';
      const showRes = await execGit(['show', `${ref}:${gitRelPath}`], projectPath);
      if (!showRes.err) {
        oldText = showRes.stdout;
      }

      // Conteúdo novo (versão em disco)
      let newText = '';
      if (fs.existsSync(fullPath)) {
        try {
          newText = fs.readFileSync(fullPath, 'utf8');
        } catch (_) {
          newText = '';
        }
      }

      const { rows, additions, deletions, totalLines } = alignDiff(oldText, newText);

      return {
        ok: true,
        data: {
          relPath: gitRelPath,
          fileName: path.basename(gitRelPath),
          isBinary: false,
          rows,
          additions,
          deletions,
          totalLines,
          oldText,
          newText
        }
      };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  },

  async getGitFileLineStatus(filePath) {
    if (!filePath || typeof filePath !== 'string' || filePath.includes('.jar!') || filePath.includes('.zip!')) {
      return { ok: true, lines: {} };
    }

    try {
      const cwd = path.dirname(filePath);
      if (!fs.existsSync(cwd)) return { ok: true, lines: {} };

      const topLevelRes = await execGit(['rev-parse', '--show-toplevel'], cwd);
      const repoRoot = topLevelRes.stdout.trim();
      if (topLevelRes.err || !repoRoot) {
        return { ok: true, lines: {} };
      }

      const relPath = path.relative(repoRoot, filePath).replace(/\\/g, '/');

      // 1. Status do arquivo
      const statusRes = await execGit(['status', '--porcelain', '-uall', '--', relPath], repoRoot);
      const statusLine = (statusRes.stdout || '').trim();

      if (!statusLine) {
        // Arquivo sem alterações (comitado e limpo)
        return { ok: true, lines: {} };
      }

      if (statusLine.startsWith('??')) {
        // Arquivo novo não rastreado
        return { ok: true, allAdded: true, lines: {} };
      }

      const linesMap = {};
      const hunkRegex = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/gm;

      // 2. Diff em relação ao HEAD
      const headDiffRes = await execGit(['diff', '-U0', 'HEAD', '--', relPath], repoRoot);
      const diffText = headDiffRes.stdout || '';

      let m;
      while ((m = hunkRegex.exec(diffText)) !== null) {
        const oldStart = parseInt(m[1], 10);
        const oldCount = m[2] !== undefined ? parseInt(m[2], 10) : 1;
        const newStart = parseInt(m[3], 10);
        const newCount = m[4] !== undefined ? parseInt(m[4], 10) : 1;

        if (newCount > 0) {
          const type = (oldCount === 0) ? 'A' : 'M';
          for (let i = 0; i < newCount; i++) {
            linesMap[newStart + i] = type;
          }
        } else if (oldCount > 0 && newCount === 0) {
          linesMap[Math.max(1, newStart)] = 'M';
        }
      }

      // 3. Checa alterações adicionadas no stage (git diff --cached)
      if (statusLine.startsWith('A ') || statusLine.startsWith('AM')) {
        const stagedRes = await execGit(['diff', '--cached', '-U0', 'HEAD', '--', relPath], repoRoot);
        const stagedText = stagedRes.stdout || '';
        let sm;
        while ((sm = hunkRegex.exec(stagedText)) !== null) {
          const oldCount = sm[2] !== undefined ? parseInt(sm[2], 10) : 1;
          const newStart = parseInt(sm[3], 10);
          const newCount = sm[4] !== undefined ? parseInt(sm[4], 10) : 1;
          if (newCount > 0 && oldCount === 0) {
            for (let i = 0; i < newCount; i++) {
              linesMap[newStart + i] = 'A';
            }
          }
        }
      }

      return { ok: true, lines: linesMap };
    } catch (e) {
      return { ok: false, error: e.message, lines: {} };
    }
  }
};

module.exports = {
  GitDiffService,
  execGit
};
