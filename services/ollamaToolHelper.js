// Helper utilities for Ollama / Backend tool calling and text cleaning
function pickOllamaEndpoint(texto) {
  const t = (texto || '').trim();
  if (!t) return '/llama3';

  const heavyRegex = /[=+\-*/%^<>]{1,3}|\b(function|class|def|var|let|const|import|return|if|else|while|for|switch)\b|[{};()[\]]|\b(calcule?|resolva|compute|derive|integre|fatore|prove|demonstre|implementa|implementar|c[oó]digo|fun[cç][aã]o|algoritmo|complexidade|otimiza|debug|stack trace|exception|exec[uú]ta|comando|shell|bash|sql|query|regex|json|yaml|xml)\b|\d+\s*[\+\-\*\/x×÷=]\s*\d+|`[^`]+`|```/i;
  const devProjectRegex = /\b(projeto|repositorio|reposit[oó]rio|codebase|backend|frontend|fullstack|endpoint|endpoints|rota|rotas|controller|controllers|rest|api|apis|servi[cç]o|servi[cç]os|arquitetura|refatora|refatorar|pull request|commit|classe|classes|m[eé]todo|m[eé]todos|bug|erro|stacktrace)\b/i;
  if (heavyRegex.test(t)) return '/gemma3';
  if (devProjectRegex.test(t)) return '/gemma3';

  return '/llama3';
}

// REMOVIDO: isProjectAnalysisPrompt / buildDeepAnalysisAddon.
//
// Injetavam um "MODO ANÁLISE DE PROJETO (OBRIGATÓRIO)" exigindo no mínimo 3
// TOOL_CALL e resposta de 300-900 palavras. Serviam pra impedir modelo fraco de
// escrever código sem ler antes — premissa abandonada: não se usa mais modelo
// abaixo de ~10B pra escrever, e modelo capaz decide sozinho quando ler.
//
// O gatilho também estava quebrado: recebia o prompt JÁ montado, que carrega a
// linha "Estrutura de diretórios:" do contexto de workspace, e "estrutura"
// estava na regex — então com uma pasta anexada QUALQUER mensagem entrava em
// modo análise. Um "oi" virava análise obrigatória do repositório inteiro.
//
// O prompt do modo IDE vive só em services/idePrompt.js (fonte única).

function isWriteIntent(texto) {
  const t = String(texto || '').toLowerCase();
  return /\b(cria|criar|gere|gerar|escreve|escrever|edita|editar|atualiza|atualizar|altera|alterar|patch|apaga|deleta|delete|append|adiciona|inclui)\b/.test(t)
    && /\b(readme|arquivo|file|md|markdown|yaml|yml|json|java|js|ts|pom\.xml|application\.ya?ml)\b/.test(t);
}

function isFileReadIntent(texto) {
  const t = String(texto || '').toLowerCase();
  return /\b(o que tem|mostra|mostrar|leia|ler|abre|abrir|conte[uú]do|conteudo|me diga o que tem|qual o conteudo|resuma o arquivo)\b/.test(t)
    && /\b(readme|help\.md|arquivo|file|pom\.xml|application\.ya?ml|controller|service|java|md)\b/.test(t);
}

function isShellCommandIntent(texto) {
  const t = String(texto || '').toLowerCase();
  if (/\b(commit|comit|comitad[ao]s?|push|pull|branch|merge|rebase|stash|tag|alteraço?es|alteracoes|mudancas|mudanças|staged|unstaged|untracked|untrackeds?|modificad[ao]s?)\b/.test(t)) return true;
  if (/\b(roda|rode|rodar|executa|executar|build|compila|compilar|testa|testar|instala|instalar)\b.*\b(test[es]?|build|projeto|maven|mvn|gradle|npm|yarn|pnpm|script)\b/.test(t)) return true;
  if (/\b(qual a vers[aã]o|versao do|version do|esta? instalad[ao])\b/.test(t)) return true;
  return false;
}

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

function buildToolFirstSystemPrompt(toolsSchema, wsPaths = []) {
  const wsLine = wsPaths.length
    ? `WORKSPACE ANEXADO — use EXATAMENTE estes paths absolutos:\n${wsPaths.map(p => `  - ${p}`).join('\n')}`
    : 'O usuario anexou um workspace e quer que voce LEIA ou ESCREVA arquivos nele.';
  const ws0 = wsPaths[0] || '/home/user/proj';
  const lines = [
    'Voce e um agente que executa tarefas atraves de TOOL_CALL.',
    '',
    wsLine,
    'Sua UNICA resposta valida nesta etapa e um bloco TOOL_CALL.',
    '',
    'FORMATO OBRIGATORIO (uma linha, JSON puro, SEM markdown, SEM texto antes ou depois):',
    'TOOL_CALL: {"name":"<nome>","args":{...}}',
    '',
    'FERRAMENTAS:',
  ];
  for (const t of toolsSchema) {
    const fn = t.function || t;
    const name = fn.name;
    const params = fn.parameters && fn.parameters.properties
      ? Object.keys(fn.parameters.properties).join(', ')
      : '';
    lines.push(`- ${name}(${params})`);
  }
  lines.push('');
  lines.push('EXEMPLOS:');
  lines.push(`- Para criar README.md: TOOL_CALL: {"name":"writeFile","args":{"path":"${ws0}/README.md","content":"# Titulo\\n...","reason":"criar readme"}}`);
  lines.push(`- Para ler config: TOOL_CALL: {"name":"readFile","args":{"path":"${ws0}/package.json"}}`);
  lines.push(`- Para listar pasta: TOOL_CALL: {"name":"listDir","args":{"path":"${ws0}"}}`);
  lines.push(`- Para "tem alteracoes nao comitadas?": TOOL_CALL: {"name":"runCommand","args":{"cmd":"git","args":["status","--short"],"cwd":"${ws0}"}}`);
  lines.push(`- Para fazer commit: TOOL_CALL: {"name":"runCommand","args":{"cmd":"git","args":["commit","-am","mensagem"],"cwd":"${ws0}"}}`);
  lines.push(`- Para rodar testes: TOOL_CALL: {"name":"runCommand","args":{"cmd":"npm","args":["test"],"cwd":"${ws0}"}}`);
  lines.push('');
  lines.push('REGRA CRITICA: NAO use listDir/findFiles dentro de .git/. Pra qualquer pergunta sobre');
  lines.push('GIT (status, commits, branches, push, pull), use runCommand com cmd="git".');
  lines.push('');
  lines.push('REGRAS:');
  lines.push('1. Comece a resposta JA com "TOOL_CALL:" — nada antes.');
  lines.push('2. Use o caminho ABSOLUTO do workspace anexado.');
  lines.push('3. Para writeFile, monte o conteudo COMPLETO em "content" (escape \\n para quebras).');
  lines.push('4. NAO use ```markdown ao redor. NAO explique. Apenas emita o TOOL_CALL.');
  lines.push('5. CRITICO: writeFile APAGA O ARQUIVO INTEIRO. Para EDITAR arquivo existente (principalmente arquivos grandes),');
  lines.push('   use patchFile (substitui trecho exato via regex). SÓ use writeFile para CRIAR arquivo NOVO ou pequenos scripts do 0.');
  lines.push('6. Ao terminar as edições de arquivos, VOCÊ DEVE checar a integridade para ter certeza de que nada foi corrompido (ex: runCommand -> npm run build / test, etc).');
  lines.push('');
  lines.push('═══ CRITICO: TAREFAS MULTI-ARQUIVO ═══');
  lines.push('Se o usuario pediu pra criar VARIOS arquivos, emita UM TOOL_CALL writeFile POR ARQUIVO, em iteracoes sucessivas.');
  lines.push('Apos cada TOOL_RESULT, voce vai receber o resultado e DEVE emitir o PROXIMO TOOL_CALL pro proximo arquivo.');
  lines.push('SO encerre (resposta em texto sem TOOL_CALL) quando TODOS os arquivos pedidos estiverem criados.');
  lines.push('');
  lines.push('NUNCA, NUNCA imprima codigo dentro de ``` blocos achando que isso cria arquivo.');
  lines.push('Mostrar codigo em markdown e\' INUTIL — nao cria nada no disco. SO TOOL_CALL writeFile cria arquivo.');
  lines.push('');
  return lines.join('\n');
}

// O modelo NÃO emite "TOOL_CALL" limpo. Nos bytes reais do stream vem picado em
// tokens, com espaço em qualquer junta: "TO OL _CALL: {" name":" list Dir"...}".
// A marca precisa ser reconhecida assim, senão o tool call não é nem encontrado.
const TOOL_CALL_MARK = 'T\\s*O\\s*O\\s*L\\s*[_\\s-]*C\\s*A\\s*L\\s*L';
function toolCallRe(suffix = '\\s*:?\\s*') {
  return new RegExp(TOOL_CALL_MARK + suffix, 'gi');
}
function looksLikeToolCall(text) {
  if (!text) return false;
  return new RegExp(TOOL_CALL_MARK, 'i').test(text);
}

/**
 * A marca apareceu como TENTATIVA de chamada, não como menção em prosa.
 *
 * Importa porque o modelo termina resposta boa com "sinta-se à vontade para
 * emitir TOOL_CALL" — e tratar isso como chamada quebrada gastava uma iteração
 * e descartava a resposta final do usuário.
 *
 * @param {boolean} requireJson  true = só conta se vier "{" depois da marca.
 */
function looksLikeToolCallAttempt(text, { requireJson = true } = {}) {
  if (!text) return false;
  const re = toolCallRe('');
  let m;
  while ((m = re.exec(text)) !== null) {
    const depois = text.slice(m.index + m[0].length, m.index + m[0].length + 160);
    if (requireJson ? /^\s*:?\s*\{/.test(depois) : /^\s*[:{]/.test(depois)) return true;
  }
  return false;
}

/**
 * JSON.parse tolerante. O modelo manda JSON QUEBRADO e era isso que derrubava
 * TODOS os fallbacks do parser de uma vez:
 *   {" name":" list Dir"," args":{" path":" C:\ Users \soder \ Documents"}}
 * `\ ` e `\U` não são escapes válidos em JSON, então o JSON.parse estourava e o
 * tool call era descartado em silêncio — a ferramenta nunca rodava, o JSON cru
 * ia pra tela e o turno encerrava sem resposta.
 * Os reparos só rodam DEPOIS do parse estrito falhar, então JSON válido passa
 * intocado.
 */
function parseLooseJson(str) {
  if (typeof str !== 'string' || !str) return undefined;
  try { return JSON.parse(str); } catch (_) {}

  // Barra invertida solitária (path do Windows) → escapa pra virar JSON válido.
  // A negativa preserva os escapes legítimos (\\ \" \n \t \uXXXX).
  const escaped = str.replace(/\\(?![\\"/bfnrt]|u[0-9a-fA-F]{4})/g, '\\\\');
  try { return JSON.parse(escaped); } catch (_) {}

  // Aspas tipográficas e vírgula sobrando antes de } ou ].
  const tidied = escaped
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/,\s*([}\]])/g, '$1');
  try { return JSON.parse(tidied); } catch (_) {}

  return undefined;
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

function normalizeToolCallObj(obj) {
  if (!obj || typeof obj !== 'object') return null;
  const cleanObj = {};
  for (const [k, v] of Object.entries(obj)) {
    cleanObj[k.trim()] = v;
  }
  if (!cleanObj.name || typeof cleanObj.name !== 'string') return null;

  let name = cleanObj.name.trim().replace(/\s+/g, '');
  const nameMap = {
    'listdir': 'listDir',
    'readfile': 'readFile',
    'readfilechunk': 'readFileChunk',
    'writefile': 'writeFile',
    'patchfile': 'patchFile',
    'deletefile': 'deleteFile',
    'appendtofile': 'appendToFile',
    'searchinfiles': 'searchInFiles',
    'findfiles': 'findFiles',
    'runcommand': 'runCommand',
    'runshelladvanced': 'runShellAdvanced',
    'fileinfo': 'fileInfo',
    'systempoweraction': 'systemPowerAction'
  };
  const lowerName = name.toLowerCase();
  if (nameMap[lowerName]) {
    name = nameMap[lowerName];
  }

  let args = cleanObj.args || cleanObj.arguments || {};
  if (typeof args === 'object' && args !== null) {
    const cleanArgs = {};
    for (const [ak, av] of Object.entries(args)) {
      let key = ak.trim();
      let val = av;
      if (typeof val === 'string') {
        val = val.trim();
        if (key === 'path' || key === 'cwd' || key === 'file' || key === 'dir') {
          val = val.replace(/\s+\/\s+/g, '/').replace(/\/\s+/g, '/').replace(/\s+\//g, '/');
          // Windows: o modelo tokeniza o path com espaço em volta da barra —
          // "C:\ Users \soder \ Documents" — e aí nenhum arquivo é encontrado.
          // Só tira espaço COLADO na barra: "C:\Program Files\x" continua certo.
          val = val.replace(/\s*\\\s*/g, '\\').replace(/^([A-Za-z]):\s+/, '$1:');
        }
      }
      cleanArgs[key] = val;
    }
    args = cleanArgs;
  } else {
    args = {};
  }

  return { name, args };
}

function parseOllamaToolCalls(text) {
  if (!text) return [];
  const calls = [];
  const re = toolCallRe();
  let m;
  while ((m = re.exec(text)) !== null) {
    const start = m.index + m[0].length;
    const jsonStart = text.indexOf('{', start);
    if (jsonStart === -1 || jsonStart - start > 150) continue;
    const objStr = extractFirstJsonObject(text.slice(jsonStart));
    if (!objStr) continue;
    try {
      const parsedObj = parseLooseJson(objStr);
      const norm = normalizeToolCallObj(parsedObj);
      if (norm && norm.name) {
        calls.push({ raw: text.slice(m.index, jsonStart + objStr.length), obj: norm });
        re.lastIndex = jsonStart + objStr.length;
      }
    } catch (_) {}
  }

  if (calls.length === 0) {
    const shellRe = toolCallRe('\\s*:?\\s*([a-z][^\\n`{]+)');
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
        const parsedObj = parseLooseJson(fm[1]);
        const norm = normalizeToolCallObj(parsedObj);
        if (norm && norm.name) {
          calls.push({ raw: fm[0], obj: norm });
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
          const parsedObj = parseLooseJson(objStr);
          const norm = normalizeToolCallObj(parsedObj);
          if (norm && norm.name && (knownNames.has(norm.name) || knownNames.has(norm.name.toLowerCase()))) {
            calls.push({ raw: objStr, obj: norm });
          }
        } catch (_) {}
        i = open + (objStr ? objStr.length : 1);
      }

      // 4. Chamadas estilo função: toolName(path="...", pattern="...") ou toolName({"path": "..."})
      if (calls.length === 0) {
        const fnRe = /\b([a-zA-Z0-9_]+)\s*\(([\s\S]*?)\)/g;
        let fnM;
        while ((fnM = fnRe.exec(text)) !== null) {
          const fnName = fnM[1];
          if (knownNames.has(fnName) || knownNames.has(fnName.toLowerCase())) {
            const rawArgs = fnM[2].trim();
            let argsObj = {};
            if (rawArgs.startsWith('{') && rawArgs.endsWith('}')) {
              try { argsObj = JSON.parse(rawArgs); } catch (_) {}
            } else {
              const argPairRe = /([a-zA-Z0-9_]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^,\s\)]+))/g;
              let pairM;
              while ((pairM = argPairRe.exec(rawArgs)) !== null) {
                const k = pairM[1];
                const v = pairM[2] !== undefined ? pairM[2] : (pairM[3] !== undefined ? pairM[3] : pairM[4]);
                argsObj[k] = v;
              }
            }
            if (Object.keys(argsObj).length > 0) {
              const norm = normalizeToolCallObj({ name: fnName, args: argsObj });
              if (norm) calls.push({ raw: fnM[0], obj: norm });
            }
          }
        }
      }

      // 5. Blocos posicionais de busca (ex.: caminho\npadrão\nextensão)
      if (calls.length === 0) {
        const searchBlockRe = /(?:^|\n)\s*([/~A-Za-z]:?[^\n\r*?"<>|]+)\s*\n\s*([^\n\r]+)\s*\n\s*(\*[\w.*{},-]+)\s*(?:\n|$)/g;
        let sbM;
        while ((sbM = searchBlockRe.exec(text)) !== null) {
          const p = sbM[1].trim();
          const pat = sbM[2].trim();
          const glob = sbM[3].trim();
          if (p.startsWith('/') || /^[A-Za-z]:/.test(p) || p.startsWith('.')) {
            const norm = normalizeToolCallObj({
              name: 'searchInFiles',
              args: { path: p, pattern: pat, filePattern: glob }
            });
            if (norm) {
              calls.push({ raw: sbM[0].trim(), obj: norm });
            }
          }
        }
      }
    }
  }
  return calls;
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

  let out = text.replace(new RegExp('```[\\s\\S]*?' + TOOL_CALL_MARK + '[\\s\\S]*?```', 'gi'), '');
  const re = toolCallRe();
  let m;
  let cursor = 0;
  let cleaned = '';

  while ((m = re.exec(out)) !== null) {
    cleaned += out.slice(cursor, m.index);

    const afterMarker = m.index + m[0].length;
    const jsonStart = out.indexOf('{', afterMarker);

    if (jsonStart === -1 || jsonStart - afterMarker > 150) {
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
  cleaned = cleaned.replace(new RegExp('^' + TOOL_CALL_MARK + '.*$', 'gmi'), '');
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
  pickOllamaEndpoint,
  isWriteIntent,
  isFileReadIntent,
  isShellCommandIntent,
  buildOllamaToolsAddon,
  buildToolFirstSystemPrompt,
  extractFirstJsonObject,
  parseLooseJson,
  looksLikeToolCall,
  looksLikeToolCallAttempt,
  parseOllamaToolCalls,
  stripToolCallBlocks,
  stripDanglingToolCallFragments,
  stripThinkingBlock,
};
