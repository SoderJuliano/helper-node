// Parsing de TOOL_CALL e limpeza de texto do caminho Ollama Local.
//
// Extraído de ollamaLocalService.js (regra 11: 500 linhas por arquivo) SEM
// nenhuma alteração de comportamento — é o mesmo código, movido.
//
// ATENÇÃO / dívida conhecida: services/ollamaToolHelper.js tem funções com os
// MESMOS NOMES, usadas pelo caminho do backend remoto. Comparei as duas cópias:
// buildOllamaToolsAddon, extractFirstJsonObject, stripToolCallBlocks e
// stripThinkingBlock são idênticas, mas parseOllamaToolCalls e
// stripDanglingToolCallFragments DIVERGIRAM ao longo do tempo. Por isso não
// fundi as duas aqui: unificar muda o comportamento do parser e merece um
// commit próprio, com teste comparando as duas versões — não pode ir de carona
// num fix de latência/truncamento.

function buildOllamaToolsAddon(toolsSchema, wsPaths = []) {
  if (!Array.isArray(toolsSchema) || toolsSchema.length === 0) return '';
  const ws0 = wsPaths[0] || '/abs/path';
  const lines = ['', '═══ TOOL CALLING (modo Ollama) ═══', ''];
  lines.push('Voce tem acesso a estas ferramentas. Para chamar uma, emita NA RESPOSTA');
  lines.push('um bloco EXATO no formato (uma linha, JSON puro, sem markdown ao redor):');
  lines.push('');
  lines.push('TOOL_CALL: {"name":"<nome>","args":{...}}');
  lines.push('');
  lines.push('Pode emitir VARIOS TOOL_CALL na mesma resposta. O sistema executa cada um');
  lines.push('e devolve TOOL_RESULT: <name> <json> na proxima mensagem. Iterate ate ter');
  lines.push('todas as informacoes que precisa, dai escreva a RESPOSTA FINAL ao usuario');
  lines.push('SEM nenhum TOOL_CALL (resposta normal em texto/markdown).');
  lines.push('');
  lines.push('FERRAMENTAS DISPONIVEIS:');
  for (const t of toolsSchema) {
    const fn = t.function || t;
    const name = fn.name;
    const desc = (fn.description || '').replace(/\n/g, ' ').slice(0, 200);
    const params = fn.parameters && fn.parameters.properties
      ? Object.entries(fn.parameters.properties)
          .map(([k, v]) => `${k}:${v.type || '?'}`)
          .join(', ')
      : '';
    lines.push(`- ${name}(${params}) — ${desc}`);
  }
  lines.push('');
  lines.push('REGRAS:');
  lines.push('- TOOL_CALL deve ser JSON valido EXATO. Nada de comentarios, sem ``` ao redor.');
  lines.push('- Tools mutates (writeFile, deleteFile, patchFile, appendToFile, systemPowerAction)');
  lines.push('  abrem confirmacao visual pro usuario — chame quando faz sentido, sem medo.');
  lines.push('- Quando terminar (resposta final ao usuario), NAO inclua TOOL_CALL nenhum.');
  lines.push('- Para LER: use listDir + readFile.');
  lines.push('- Para EDITAR (adicionar linha, mudar trecho): use patchFile — NAO writeFile.');
  lines.push('  writeFile APAGA O ARQUIVO INTEIRO e reescreve do zero. So use writeFile para CRIAR arquivo novo.');
  lines.push('  patchFile substitui apenas o trecho exato — use para qualquer edicao em arquivo existente.');
  lines.push('');
  lines.push('EXEMPLOS CONCRETOS (siga EXATAMENTE este formato):');
  lines.push('');
  lines.push('User: "cria um readme pro projeto"');
  lines.push('Resposta correta (UMA linha, sem markdown, sem texto antes):');
  lines.push(`TOOL_CALL: {"name":"writeFile","args":{"path":"${ws0}/README.md","content":"# Titulo\\n\\nDescricao...","reason":"Criar README"}}`);
  lines.push('');
  lines.push('User: "o que tem no arquivo de config?"');
  lines.push('Resposta correta:');
  lines.push(`TOOL_CALL: {"name":"readFile","args":{"path":"${ws0}/package.json"}}`);
  lines.push('');
  lines.push('ERRADO (NAO FACA): explicar o que vai fazer, usar ```markdown ao redor,');
  lines.push('inventar texto tipo "Texto explicativo:" ou "Vou criar...". Apenas EMITA o TOOL_CALL.');
  lines.push('');
  return lines.join('\n');
}

function parseOllamaToolCalls(text) {
  if (!text) return [];
  const calls = [];
  const re = /TOOL[_\s-]*CALL\s*:?\s*/gi;
  let m;
  while ((m = re.exec(text)) !== null) {
    const start = m.index + m[0].length;
    const jsonStart = text.indexOf('{', start);
    if (jsonStart === -1 || jsonStart - start > 120) continue;
    const objStr = extractFirstJsonObject(text.slice(jsonStart));
    if (!objStr) continue;
    try {
      const obj = JSON.parse(objStr);
      if (obj && obj.name) {
        calls.push({ raw: text.slice(m.index, jsonStart + objStr.length), obj });
        re.lastIndex = jsonStart + objStr.length;
      }
    } catch (_) {}
  }
  if (calls.length === 0) {
    const shellRe = /TOOL[_\s-]*CALL\s*:?\s*([a-z][^\n`{]+)/gi;
    let sm;
    while ((sm = shellRe.exec(text)) !== null) {
      const raw = sm[1].trim().replace(/^`+|`+$/g, '').trim();
      if (!raw || raw.startsWith('{')) continue;
      const parts = raw.split(/\s+/);
      const cmd = parts[0];
      const knownCmds = ['git','npm','ls','cat','find','grep','echo','node','python','pip','curl','wget','mkdir','cp','mv','rm'];
      if (!knownCmds.includes(cmd)) continue;
      const obj = { name: 'runCommand', args: { cmd, args: parts.slice(1) } };
      calls.push({ raw: sm[0], obj });
    }
  }
  if (calls.length === 0) {
    const fenceRe = /```(?:json)?\s*(\{[\s\S]*?\})\s*```/gi;
    let fm;
    while ((fm = fenceRe.exec(text)) !== null) {
      try {
        const obj = JSON.parse(fm[1]);
        if (obj && obj.name && typeof obj.name === 'string') {
          calls.push({ raw: fm[0], obj });
        }
      } catch (_) {}
    }
    if (calls.length === 0) {
      const knownNames = new Set(
        ['listDir','fileInfo','readFile','readFileChunk','searchInFiles','findFiles',
         'detectShellConfig','listPackages','listDesktopApps','systemPowerAction',
         'writeFile','appendToFile','deleteFile','patchFile','runCommand','runShellAdvanced']
      );
      let i = 0;
      while (i < text.length) {
        const open = text.indexOf('{', i);
        if (open === -1) break;
        const objStr = extractFirstJsonObject(text.slice(open));
        if (!objStr) break;
        try {
          const obj = JSON.parse(objStr);
          if (obj && obj.name && knownNames.has(obj.name)) {
            calls.push({ raw: objStr, obj });
          }
        } catch (_) {}
        i = open + (objStr ? objStr.length : 1);
      }
    }
  }
  return calls;
}

function extractFirstJsonObject(s) {
  let depth = 0, start = -1;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '{') {
      if (depth === 0) start = i;
      depth++;
    } else if (c === '}') {
      depth--;
      if (depth === 0 && start >= 0) return s.slice(start, i + 1);
    }
  }
  return null;
}

function stripToolCallBlocks(text) {
  if (!text) return text;
  const calls = parseOllamaToolCalls(text);
  let out = text;
  for (const c of calls) {
    out = out.split(c.raw).join('');
  }
  out = stripDanglingToolCallFragments(out);
  out = out.replace(/```\s*\n\s*```/g, '').trim();
  return out;
}

function stripDanglingToolCallFragments(text) {
  if (!text) return text;
  let out = text.replace(/```[\s\S]*?TOOL_CALL[\s\S]*?```/gi, '');
  const re = /TOOL_CALL\s*:?\s*/gi;
  let m;
  let cursor = 0;
  let cleaned = '';
  while ((m = re.exec(out)) !== null) {
    cleaned += out.slice(cursor, m.index);
    const afterMarker = m.index + m[0].length;
    const jsonStart = out.indexOf('{', afterMarker);
    if (jsonStart === -1 || jsonStart - afterMarker > 12) {
      const nextNl = out.indexOf('\n', afterMarker);
      cursor = nextNl === -1 ? out.length : nextNl + 1;
      re.lastIndex = cursor;
      continue;
    }
    const objStr = extractFirstJsonObject(out.slice(jsonStart));
    if (objStr) {
      cursor = jsonStart + objStr.length;
      re.lastIndex = cursor;
      continue;
    }
    const nextNl = out.indexOf('\n', jsonStart);
    cursor = nextNl === -1 ? out.length : nextNl + 1;
    re.lastIndex = cursor;
  }
  cleaned += out.slice(cursor);
  return cleaned.replace(/\n{3,}/g, '\n\n').trim();
}

function stripThinkingBlock(text) {
  if (!text || typeof text !== 'string') return text;
  let cleaned = text
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/<think>[\s\S]*$/gi, '')
    .replace(/(?:[^\n]*thinking\s+process:[\s\S]*?)(?=(?:\n\s*\n[A-Z0-9#\*])|$)/gi, '')
    .replace(/(?:[^\n]*thinking\s+process:[\s\S]*$)/gi, '')
    .trim();
  return cleaned;
}

module.exports = {
  buildOllamaToolsAddon,
  parseOllamaToolCalls,
  extractFirstJsonObject,
  stripToolCallBlocks,
  stripDanglingToolCallFragments,
  stripThinkingBlock,
};
