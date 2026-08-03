// Teste end-to-end do provider Copilot CLI: manda um prompt de verdade com
// espaços e aspas e confere se a resposta volta. Serve pra provar que o bug do
// "Invalid command format" (argv sem quoting sob shell: true no Windows) não
// voltou.
//
// Uso: node scripts/test-copilot-hello.js
const { CopilotCliProcess, resolveBinary, buildSpawnCommand } = require('../services/providers/copilot-cli/CopilotCliProcess');

const PROMPTS = [
  'Diga apenas: hello',
  'Responda somente com a palavra hello, sem pontuacao e sem explicacao',
  'Repita exatamente esta frase entre aspas: "hello mundo 100% ok"',
];

function runOnce(prompt, cwd) {
  return new Promise(async (resolve) => {
    const proc = new CopilotCliProcess();
    let out = '';
    let err = '';
    const timer = setTimeout(() => {
      proc.kill().catch(() => {});
      resolve({ ok: false, code: 'TIMEOUT', out, err });
    }, 180000);

    proc.onData(c => { out += c; });
    proc.onStderr(l => { err += l + '\n'; });
    proc.onClose((code) => {
      clearTimeout(timer);
      resolve({ ok: code === 0, code, out, err });
    });
    proc.onError((e) => {
      clearTimeout(timer);
      resolve({ ok: false, code: e.code || 'ERROR', out, err: err + e.message });
    });

    try {
      await proc.start({ cwd, prompt });
    } catch (e) {
      clearTimeout(timer);
      resolve({ ok: false, code: 'START_FAIL', out, err: e.message });
    }
  });
}

(async () => {
  const cwd = process.cwd();
  const bin = await resolveBinary();
  console.log('binário     ->', JSON.stringify(bin));
  if (!bin) { console.log('FALHOU: copilot não encontrado no PATH'); process.exit(1); }

  const plan = buildSpawnCommand(bin, ['-p', 'exemplo com espaço', '--allow-all-tools']);
  console.log('estratégia  ->', plan.strategy);
  console.log('command     ->', plan.command);
  console.log('args        ->', JSON.stringify(plan.args));
  console.log('shell       ->', !!plan.options.shell, '\n');

  let failures = 0;
  for (const prompt of PROMPTS) {
    process.stdout.write(`> ${prompt}\n`);
    const r = await runOnce(prompt, cwd);
    const body = (r.out || '').trim();
    const preview = body.replace(/\s+/g, ' ').slice(0, 200);
    if (r.ok && /hello/i.test(body)) {
      console.log(`  PASSOU (code=${r.code}) :: ${preview}\n`);
    } else {
      failures++;
      console.log(`  FALHOU (code=${r.code})`);
      console.log(`  stdout: ${preview}`);
      console.log(`  stderr: ${(r.err || '').trim().slice(0, 400)}\n`);
    }
  }

  console.log(failures === 0 ? 'TODOS OS TESTES PASSARAM' : `${failures}/${PROMPTS.length} FALHARAM`);
  process.exit(failures === 0 ? 0 : 1);
})();
