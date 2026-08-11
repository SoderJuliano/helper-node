// Mata um processo filho E TODA a sua descendência.
//
// No Windows os CLIs são spawnados com `shell: true` (o shim .cmd instalado
// pelo npm não é executável direto pelo spawn), então o filho DIRETO é o
// cmd.exe — matá-lo deixa o processo real da CLI vivo, ainda gastando tokens e
// ESCREVENDO nos arquivos do projeto. Era exatamente esse o sintoma de "cliquei
// em Parar IA, a tela voltou ao normal e a CLI continuou alterando os
// arquivos". `taskkill /T` derruba a árvore inteira a partir do pid.
//
// O sinal só vale no POSIX. No Windows o Node não tem SIGINT de verdade
// (`proc.kill()` vira TerminateProcess de qualquer jeito), então não se perde
// nenhuma chance de encerramento gracioso indo direto pro `/F`.
//
// No POSIX mantemos o kill no filho direto: sem `detached: true` o processo
// está no MESMO grupo do Electron, e matar o grupo (`process.kill(-pid)`)
// derrubaria o próprio app junto.
const { spawn } = require('child_process');

function killProcessTree(proc, signal = 'SIGINT') {
  return new Promise((resolve) => {
    if (!proc || !proc.pid) return resolve();

    if (process.platform !== 'win32') {
      try { proc.kill(signal); } catch (_) {}
      return resolve();
    }

    let settled = false;
    const finish = () => { if (!settled) { settled = true; resolve(); } };

    try {
      const tk = spawn('taskkill', ['/pid', String(proc.pid), '/T', '/F'], {
        windowsHide: true,
        stdio: 'ignore',
      });
      // Se o taskkill não existir/falhar em spawnar, ainda tenta o kill direto
      // — melhor matar só o cmd.exe do que não matar nada.
      tk.on('error', () => { try { proc.kill(signal); } catch (_) {} finish(); });
      tk.on('close', finish);
    } catch (_) {
      try { proc.kill(signal); } catch (_) {}
      finish();
    }
  });
}

module.exports = { killProcessTree };
