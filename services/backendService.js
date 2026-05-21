const axios = require("axios");
const configService = require("./configService");
const { getIp } = require("./configService");
const https = require('https');
const http = require('http');

// Configurar agentes HTTP/HTTPS com keepAlive para evitar socket hang up
const httpAgent = new http.Agent({
  keepAlive: true,
  keepAliveMsecs: 60000,
  maxSockets: 50,
  maxFreeSockets: 10,
  timeout: 180000
});

const httpsAgent = new https.Agent({
  keepAlive: true,
  keepAliveMsecs: 60000,
  maxSockets: 50,
  maxFreeSockets: 10,
  timeout: 180000
});

// Variável para armazenar a URL da API
let apiUrl = "";

// === Roteamento de modelo Ollama (so backendService — nao toca OpenAI) ===
// Decide qual endpoint do proxy Java usar com base no conteudo da mensagem.
// Codigo/matematica/raciocinio tecnico -> qwen25 (14b, melhor reasoning).
// Resto -> llama3 (8b, default geral e conversa).
// NOTA: llamatiny (1b) foi removido do roteamento — muito burro pra
// conversar, parafraseia o pr\u00f3prio prompt. Mantemos o endpoint disponivel
// pro backend Java mas n\u00e3o roteamos nada pra ele aqui.
function pickOllamaEndpoint(texto) {
  const t = (texto || '').trim();
  if (!t) return '/llama3';

  // Sinais de codigo/matematica/raciocinio tecnico → qwen25
  // (operadores, sintaxe de linguagem, palavras-chave de tarefa pesada)
  const heavyRegex = /[=+\-*/%^<>]{1,3}|\b(function|class|def|var|let|const|import|return|if|else|while|for|switch)\b|[{};()[\]]|\b(calcule?|resolva|compute|derive|integre|fatore|prove|demonstre|implementa|implementar|c[oó]digo|fun[cç][aã]o|algoritmo|complexidade|otimiza|debug|stack trace|exception|exec[uú]ta|comando|shell|bash|sql|query|regex|json|yaml|xml)\b|\d+\s*[\+\-\*\/x×÷=]\s*\d+|`[^`]+`|```/i;
  // Palavras de projeto/dev/backend (endpoints, controllers, arquitetura, etc.)
  // devem ir direto pro qwen25, mesmo sem sintaxe de codigo explicita.
  const devProjectRegex = /\b(projeto|repositorio|reposit[oó]rio|codebase|backend|frontend|fullstack|endpoint|endpoints|rota|rotas|controller|controllers|rest|api|apis|servi[cç]o|servi[cç]os|arquitetura|refatora|refatorar|pull request|commit|classe|classes|m[eé]todo|m[eé]todos|bug|erro|stacktrace)\b/i;
  if (heavyRegex.test(t)) return '/qwen25';
  if (devProjectRegex.test(t)) return '/qwen25';

  return '/llama3';
}

function isProjectAnalysisPrompt(texto) {
  const t = String(texto || '').toLowerCase();
  return /\b(que projeto|tipo de projeto|o que faz|arquitetura|estrutura|endpoint|endpoints|controller|rest|api|servi[cç]o|usecase|hexagonal|spring|maven|gradle|depend[eê]ncia|pom\.xml|application\.ya?ml)\b/.test(t);
}

function buildDeepAnalysisAddon({ toolsEnabled, wsEnabled, attCount, texto }) {
  if (!toolsEnabled) return '';
  if (!wsEnabled || attCount <= 0) return '';
  if (!isProjectAnalysisPrompt(texto)) return '';

  return [
    '',
    '═══ MODO ANÁLISE DE PROJETO (OBRIGATÓRIO) ═══',
    '- Neste cenário, IGNORE qualquer limite anterior de "máximo 65 palavras".',
    '- Responda de forma completa e objetiva (300-900 palavras quando necessário).',
    '- Antes da RESPOSTA FINAL, faça no mínimo 3 TOOL_CALL de leitura para evidência real do código:',
    '  1) listDir do diretório raiz anexado',
    '  2) readFile de manifesto/config principal (pom.xml, package.json, build.gradle, application.yaml/properties)',
    '  3) readFile de 1-2 arquivos de entrada/fluxo (controller/use case/service/application)',
    '- Só finalize após citar evidências dos arquivos lidos (nomes de arquivo + conclusão).',
    '- Estruture a resposta em tópicos: Tipo do projeto, O que ele faz, Arquitetura, Fluxo principal, Tecnologias e Pontos de atenção.',
    '',
  ].join('\n');
}

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

// Pergunta que pede execucao de comando shell — tipicamente git/build/test.
// Ex: "tem alteracoes nao comitadas?", "roda os testes", "qual a branch atual?",
// "faz commit e push", "build do projeto".
function isShellCommandIntent(texto) {
  const t = String(texto || '').toLowerCase();
  // Git status / log / branches / commits
  if (/\b(commit|comit|comitad[ao]s?|push|pull|branch|merge|rebase|stash|tag|alteraço?es|alteracoes|mudancas|mudanças|staged|unstaged|untracked|untrackeds?|modificad[ao]s?)\b/.test(t)) return true;
  // Build / test / install / run scripts
  if (/\b(roda|rode|rodar|executa|executar|build|compila|compilar|testa|testar|instala|instalar)\b.*\b(test[es]?|build|projeto|maven|mvn|gradle|npm|yarn|pnpm|script)\b/.test(t)) return true;
  // "qual a versao do X", "esta instalado?"
  if (/\b(qual a vers[aã]o|versao do|version do|esta? instalad[ao])\b/.test(t)) return true;
  return false;
}

// ── Tool calling para Ollama (sem function-calling nativo) ────────────────────
// Ollama nao tem `tools[]` igual OpenAI. Solucao: instruimos o modelo a emitir
// blocos `TOOL_CALL: {"name":"...","args":{...}}` no texto da resposta.
// Parseamos, executamos via helperTools/executor (mesmo pipeline do OpenAI:
// confirmer, audit log, secret redactor) e re-perguntamos com TOOL_RESULT.
// Loop ate a IA nao emitir mais tool calls ou bater maxIters.

function buildOllamaToolsAddon(toolsSchema) {
  if (!Array.isArray(toolsSchema) || toolsSchema.length === 0) return '';
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
  lines.push('- Para LER arquivos do projeto, use listDir + readFile. Para EDITAR, writeFile.');
  lines.push('');
  lines.push('EXEMPLOS CONCRETOS (siga EXATAMENTE este formato):');
  lines.push('');
  lines.push('User: "cria um readme pro projeto"');
  lines.push('Resposta correta (UMA linha, sem markdown, sem texto antes):');
  lines.push('TOOL_CALL: {"name":"writeFile","args":{"path":"/abs/path/README.md","content":"# Titulo\\n\\nDescricao...","reason":"Criar README"}}');
  lines.push('');
  lines.push('User: "o que tem no pom.xml?"');
  lines.push('Resposta correta:');
  lines.push('TOOL_CALL: {"name":"readFile","args":{"path":"/abs/path/pom.xml"}}');
  lines.push('');
  lines.push('ERRADO (NAO FACA): explicar o que vai fazer, usar ```markdown ao redor,');
  lines.push('inventar texto tipo "Texto explicativo:" ou "Vou criar...". Apenas EMITA o TOOL_CALL.');
  lines.push('');
  return lines.join('\n');
}

// System prompt minimalista para modo tool-first.
// Quando o usuario pede explicitamente pra ler/escrever arquivo, o prompt completo
// (com regras de "max 65 palavras", "sem floreio", "use negrito") domina o modelo
// e ele ignora as tools. Aqui derrubamos tudo isso e deixamos so o essencial.
function buildToolFirstSystemPrompt(toolsSchema) {
  const lines = [
    'Voce e um agente que executa tarefas atraves de TOOL_CALL.',
    '',
    'O usuario anexou um workspace e quer que voce LEIA ou ESCREVA arquivos nele.',
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
  lines.push('- Para criar README.md: TOOL_CALL: {"name":"writeFile","args":{"path":"/home/user/proj/README.md","content":"# Titulo\\n...","reason":"criar readme"}}');
  lines.push('- Para ler pom.xml: TOOL_CALL: {"name":"readFile","args":{"path":"/home/user/proj/pom.xml"}}');
  lines.push('- Para listar pasta: TOOL_CALL: {"name":"listDir","args":{"path":"/home/user/proj"}}');
  lines.push('- Para "tem alteracoes nao comitadas?": TOOL_CALL: {"name":"runCommand","args":{"cmd":"git","args":["status","--short"],"cwd":"/home/user/proj"}}');
  lines.push('- Para fazer commit: TOOL_CALL: {"name":"runCommand","args":{"cmd":"git","args":["commit","-am","mensagem"],"cwd":"/home/user/proj"}}');
  lines.push('- Para rodar testes: TOOL_CALL: {"name":"runCommand","args":{"cmd":"npm","args":["test"],"cwd":"/home/user/proj"}}');
  lines.push('');
  lines.push('REGRA CRITICA: NAO use listDir/findFiles dentro de .git/. Pra qualquer pergunta sobre');
  lines.push('GIT (status, commits, branches, push, pull), use runCommand com cmd="git".');
  lines.push('');
  lines.push('REGRAS:');
  lines.push('1. Comece a resposta JA com "TOOL_CALL:" — nada antes.');
  lines.push('2. Use o caminho ABSOLUTO do workspace anexado.');
  lines.push('3. Para writeFile, monte o conteudo COMPLETO em "content" (escape \\n para quebras).');
  lines.push('4. NAO use ```markdown ao redor. NAO explique. Apenas emita o TOOL_CALL.');
  lines.push('');
  lines.push('═══ CRITICO: TAREFAS MULTI-ARQUIVO ═══');
  lines.push('Se o usuario pediu pra criar VARIOS arquivos (ex: controller + service + adapter + port),');
  lines.push('emita UM TOOL_CALL writeFile POR ARQUIVO, em iteracoes sucessivas. Apos cada TOOL_RESULT,');
  lines.push('voce vai receber o resultado e DEVE emitir o PROXIMO TOOL_CALL writeFile pro proximo arquivo.');
  lines.push('SO encerre (resposta em texto sem TOOL_CALL) quando TODOS os arquivos pedidos estiverem criados.');
  lines.push('');
  lines.push('NUNCA, NUNCA imprima codigo dentro de ```java ``` ou ```xml ``` achando que isso cria arquivo.');
  lines.push('Mostrar codigo em markdown e\' INUTIL — nao cria nada no disco. SO TOOL_CALL writeFile cria arquivo.');
  lines.push('');
  return lines.join('\n');
}

// Procura blocos TOOL_CALL: {...} na resposta. Estrategia: acha a posicao de
// "TOOL_CALL:" (case-insensitive, ignora ``` ao redor) e extrai o PRIMEIRO
// objeto JSON balanceado a partir dali. Funciona mesmo quando o modelo embrulha
// o call em markdown code fence ou nao deixa linha em branco depois.
function parseOllamaToolCalls(text) {
  if (!text) return [];
  const calls = [];
  const re = /TOOL[_\s-]*CALL\s*:?\s*/gi;
  let m;
  while ((m = re.exec(text)) !== null) {
    // Procura o primeiro '{' apos o match — afrouxado para tolerar code fences
    // (```json\n{...}```), quebras de linha e ate ~120 chars de lixo no meio.
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

  // Fallback: modelo emitiu JSON com {"name":"writeFile",...} sem o marcador
  // TOOL_CALL: na frente. Acontece bastante com qwen25/llama3.
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
    // Ultimo recurso: scaneia JSONs balanceados no texto inteiro procurando
    // {"name":"<tool>","args":...}. So aceita se "name" bater com uma tool real.
    if (calls.length === 0) {
      const knownNames = new Set(
        // lazy: extraido do schema na hora do parse via heuristica simples
        ['listDir','fileInfo','readFile','readFileChunk','searchInFiles','findFiles',
         'detectShellConfig','listPackages','listDesktopApps','systemPowerAction',
         'writeFile','appendToFile','deleteFile','patchFile']
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

// Extrai o primeiro objeto JSON balanceado de uma string (defesa contra
// objetos que JSON.parse direto explode por causa de extras no final).
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

// Remove TOOL_CALL ... {JSON balanceado} do texto, deixando so a parte
// "humana" da resposta. Usa o mesmo extrator do parser.
function stripToolCallBlocks(text) {
  if (!text) return text;
  const calls = parseOllamaToolCalls(text);
  let out = text;
  for (const c of calls) {
    out = out.split(c.raw).join('');
  }
  // Fallback defensivo: quando o modelo imprime TOOL_CALL com JSON quebrado
  // (ex.: faltando chave), o parser nao consegue capturar. Ainda assim, nao
  // devemos exibir esse payload tecnico para o usuario final.
  out = stripDanglingToolCallFragments(out);
  // Limpa code fences vazios deixados pra tras
  out = out.replace(/```\s*\n\s*```/g, '').trim();
  return out;
}

// Remove residuos de TOOL_CALL que nao puderam ser parseados (JSON incompleto,
// truncado ou com lixo no final). Estrategia:
// - remove fences que contenham TOOL_CALL
// - remove trecho TOOL_CALL: { ... } quando achar JSON balanceado
// - se nao achar fechamento, remove ate fim da linha (ou fim do texto)
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

    // Sem JSON logo apos TOOL_CALL -> descarta apenas a linha do marcador.
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

    // JSON truncado: remove ate o fim da linha (ou fim do texto).
    const nextNl = out.indexOf('\n', jsonStart);
    cursor = nextNl === -1 ? out.length : nextNl + 1;
    re.lastIndex = cursor;
  }

  cleaned += out.slice(cursor);

  // Normaliza espaços extras após remoções.
  return cleaned
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}


class BackendService {
  constructor() {
    this.sessions = {};
  }

  // Helper method to manage session context
  manageSessionContext(sessionId, userMessage) {
    const now = Date.now();
    const twoHours = 2 * 60 * 60 * 1000;

    // Clear session if inactive for more than 2 hours
    if (this.sessions[sessionId] && (now - this.sessions[sessionId].lastActivity > twoHours)) {
      delete this.sessions[sessionId];
      console.log('Backend session expired and was cleared.');
    }

    // Create a new session if it doesn't exist
    if (!this.sessions[sessionId]) {
      console.log('Creating new Backend session.');
      const promptInstruction = configService.getPromptInstruction();
      this.sessions[sessionId] = {
        messages: [
          { role: 'system', content: promptInstruction || 'You are a helpful assistant.' }
        ],
        lastActivity: now
      };
    }

    // Add user's prompt to the session history
    this.sessions[sessionId].messages.push({ role: 'user', content: userMessage });
    this.sessions[sessionId].lastActivity = now;

    // Keep only last 3 questions and answers (6 messages + system message = 7 total)
    if (this.sessions[sessionId].messages.length > 7) {
      const systemMessage = this.sessions[sessionId].messages[0];
      const recentMessages = this.sessions[sessionId].messages.slice(-6);
      this.sessions[sessionId].messages = [systemMessage, ...recentMessages];
      console.log('Backend session trimmed to last 3 Q&A pairs');
    }

    // Build conversation context for backend
    let conversationContext = '';
    for (let i = 1; i < this.sessions[sessionId].messages.length; i++) {
      const msg = this.sessions[sessionId].messages[i];
      if (msg.role === 'user') {
        conversationContext += `Human: ${msg.content}\n`;
      } else if (msg.role === 'assistant') {
        conversationContext += `Assistant: ${msg.content}\n`;
      }
    }

    return conversationContext;
  }

  addAssistantResponse(sessionId, response) {
    if (this.sessions[sessionId]) {
      this.sessions[sessionId].messages.push({ role: 'assistant', content: response });
    }
  }

  removeLastUserMessage(sessionId) {
    if (this.sessions[sessionId] && this.sessions[sessionId].messages.length > 0) {
      const lastMessage = this.sessions[sessionId].messages[this.sessions[sessionId].messages.length - 1];
      if (lastMessage.role === 'user') {
        this.sessions[sessionId].messages.pop();
      }
    }
  }

  async getLastEnvUrl() {
    try {
      const response = await axios.get(
        "https://abra-api.top/notifications/retrieve?key=ngrockurl"
      );
      const data = response.data;

      if (Array.isArray(data) && data.length > 0) {
        const lastNotification = data[data.length - 1];
        if (lastNotification && lastNotification.content) {
          apiUrl = lastNotification.content;
          console.log(`Updated API URL to: ${apiUrl}`);
        } else {
          console.error("No valid content found in the last notification.");
        }
      } else {
        console.error(
          "No data received or empty array from notification service."
        );
      }
    } catch (error) {
      console.error("Error fetching API URL:", error);
      // Fallback or error handling
      apiUrl = ""; // Reset or use a default
    }
  }

  async getApiUrl() {
    if (!apiUrl) {
      await this.getLastEnvUrl();
    }
    return apiUrl;
  }

  async ping() {
    const url = await this.getApiUrl();
    if (!url) {
      return false;
    }

    try {
      const headers = {
        Authorization: "Bearer Y3VzdG9tY3ZvbmxpbmU=",
        "Content-Type": "application/json",
        "ngrok-skip-browser-warning": "true",
      };
      const response = await axios.get(`${url}/ping`, {
        headers,
        timeout: 5000,
        httpAgent,
        httpsAgent
      });
      return response.status === 200;
    } catch (error) {
      console.error("Ping failed:", error.message);
      return false;
    }
  }

  async responder(texto, opts = {}) {
    if (!texto) throw new Error("Não entendi");

    // opts = { tools?: [...], onToolCall?: fn, maxToolCalls?: number }
    // Quando tools presente, ativa loop de tool-calling structured-prompt.
    const tools = Array.isArray(opts.tools) && opts.tools.length ? opts.tools : null;
    const onToolCall = typeof opts.onToolCall === 'function' ? opts.onToolCall : null;
    const maxToolCalls = Number.isInteger(opts.maxToolCalls) ? opts.maxToolCalls : 10;

    // Se a URL não foi pega ainda, tenta novamente
    if (!apiUrl) {
      console.log("API URL not found, fetching again...");
      await this.getLastEnvUrl();
    }

    // Se ainda não tiver a URL, lança um erro
    if (!apiUrl) {
      throw new Error("Could not retrieve backend URL.");
    }

    const sessionId = 'default'; // Using a single session for now
    
    // Manage session context (adds user message and builds context)
    const conversationContext = this.manageSessionContext(sessionId, texto);

    const ip = await configService.getIp();
    // PEGAR LINGUAGEM SALVA
    const lang = configService.getLanguage();

    // MAPEAR PARA O BACKEND
    const langMap = {
      'pt-br': 'PORTUGUESE',
      'us-en': 'ENGLISH'
    };
    const mappedLang = langMap[lang] || 'PORTUGUESE';

    try {
      // === Roteamento de modelo Ollama ===
      // O backend Java expoe varios endpoints com modelos diferentes:
      //   /llamatiny  → llama3.2:1b ou similar (super rapido, conversa casual)
      //   /llama3     → llama3 8b (geral, default)
      //   /qwen25     → qwen2.5:14b (raciocinio tecnico, codigo, matematica)
      //   /gemma3     → gemma3 (alternativa)
      // Heuristica: casual curto -> llamatiny, tecnico/code/math -> qwen25, resto -> llama3.
      let modelEndpoint = pickOllamaEndpoint(texto);
      let workspace = null;
      let wsEnabled = false;
      let attCount = 0;
      // Quando houver anexos no workspace, usa qwen25 por padrão.
      // Isso melhora muito perguntas sobre projeto/codigo/endpoints.
      try {
        workspace = require('./workspace');
        wsEnabled = !!(configService.getWorkspaceAccessEnabled && configService.getWorkspaceAccessEnabled());
        attCount = wsEnabled ? workspace.list().length : 0;
        if (wsEnabled && attCount > 0) {
          modelEndpoint = '/qwen25';
          console.log(`[backend] workspace com anexos (${attCount}) -> forçando ${modelEndpoint}`);
        }
      } catch (e) {
        console.warn('[backend] falha ao verificar anexos de workspace para roteamento:', e.message);
      }
      const endpoint = `${apiUrl}${modelEndpoint}`;
      console.log(`[backend] roteado para ${modelEndpoint} (${texto.slice(0, 40).replace(/\n/g, ' ')}...)`);
      let promptInstruction = configService.getPromptInstruction();

      // Tool calling Ollama: anexa instrucoes de formato + lista de tools no system prompt.
      // NAO mexe no roteamento — usa o endpoint que o pickOllamaEndpoint escolheu.
      let effectiveEndpoint = modelEndpoint;
      // Quando o usuario PEDE explicitamente pra ler/escrever arquivo, o
      // system prompt completo (com regras "max 65 palavras", "sem floreio",
      // "use negrito") domina o modelo e ele ignora as tools. Detectamos esse
      // intent e trocamos por um prompt tool-first minimalista.
      const toolFirstMode = !!(tools && onToolCall && wsEnabled && attCount > 0
        && (isWriteIntent(texto) || isFileReadIntent(texto) || isShellCommandIntent(texto)));
      if (tools && onToolCall) {
        if (toolFirstMode) {
          promptInstruction = buildToolFirstSystemPrompt(tools);
          console.log('[backend][tools] modo TOOL-FIRST ativo (intent=write/read, ignorando regras de formatacao)');
        } else {
          const analysisAddon = buildDeepAnalysisAddon({
            toolsEnabled: true,
            wsEnabled,
            attCount,
            texto,
          });
          promptInstruction = `${promptInstruction}\n\n${buildOllamaToolsAddon(tools)}${analysisAddon}`;
        }
      }
      
      // Build prompt with conversation context.
      // llamatiny (1b) NAO consegue ignorar marcadores tipo "Conversation context:"
      // — vira papagaio do template. Pra ele mandamos so a mensagem do user com
      // histórico simplificado. Pros maiores mantemos o template antigo que o
      // backend Java reconhece e processa.
      let promptWithContext;
      if (modelEndpoint === '/llamatiny') {
        // Histórico simplificado: ultimas 2-3 trocas, sem labels Human:/Assistant:.
        const lastMsgs = conversationContext
          ? conversationContext.split(/\n/).filter(Boolean).slice(-4).join('\n')
          : texto;
        promptWithContext = `${promptInstruction}\n\n${lastMsgs}`;
      } else {
        // Backend Java faz parsing em "Conversation context:" e "Please respond..."
        // — nao mudar sem alinhar com o servidor.
        promptWithContext = conversationContext 
          ? `${promptInstruction}\n\nConversation context:\n${conversationContext}\nPlease respond to the latest human message.`
          : `${promptInstruction}${texto}`;
      }

      // Backend Java espera ChatRequest(String prompt, String language).
      // Campos extras (ip, email, agent, newPrompt) sao ignorados pelo Jackson,
      // mas mandar so o necessario fica mais limpo.

      // Workspace context (se ON): prepend listagem/arquivos anexados.
      // Só injeta na primeira pergunta da sessão (flag interna do store).
      try {
        if (wsEnabled && workspace) {
          const modelKey = modelEndpoint.replace(/^\//, '');
          const ctx = await workspace.buildContextIfNeeded(modelKey, { userText: texto });
          if (ctx) {
            workspace.markContextSent();
            promptWithContext = ctx + "\n\n---\n\n" + promptWithContext;
            console.log(`[workspace] ✅ contexto injetado no prompt Ollama (${ctx.length} chars, ${attCount} anexos, model=${modelKey})`);
          } else {
            console.log(`[workspace] contexto ja injetado nesta sessao; IA usa as tools para explorar`);
          }
        } else {
          console.log('[workspace] toggle "Acesso a diretorios" esta OFF — nenhum contexto sera injetado');
        }
      } catch (e) {
        console.warn('[workspace] falhou injetar contexto no Ollama:', e.message);
      }

      const body = {
        prompt: promptWithContext,
        language: mappedLang,
      };
      const headers = {
        Authorization: "Bearer Y3VzdG9tY3ZvbmxpbmU=",
        "Content-Type": "application/json",
        "ngrok-skip-browser-warning": "true",
      };

      console.log('Backend prompt with context:', promptWithContext);

      // Tenta no endpoint roteado (effectiveEndpoint pode ter sido forcado pra qwen25 quando tools ON);
      // se 404 (modelo nao existe no proxy), cai automaticamente pra /llama3 que sempre existe.
      let response;
      try {
        response = await axios.post(`${apiUrl}${effectiveEndpoint}`, body, { 
          headers,
          timeout: 180000,
          httpAgent,
          httpsAgent
        });
      } catch (errFirst) {
        const is404 = errFirst.response && errFirst.response.status === 404;
        if (is404 && effectiveEndpoint !== '/llama3') {
          console.warn(`[backend] ${effectiveEndpoint} indisponivel (404), caindo pra /llama3`);
          response = await axios.post(`${apiUrl}/llama3`, body, {
            headers,
            timeout: 180000,
            httpAgent,
            httpsAgent
          });
          effectiveEndpoint = '/llama3';
        } else {
          throw errFirst;
        }
      }

      console.log(
        "Backend response data:",
        JSON.stringify(response.data, null, 2)
      );

      if (!response.data) {
        throw new Error("Empty response from backend");
      }

      // Assumindo que a resposta do seu backend tem o mesmo formato do Ollama ou retorna o texto diretamente
      let resposta = response.data.response || response.data;
      if (typeof resposta !== 'string') resposta = String(resposta);

      // ─── LOOP DE TOOL CALLING (so se opts.tools foi passado) ───────────
      if (tools && onToolCall) {
        let workingPrompt = promptWithContext;
        let iter = 0;
        const mustUseTools = wsEnabled && attCount > 0 && (isWriteIntent(texto) || isFileReadIntent(texto) || isShellCommandIntent(texto));
        // Paths absolutos dos anexos pro retry forçado embutir no exemplo
        let wsPaths = [];
        try {
          if (workspace) wsPaths = workspace.list().map(a => a.path).filter(Boolean);
        } catch (_) {}
        let forcedRetryCount = 0;
        // Anti-dup runCommand: cmd+args+cwd ja executado neste turno.
        // Bug observado: depois de add/commit/push, modelo nao fecha resposta,
        // forcedRetry empurra de novo e ele repete "git add".
        const _ranCmds = new Set();
        // Resumo dos comandos rodados pra montar fallback quando o modelo nao
        // gera resposta final.
        const _ranSummary = [];
        // Conta tools executadas com sucesso — se ja houve >=1, NAO forcar retry
        // quando a resposta vier sem TOOL_CALL (provavelmente terminou).
        let toolsExecutedOk = 0;
        // Detecta blocos de codigo na resposta — sinal de que o modelo
        // imprimiu codigo em markdown achando que estava criando arquivo.
        // Quando isso acontece numa intent de WRITE, e' tarefa incompleta.
        const hasCodeBlocks = (txt) => /```[a-zA-Z0-9_+-]*\s*\n[\s\S]+?```/.test(String(txt || ''));
        while (iter < maxToolCalls) {
          const calls = parseOllamaToolCalls(resposta);
          if (!calls.length) {
            // Decisao do retry forcado:
            // - intent write/read/shell + nenhuma tool rodou ainda → forca
            // - intent WRITE + ja rodou alguma tool MAS resposta tem ```code```
            //   (modelo so "explicou" o resto em markdown em vez de criar) → forca
            const writeIntentWithCodeLeak = isWriteIntent(texto) && toolsExecutedOk > 0 && hasCodeBlocks(resposta);
            const shouldRetry = mustUseTools && forcedRetryCount < 3 && (toolsExecutedOk === 0 || writeIntentWithCodeLeak);
            if (shouldRetry) {
              forcedRetryCount++;
              const reason = writeIntentWithCodeLeak
                ? `tarefa incompleta (modelo imprimiu codigo em markdown em vez de chamar writeFile)`
                : `sem TOOL_CALL em intento de leitura/escrita`;
              console.warn(`[backend][tools] ${reason}; forçando retry estrito ${forcedRetryCount}/3`);
              // Prompt MINIMO, sem o template original (que confunde o modelo).
              // Mostra ferramentas, paths reais do workspace e exige TOOL_CALL puro.
              const wsLine = wsPaths.length
                ? `Workspace anexado (use estes paths absolutos): ${wsPaths.join(', ')}`
                : 'Workspace anexado: (sem paths detectados — peca confirmacao se necessario)';
              const toolList = (tools || []).map(t => {
                const fn = t.function || t;
                return `${fn.name}(${fn.parameters && fn.parameters.properties ? Object.keys(fn.parameters.properties).join(',') : ''})`;
              }).join('\n- ');
              const _ws0 = wsPaths[0] || '/abs/path';
              const _isGitQ = isShellCommandIntent(texto);
              // Lista arquivos JA criados pra dar contexto ao modelo no retry.
              const _filesCreated = _ranSummary
                .filter(s => s.startsWith('✓ writeFile'))
                .map(s => s.replace(/^✓ writeFile\s*→\s*/, ''))
                .filter(Boolean);
              const _alreadyCreatedLine = _filesCreated.length
                ? `\nARQUIVOS JA CRIADOS NESTE TURNO (NAO RECRIE): ${_filesCreated.join(', ')}\n`
                : '';
              workingPrompt = [
                'Voce e um agente que SO responde com TOOL_CALL. Nada mais.',
                '',
                wsLine,
                _alreadyCreatedLine,
                `Pedido do usuario: ${texto}`,
                '',
                'FERRAMENTAS:',
                `- ${toolList}`,
                '',
                'FORMATO OBRIGATORIO da sua resposta (uma linha, sem markdown, sem texto antes):',
                'TOOL_CALL: {"name":"<tool>","args":{...}}',
                '',
                _isGitQ
                  ? `EXEMPLO (esta pergunta e sobre git/build/testes — USE runCommand):\nTOOL_CALL: {"name":"runCommand","args":{"cmd":"git","args":["status","--short"],"cwd":"${_ws0}"}}\n\nNAO use listDir/findFiles em .git/ — e' inutil e lento. Use runCommand sempre.`
                  : `EXEMPLO para criar arquivo:\nTOOL_CALL: {"name":"writeFile","args":{"path":"${_ws0}/src/main/java/.../Service.java","content":"package ...;\\n\\npublic class Service {...}","reason":"criar service"}}\n\nATENCAO: MOSTRAR codigo em \`\`\`java\`\`\` NAO CRIA ARQUIVO. SO writeFile cria arquivo.\nSe falta criar mais arquivos, emita o PROXIMO writeFile AGORA. Nada de explicar.`,
                '',
                'Sua resposta (apenas o TOOL_CALL do PROXIMO arquivo a criar, nada mais):',
              ].join('\n');
              try {
                const forcedResp = await axios.post(`${apiUrl}${effectiveEndpoint}`, { prompt: workingPrompt, language: mappedLang }, {
                  headers, timeout: 180000, httpAgent, httpsAgent,
                });
                resposta = forcedResp.data.response || forcedResp.data;
                if (typeof resposta !== 'string') resposta = String(resposta);
                console.log(`[backend][tools] retry ${forcedRetryCount} resposta: ${resposta.slice(0, 200).replace(/\n/g, ' ')}`);
                iter++;
                continue;
              } catch (e) {
                console.error('[backend][tools] erro no retry forçado:', e.message);
              }
            }
            break; // resposta final do modelo
          }

          console.log(`[backend][tools] iter=${iter + 1}/${maxToolCalls} — ${calls.length} tool_call(s) detectada(s)`);
          const results = [];
          for (const c of calls) {
            const name = c.obj.name;
            const args = c.obj.args || c.obj.arguments || {};
            console.log(`[backend][tools] → ${name}(${JSON.stringify(args).slice(0, 120)})`);
            let toolResult;
            // Anti-dup runCommand no escopo do turno.
            let _dupKey = null;
            if (name === 'runCommand') {
              try {
                const _cmd = String(args.cmd || '');
                const _args = Array.isArray(args.args) ? args.args.join(' ') : '';
                const _cwd = String(args.cwd || '');
                _dupKey = `${_cmd}|${_args}|${_cwd}`;
              } catch (_) {}
            }
            if (_dupKey && _ranCmds.has(_dupKey)) {
              console.log(`[backend][tools] 🚫 anti-dup runCommand: ${_dupKey} ja executado neste turno`);
              toolResult = {
                ok: true,
                result: {
                  duplicate: true,
                  note: 'Este comando ja foi executado neste turno. NAO repita. Escreva a RESPOSTA FINAL ao usuario resumindo o que foi feito.',
                },
              };
            } else {
              try {
                toolResult = await onToolCall(name, args, { source: 'ollama-tool-loop' });
              } catch (e) {
                toolResult = { error: String(e && e.message || e) };
              }
              if (_dupKey) _ranCmds.add(_dupKey);
              if (toolResult && toolResult.ok !== false && !(toolResult.result && toolResult.result.duplicate)) {
                toolsExecutedOk++;
                // Resumo legivel pra fallback caso modelo nao feche a resposta.
                if (name === 'runCommand') {
                  const _cmdline = `${args.cmd || ''} ${(Array.isArray(args.args) ? args.args : []).join(' ')}`.trim();
                  const _exit = toolResult.result && typeof toolResult.result.exitCode === 'number' ? toolResult.result.exitCode : '?';
                  _ranSummary.push(`✓ \`${_cmdline}\` (exit=${_exit})`);
                } else if (name === 'writeFile' || name === 'appendToFile' || name === 'patchFile') {
                  _ranSummary.push(`✓ ${name} → ${args.path || '?'}`);
                } else if (name === 'deleteFile') {
                  _ranSummary.push(`✓ deleteFile → ${args.path || '?'}`);
                } else {
                  _ranSummary.push(`✓ ${name}`);
                }
              }
            }
            let serialized;
            try { serialized = typeof toolResult === 'string' ? toolResult : JSON.stringify(toolResult); }
            catch (_) { serialized = String(toolResult); }
            if (serialized.length > 8 * 1024) serialized = serialized.slice(0, 8 * 1024) + '\n…[truncated]';
            results.push(`TOOL_RESULT: ${name}\n${serialized}`);
          }

          // Re-pergunta: contexto atualizado contendo a resposta do modelo
          // (com TOOL_CALLs) + os TOOL_RESULTs. Pedimos resposta final ou
          // novos tool calls.
          workingPrompt = `${workingPrompt}\n\nASSISTANT_PREVIOUS:\n${resposta}\n\n${results.join('\n\n')}\n\nCom base nos TOOL_RESULT acima, ou emita novos TOOL_CALL se precisar de mais info, ou escreva a RESPOSTA FINAL ao usuario (sem nenhum TOOL_CALL).`;

          const followBody = { prompt: workingPrompt, language: mappedLang };
          let followResp;
          try {
            followResp = await axios.post(`${apiUrl}${effectiveEndpoint}`, followBody, {
              headers, timeout: 180000, httpAgent, httpsAgent,
            });
          } catch (e) {
            console.error('[backend][tools] erro no follow-up:', e.message);
            break;
          }
          resposta = followResp.data.response || followResp.data;
          if (typeof resposta !== 'string') resposta = String(resposta);
          iter++;
        }

        const hitLimit = iter === maxToolCalls && parseOllamaToolCalls(resposta).length;
        if (hitLimit) {
          console.warn(`[backend][tools] maxToolCalls=${maxToolCalls} atingido; resposta tinha TOOL_CALL residual`);
        }
        // Limpa qualquer TOOL_CALL residual da resposta final.
        // CRITICO: NAO usar "|| resposta" como fallback — se o strip zerar tudo
        // significa que a resposta era 100% TOOL_CALL e devolver raw vaza JSON
        // tecnico na UI. Melhor mensagem honesta de fallback.
        const stripped = stripToolCallBlocks(resposta);
        if (stripped && stripped.trim()) {
          resposta = stripped;
        } else if (toolsExecutedOk > 0 && _ranSummary.length) {
          // Modelo nao fechou a resposta mas as tools rodaram com sucesso.
          // Devolve um resumo do que foi feito ao inves de erro generico.
          resposta = `Pronto! Comandos executados:\n\n${_ranSummary.join('\n')}`;
        } else {
          resposta = hitLimit
            ? 'Não consegui concluir essa tarefa dentro do limite de ferramentas (a IA ficou em loop). Tente reformular a pergunta ou ser mais específico.'
            : 'Não consegui montar uma resposta útil dessa vez. Tente reformular a pergunta.';
        }
      }

      // Add assistant response to session history
      this.addAssistantResponse(sessionId, resposta);

      return resposta;
    } catch (error) {
      console.error("Erro ao chamar o backend:", error.message);

      // Remove the last user message if the API call fails to avoid cluttering the history
      this.removeLastUserMessage('default');

      // Se for um erro de HTTP (como 422, 404, etc.), a resposta do servidor está em error.response
      if (error.response) {
        console.error("--- DETALHES DO ERRO DO BACKEND ---");
        console.error("Status:", error.response.status);
        console.error("Data:", JSON.stringify(error.response.data, null, 2));
        console.error("------------------------------------");
      }

      // Se for timeout ou socket hang up, não limpa a URL (o backend está funcionando, só demorou)
      if (error.code === "ECONNABORTED" || error.message.includes("socket hang up")) {
        console.log("Request timeout or connection closed - backend is processing but took too long");
        throw new Error(
          `Backend está processando mas a resposta demorou. Tente aumentar o timeout.`
        );
      }

      // Se der erro de rede, pode ser que a URL mudou. Limpamos para buscar de novo na próxima vez.
      if (error.code === "ECONNREFUSED" || error.response?.status === 404) {
        console.log("Backend URL might be outdated. Clearing it.");
        apiUrl = "";
      }
      throw new Error(
        `Falha ao processar a resposta do backend. Status: ${
          error.response?.status || "N/A"
        }`
      );
    }
  }

  async responderStream(texto, onChunk, onComplete, onError) {
    // Validação mais robusta
    if (!texto || typeof texto !== 'string' || texto.trim().length === 0) {
      console.error('Texto inválido para streaming:', texto);
      onError(new Error("Texto inválido ou vazio"));
      return;
    }

    // Se a URL não foi pega ainda, tenta novamente
    if (!apiUrl) {
      console.log("API URL not found, fetching again...");
      await this.getLastEnvUrl();
    }

    // Se ainda não tiver a URL, lança um erro
    if (!apiUrl) {
      onError(new Error("Could not retrieve backend URL."));
      return;
    }

    const sessionId = 'default'; // Using a single session for now
    
    // Manage session context (adds user message and builds context)
    const conversationContext = this.manageSessionContext(sessionId, texto);

    const ip = await configService.getIp();
    const lang = configService.getLanguage();

    const langMap = {
      'pt-br': 'PORTUGUESE',
      'us-en': 'ENGLISH'
    };
    const mappedLang = langMap[lang] || 'PORTUGUESE';

    try {
      // Roteamento: mesma logica do responder() — escolhe modelo e usa
      // a versao -stream do endpoint (ex.: /qwen25-stream, /llamatiny-stream).
      const baseEndpoint = pickOllamaEndpoint(texto);
      const endpoint = `${apiUrl}${baseEndpoint}-stream`;
      console.log(`[backend-stream] roteado para ${baseEndpoint}-stream`);
      const promptInstruction = configService.getPromptInstruction();
      
      // Build prompt with conversation context (mesma logica de responder()).
      let promptWithContext;
      if (baseEndpoint === '/llamatiny') {
        const lastMsgs = conversationContext
          ? conversationContext.split(/\n/).filter(Boolean).slice(-4).join('\n')
          : texto;
        promptWithContext = `${promptInstruction}\n\n${lastMsgs}`;
      } else {
        promptWithContext = conversationContext 
          ? `${promptInstruction}\n\nConversation context:\n${conversationContext}\nPlease respond to the latest human message.`
          : `${promptInstruction}${texto}`;
      }

      const body = {
        prompt: promptWithContext,
        language: mappedLang,
      };

      console.log('Backend stream prompt with context:', promptWithContext);

      const fetchOpts = {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer Y3VzdG9tY3ZvbmxpbmU=',
          'Content-Type': 'application/json',
          'ngrok-skip-browser-warning': 'true',
        },
        body: JSON.stringify(body),
      };

      let response = await fetch(endpoint, fetchOpts);
      // Fallback automatico pra /llama3-stream se o endpoint roteado nao existe
      if (response.status === 404 && baseEndpoint !== '/llama3') {
        console.warn(`[backend-stream] ${baseEndpoint}-stream indisponivel (404), caindo pra /llama3-stream`);
        response = await fetch(`${apiUrl}/llama3-stream`, fetchOpts);
      }

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let fullResponse = ''; // Track complete response for session

      while (true) {
        const { done, value } = await reader.read();
        
        if (done) {
          // Add complete response to session history
          if (fullResponse) {
            this.addAssistantResponse(sessionId, fullResponse);
          }
          if (onComplete) onComplete();
          break;
        }

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        
        // Guarda a última linha incompleta
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6).trim();
            
            // Ignora marcadores de fim
            if (data === '[DONE]' || data.toLowerCase() === 'done') {
              // Add complete response to session history
              if (fullResponse) {
                this.addAssistantResponse(sessionId, fullResponse);
              }
              if (onComplete) onComplete();
              return;
            }

            try {
              const parsed = JSON.parse(data);
              let token = parsed.response || parsed.message || data;
              
              if (typeof token === 'string' && token) {
                console.log('Token recebido do backend:', JSON.stringify(token));
                
                // Track full response
                fullResponse += token;
                
                // Backend já adiciona espaços, só passa direto
                if (onChunk) onChunk(token);
              }
            } catch (e) {
              // Se não for JSON, trata como texto direto
              let token = data;
              
              if (typeof token === 'string' && token.toLowerCase() !== 'done' && token) {
                console.log('Token recebido (raw):', JSON.stringify(token));
                
                // Track full response
                fullResponse += token;
                
                if (onChunk) onChunk(token);
              }
            }
          }
        }
      }
    } catch (error) {
      console.error("Erro ao chamar o backend stream:", error.message);
      
      // Remove the last user message if the API call fails
      this.removeLastUserMessage(sessionId);
      
      if (onError) onError(error);
      throw error;
    }
  }

}

module.exports = new BackendService();
