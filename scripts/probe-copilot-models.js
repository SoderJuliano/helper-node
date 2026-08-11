#!/usr/bin/env node
// Descobre QUAL fonte do Copilot CLI devolve só os modelos que a sua conta/org
// liberou — hoje o app lista o catálogo inteiro do binário e por isso aparecem
// modelos que a organização bloqueia.
//
// Fontes comparadas:
//   1. `copilot help config`  → catálogo do BINÁRIO (é o que o app usa hoje).
//      Roda sem login. Pode ser MAIOR que o que a sua conta pode usar.
//   2. `copilot --acp` (Agent Client Protocol, JSON-RPC no stdio) → a sessão é
//      autenticada, então se ele devolver lista de modelos, ela é a filtrada.
//      EXIGE login.
//
// Rode com o Copilot autenticado:
//     copilot login          (ou defina COPILOT_GITHUB_TOKEN / GH_TOKEN)
//     node scripts/probe-copilot-models.js
//
// A saída diz se a fonte 2 existe. Se existir, dá pra passar o seletor de
// modelos do app pra ela; se não existir, não há como filtrar sem capturar o
// TUI interativo com pty.

const { spawn } = require('child_process');
const { resolveBinary, getEnrichedEnv } = require('../services/providers/copilot-cli/CopilotCliProcess');
const { parseModelIdsFromHelpConfig } = require('../services/providers/copilot-cli/CopilotCliModels');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const needsShell = (bin) => process.platform === 'win32' && /\.(cmd|bat)$/i.test(bin);

function runOnce(bin, args) {
  return new Promise((resolve) => {
    const p = spawn(bin, args, {
      shell: needsShell(bin), windowsHide: true, env: getEnrichedEnv(),
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    p.stdout.on('data', (c) => (out += c));
    p.stderr.on('data', (c) => (out += c));
    p.on('close', () => resolve(out));
    p.on('error', () => resolve(''));
    setTimeout(() => { try { p.kill(); } catch (_) {} }, 30000);
  });
}

// Procura recursivamente qualquer chave que pareça uma lista de modelos.
function acharListaDeModelos(obj, caminho = '$') {
  const achados = [];
  if (!obj || typeof obj !== 'object') return achados;
  for (const [k, v] of Object.entries(obj)) {
    const p = `${caminho}.${k}`;
    if (/model/i.test(k) && Array.isArray(v) && v.length) {
      achados.push({ caminho: p, valor: v });
    } else if (v && typeof v === 'object') {
      achados.push(...acharListaDeModelos(v, p));
    }
  }
  return achados;
}

async function sondarAcp(bin) {
  return new Promise((resolve) => {
    const p = spawn(bin, ['--acp'], {
      shell: needsShell(bin), windowsHide: true, env: getEnrichedEnv(),
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const respostas = [];
    let buf = '';
    p.stdout.on('data', (c) => {
      buf += c;
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const linha = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        if (!linha) continue;
        try { respostas.push(JSON.parse(linha)); } catch (_) {}
      }
    });
    const send = (o) => { try { p.stdin.write(JSON.stringify(o) + '\n'); } catch (_) {} };

    (async () => {
      await sleep(700);
      send({ jsonrpc: '2.0', id: 1, method: 'initialize',
        params: { protocolVersion: 1, clientCapabilities: { fs: { readTextFile: false, writeTextFile: false } } } });
      await sleep(2500);
      send({ jsonrpc: '2.0', id: 2, method: 'session/new',
        params: { cwd: process.cwd(), mcpServers: [] } });
      await sleep(6000);
      // Se a sessão nasceu, pergunta o estado dela (algumas versões só expõem
      // os modelos aqui, não na resposta do session/new).
      const nova = respostas.find((r) => r.id === 2 && r.result);
      if (nova && nova.result.sessionId) {
        send({ jsonrpc: '2.0', id: 3, method: 'session/list', params: {} });
        await sleep(2500);
      }
      try { p.kill(); } catch (_) {}
      resolve(respostas);
    })();
  });
}

(async () => {
  const bin = await resolveBinary();
  if (!bin) {
    console.error('Copilot CLI não encontrado. Instale com: npm install -g @github/copilot');
    process.exit(1);
  }
  console.log('binário:', bin, '\n');

  console.log('=== FONTE 1: `copilot help config` (é o que o app usa hoje) ===');
  const help = await runOnce(bin, ['help', 'config']);
  const catalogo = parseModelIdsFromHelpConfig(help);
  console.log(`${catalogo.length} modelo(s) no catálogo do binário:`);
  catalogo.forEach((m) => console.log('  -', m));

  console.log('\n=== FONTE 2: `copilot --acp` (sessão autenticada) ===');
  const respostas = await sondarAcp(bin);
  const erroAuth = respostas.find((r) => r.error && /auth/i.test(r.error.message || ''));
  if (erroAuth) {
    console.log('BLOQUEADO: o Copilot CLI não está autenticado nesta máquina.');
    console.log(`  (o agente respondeu: "${erroAuth.error.message}")`);
    console.log('\n  Faça login e rode de novo:');
    console.log('      copilot login');
    console.log('  ou defina COPILOT_GITHUB_TOKEN / GH_TOKEN no ambiente.');
    process.exit(2);
  }

  const sessao = respostas.find((r) => r.id === 2);
  if (!sessao) {
    console.log('INCONCLUSIVO: o agente ACP não respondeu ao session/new.');
    console.log(JSON.stringify(respostas, null, 2).slice(0, 2000));
    process.exit(3);
  }
  if (sessao.error) {
    console.log('session/new falhou:', JSON.stringify(sessao.error));
    process.exit(3);
  }

  const listas = acharListaDeModelos(sessao.result);
  if (!listas.length) {
    console.log('RESULTADO: o ACP NÃO expõe lista de modelos nesta versão do CLI.');
    console.log('Resposta crua do session/new (pra conferir na mão):');
    console.log(JSON.stringify(sessao.result, null, 2).slice(0, 4000));
    console.log('\n→ Sem essa lista, filtrar por org exigiria capturar o TUI com pty.');
    process.exit(4);
  }

  console.log('RESULTADO: o ACP EXPÕE lista de modelos. É a fonte filtrada por conta/org.\n');
  for (const { caminho, valor } of listas) {
    console.log(`  ${caminho} → ${valor.length} item(ns)`);
    console.log(JSON.stringify(valor, null, 2).split('\n').map((l) => '    ' + l).join('\n'));
    const ids = valor.map((v) => (typeof v === 'string' ? v : v.modelId || v.id || v.name)).filter(Boolean);
    const bloqueados = catalogo.filter((c) => !ids.includes(c));
    if (bloqueados.length) {
      console.log(`\n  → ${bloqueados.length} modelo(s) que o app mostra HOJE e a sua conta não libera:`);
      bloqueados.forEach((m) => console.log('      -', m));
    }
  }
})();
