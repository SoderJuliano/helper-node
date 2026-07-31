// Sonda o binário `copilot` de verdade: resolução do executável + listagem de modelos.
// Uso: node scripts/test-copilot-probe.js
const { execFile, spawn } = require('child_process');

function run(bin, args, useShell) {
  return new Promise((resolve) => {
    execFile(bin, args, { timeout: 30000, windowsHide: true, shell: useShell, maxBuffer: 4 * 1024 * 1024 },
      (err, stdout, stderr) => resolve({ err, out: (stdout || '') + '\n' + (stderr || '') }));
  });
}

(async () => {
  const { resolveBinary } = require('../services/providers/copilot-cli/CopilotCliProcess');
  const bin = await resolveBinary();
  console.log('resolveBinary() ->', JSON.stringify(bin));
  if (!bin) { console.log('FALHOU: binário não encontrado'); process.exit(1); }

  // Reproduz o spawn exatamente como o app faz
  const needsShell = process.platform === 'win32' && /\.(cmd|bat)$/i.test(bin);
  console.log('needsShell ->', needsShell);
  await new Promise((resolve) => {
    const p = spawn(bin, ['--version'], { shell: needsShell, windowsHide: true });
    let out = '';
    p.stdout.on('data', d => out += d);
    p.on('error', (e) => { console.log('SPAWN ERROR ->', e.code, e.message); resolve(); });
    p.on('close', (c) => { console.log('spawn close code=' + c, '| version:', out.trim().split('\n')[0]); resolve(); });
  });

  // Fonte de modelos: `copilot help config`
  const { out } = await run(bin, ['help', 'config'], needsShell);
  const { parseModelIdsFromHelpConfig } = require('../services/providers/copilot-cli/CopilotCliModels');
  const ids = parseModelIdsFromHelpConfig(out);
  console.log('\nIDs parseados de `help config`:', ids.length);
  console.log(JSON.stringify(ids, null, 2));

  // Caminho público completo (o que a UI realmente consome)
  const { getModels } = require('../services/providers/copilot-cli/CopilotCliModels');
  const models = await getModels();
  console.log('\ngetModels() ->', models.length, 'modelos');
  console.log(models.map(m => `${m.id}`).join(', '));
})();
