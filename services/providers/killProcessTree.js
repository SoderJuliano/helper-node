// Mata um processo filho E TODA a sua descendência.
//
// No Windows: os CLIs são spawnados com `shell: true`, então o filho direto é o
// cmd.exe. `taskkill /T /F` derruba a árvore inteira a partir do PID.
//
// No POSIX (Linux e macOS): ferramentas agenticas (como o AGY / Antigravity CLI)
// ignoram SIGINT em modo de impressão (--print) ou spawnam subprocessos (subagents,
// python, ripgrep, bash). Encerramos o Process Group inteiro (-pid) caso tenha sido
// spawnado com `detached: true`, além de rastrear e matar recursivamente todos os
// PIDs descendentes via /proc/<pid>/task/<pid>/children (ou pgrep -P) usando
// escalonamento SIGTERM -> SIGKILL para garantir que nenhum processo órfão continue
// rodando ou gastando tokens após o usuário clicar em "Parar IA" ou "×".
const { spawn, execSync } = require('child_process');
const fs = require('fs');

function getDescendantPids(rootPid) {
  const pids = [];
  const queue = [rootPid];
  const seen = new Set([rootPid]);

  while (queue.length > 0) {
    const curr = queue.shift();
    let children = [];

    try {
      // 1. Tenta ler direto do /proc no Linux (ultrarrápido, sem spawn de subprocesso)
      const data = fs.readFileSync(`/proc/${curr}/task/${curr}/children`, 'utf8');
      children = data.trim().split(/\s+/).map(x => parseInt(x, 10)).filter(x => !isNaN(x) && x > 0);
    } catch (_) {
      // 2. Fallback via pgrep -P (funciona no macOS e distros Linux com /proc restrito)
      try {
        const out = execSync(`pgrep -P ${curr}`, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'], timeout: 600 });
        children = out.trim().split(/\s+/).map(x => parseInt(x, 10)).filter(x => !isNaN(x) && x > 0);
      } catch (_) {}
    }

    for (const c of children) {
      if (!seen.has(c)) {
        seen.add(c);
        pids.push(c);
        queue.push(c);
      }
    }
  }
  return pids;
}

function killProcessTree(proc, signal = 'SIGTERM') {
  return new Promise((resolve) => {
    const pid = typeof proc === 'number' ? proc : (proc && proc.pid ? proc.pid : null);
    if (!pid || pid <= 0) return resolve();

    if (process.platform === 'win32') {
      let settled = false;
      const finish = () => { if (!settled) { settled = true; resolve(); } };

      try {
        const tk = spawn('taskkill', ['/pid', String(pid), '/T', '/F'], {
          windowsHide: true,
          stdio: 'ignore',
        });
        tk.on('error', () => {
          try {
            if (proc && typeof proc.kill === 'function') proc.kill(signal);
            else process.kill(pid, signal);
          } catch (_) {}
          finish();
        });
        tk.on('close', finish);
      } catch (_) {
        try {
          if (proc && typeof proc.kill === 'function') proc.kill(signal);
          else process.kill(pid, signal);
        } catch (_) {}
        finish();
      }
      return;
    }

    // POSIX (Linux e macOS)
    const descendants = getDescendantPids(pid);
    const allPids = [...descendants, pid];

    // 1. Tenta matar pelo Process Group (caso tenha sido spawnado com detached: true)
    try { process.kill(-pid, signal); } catch (_) {}

    // 2. Envia sinal a cada PID descendente e ao PID raiz
    for (const p of allPids) {
      try { process.kill(p, signal); } catch (_) {}
    }

    if (signal === 'SIGKILL') {
      return resolve();
    }

    // 3. Grace period curto (150ms): se algo ainda estiver vivo, força SIGKILL
    setTimeout(() => {
      let anyAlive = false;
      for (const p of allPids) {
        try {
          process.kill(p, 0); // teste de existência
          anyAlive = true;
          try { process.kill(p, 'SIGKILL'); } catch (_) {}
        } catch (_) {}
      }

      try {
        process.kill(-pid, 0);
        anyAlive = true;
        try { process.kill(-pid, 'SIGKILL'); } catch (_) {}
      } catch (_) {}

      if (anyAlive) {
        setTimeout(resolve, 50);
      } else {
        resolve();
      }
    }, 150);
  });
}

module.exports = { killProcessTree, getDescendantPids };
