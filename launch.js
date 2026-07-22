#!/usr/bin/env node
// launch.js — entrypoint cross-platform do `npm start`.
//
// Linux: delega ao helper-node.sh (setup de hotkeys COSMIC/xbindkeys, re-exec
//        flatpak, PATH do nvm — toda a lógica específica de Linux fica lá).
// Windows/macOS: sobe o Electron direto. Atalhos globais (Ctrl+Shift+S etc.)
//        são registrados pelo próprio app via globalShortcut do Electron, que
//        funciona nativamente nessas plataformas — não precisa de script de SO.

const { spawn } = require('child_process');
const path = require('path');

const appDir = __dirname;

if (process.platform === 'linux') {
  const child = spawn('bash', ['./helper-node.sh', '--local', ...process.argv.slice(2)], {
    cwd: appDir,
    stdio: 'inherit',
  });
  child.on('exit', (code) => process.exit(code ?? 0));
  child.on('error', (err) => {
    console.error('Falha ao iniciar helper-node.sh:', err.message);
    process.exit(1);
  });
} else {
  // `require('electron')` em contexto Node puro retorna o caminho do executável.
  const electronPath = require('electron');
  const child = spawn(electronPath, [appDir, ...process.argv.slice(2)], {
    cwd: appDir,
    stdio: 'inherit',
    env: process.env,
  });
  child.on('exit', (code) => process.exit(code ?? 0));
  child.on('error', (err) => {
    console.error('Falha ao iniciar o Electron:', err.message);
    process.exit(1);
  });
}
