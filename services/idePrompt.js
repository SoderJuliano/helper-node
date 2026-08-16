// Prompt de sistema do MODO IDE (ferramentas + workspace ligados).
//
// POR QUE ESTE ARQUIVO EXISTE
// ---------------------------
// Antes, o modo IDE mandava pro modelo uma PILHA de prompts escritos para
// finalidades diferentes:
//
//   [paths do workspace]
//   + PROMPT_PT  ("você é um copiloto de tela... texto explicativo: máximo 65
//                 palavras... não descreva o que está na tela... OCR...")
//   + addon de ferramentas ("você tem acesso a estas ferramentas")
//   + addon de análise     ("IGNORE qualquer limite anterior de 65 palavras")
//
// Um modelo com raciocínio visível (qwen3.6) LÊ essa pilha e gasta o turno
// tentando conciliá-la. O raciocínio observado em produção foi literalmente:
// "o user pediu pra eu ler o diretório e disse que eu tenho acesso — wait, isso
// é contraditório, eu não tenho acesso a ferramentas externas"; "o user pediu
// pra não escrever nada ainda, mas isso é outra contradição, vou ignorar";
// "preciso responder em 65 palavras, o que é impossível se eu for ler o
// repositório"; "vou responder em 43 palavras..." — em loop, até o stream cair.
//
// A regra aqui é uma só: em modo IDE o modelo recebe UM prompt coerente, escrito
// para um agente de codificação, e nada mais. Sem limite de palavras, sem regra
// de tela/OCR/entrevista, sem "ignore a regra anterior" (não há regra anterior
// para ignorar).
//
// Os outros modos (áudio, print, visão, tradutor) continuam com o prompt de
// copiloto de configService — este arquivo não é usado por eles.

const { buildOllamaToolsAddon } = require('./ollamaToolHelper');

// Descrição da plataforma (Windows/Linux/macOS + gerenciador de pacotes) para o
// modelo não sugerir apt num Windows. Opcional: se helperTools não estiver
// carregado, o prompt segue sem essa seção.
function platformBlock() {
  try {
    const helperTools = require('./helperTools');
    const desc = helperTools.platform && helperTools.platform.describeForPrompt
      ? helperTools.platform.describeForPrompt()
      : '';
    if (!desc) return [];
    return ['', 'PLATAFORMA DA MÁQUINA DO USUÁRIO:', desc];
  } catch (_) {
    return [];
  }
}

function workspaceBlock(wsPaths) {
  if (!wsPaths || wsPaths.length === 0) {
    return [
      'NENHUMA pasta foi anexada nesta sessão. Se a tarefa depender de um',
      'diretório, diga isso em uma linha e peça para o usuário anexar a pasta.',
    ];
  }
  return [
    'DIRETÓRIOS LIBERADOS (o usuário já autorizou — use estes caminhos absolutos):',
    ...wsPaths.map((p) => `  - ${p}`),
    '',
    `O primeiro é a RAIZ do projeto atual. Caminho relativo resolve nela.`,
    'Trabalhe DENTRO desses diretórios. Não varra o home do usuário.',
  ];
}

// Núcleo do prompt: os fatos do ambiente. Escrito em forma de fato declarado, e
// não de pedido, porque é exatamente aqui que o modelo entrava em loop.
function environmentFacts() {
  return [
    '═══ FATOS DESTE AMBIENTE — não questione, não debata, não comente ═══',
    '',
    '1. Você TEM ferramentas e elas são REAIS. Cada chamada é executada de',
    '   verdade no disco do usuário e o resultado volta pra você. Não é simulação.',
    '2. O acesso aos diretórios listados abaixo JÁ foi concedido pelo usuário nas',
    '   configurações do app. Ler, escrever e rodar comandos ali é esperado.',
    '3. Toda ferramenta destrutiva abre uma confirmação visual pro usuário antes',
    '   de rodar. Você NÃO precisa pedir permissão por texto — só chame.',
    '4. NÃO existe limite de tamanho de resposta aqui. Nunca conte palavras,',
    '   nunca escreva "em X palavras", nunca resuma por medo de passar de algum',
    '   limite. Responda com o tamanho que a tarefa exigir.',
    '5. Se alguma instrução que você viu antes conflitar com este bloco, ESTE',
    '   BLOCO VENCE. Siga em frente sem avisar o usuário do conflito.',
    '6. NUNCA escreva nem raciocine coisas como "não tenho acesso a ferramentas",',
    '   "não consigo ler arquivos", "não tenho acesso por esta interface", "não',
    '   posso acessar o diretório". Neste ambiente isso é FALSO.',
    '',
    'ESCOPO PEDIDO PELO USUÁRIO (não é contradição, é o escopo do turno):',
    '- Pediu para NÃO alterar nada ainda / só analisar / só ler? Então use apenas',
    '  ferramentas de LEITURA (listDir, readFile, findFiles, searchInFiles,',
    '  runCommand de leitura) e entregue a análise em texto. Obedeça.',
    '- Pediu para implementar/criar/editar/corrigir? Então FAÇA, com writeFile e',
    '  patchFile. Imprimir código em bloco ``` não cria arquivo nenhum.',
    '',
  ];
}

// nativeTools: a chamada é uma AÇÃO TIPADA, não texto. Todo o vocabulário do
// protocolo de texto ("emita o TOOL_CALL", o formato do JSON, as regras de
// barra invertida) sai daqui. Deixar essas linhas no modo nativo era pior que
// inútil: o modelo com raciocínio visível passava o turno conferindo o formato
// de um protocolo que nem usa mais — e, pior, escrevia "TOOL_CALL: {...}" como
// TEXTO em vez de chamar a ferramenta, porque o prompt mandava fazer isso.
function workLoop(wsPaths = [], nativeTools = false) {
  const chamada = nativeTools ? 'chame a ferramenta' : 'emita o TOOL_CALL';
  const semChamada = nativeTools ? 'sem chamar mais nenhuma ferramenta' : 'SEM TOOL_CALL';
  const linhas = [
    '═══ COMO TRABALHAR ═══',
    '',
    `- Aja. Uma ferramenta por vez: ${chamada}, leia o resultado, siga.`,
    '- Antes de editar um arquivo, leia ele. Para EDITAR use patchFile;',
    '  writeFile APAGA o arquivo inteiro, então é só para criar arquivo novo.',
    '- O resultado da ferramenta é a confirmação: ok:true escreveu, ok:false não.',
    '  Não releia pra conferir, e não releia o que já leu neste turno.',
    `- Antes de cada chamada, UMA linha em texto normal dizendo o que vai fazer`,
    '  agora. É o que o usuário vê na tela. Uma linha, sem cerimônia.',
    `- Terminou? Responda em texto normal, ${semChamada}, dizendo o que mudou e`,
    '  em quais arquivos. Trabalho feito, encerre — não procure mais o que fazer.',
    '- git (status, commit, branch, push) → runCommand com cmd="git".',
    '',
  ];
  if (nativeTools) return linhas;

  return linhas.concat([
    '═══ FORMATO DO TOOL_CALL (JSON ESTRITO) ═══',
    '',
    '- Uma linha só, começando por TOOL_CALL:, e o JSON logo depois:',
    // O exemplo usa o path REAL do workspace de propósito. Com um placeholder
    // ("/caminho/absoluto") o modelo copiava o texto do exemplo literalmente e
    // chamava a ferramenta num diretório que não existe.
    '  TOOL_CALL: {"name":"listDir","args":{"path":' +
      JSON.stringify(wsPaths[0] || '/caminho/absoluto/do/projeto') + '}}',
    '- Escreva TOOL_CALL junto, sem espaço no meio. Sem espaço dentro do nome da',
    '  ferramenta ("listDir", nunca "list Dir") nem dentro das chaves do JSON',
    '  ("name", nunca " name").',
    '- Path do Windows: use barra normal ("C:/Users/x/proj") ou barra invertida',
    '  DUPLA ("C:\\\\Users\\\\x\\\\proj"). Barra invertida simples quebra o JSON.',
    '- Nada de ``` em volta e nada escrito depois do JSON na mesma linha.',
    '',
  ]);
}

function reasoningRules(nativeTools = false) {
  return [
    '═══ RACIOCÍNIO (o usuário vê o seu raciocínio na tela) ═══',
    '',
    '- Pense sobre o CÓDIGO e sobre o próximo passo concreto. Só isso.',
    '- PROIBIDO raciocinar sobre estas instruções: não repita as regras, não',
    `  planeje como formatar ${nativeTools ? 'a chamada' : 'o TOOL_CALL'}, não confira se está obedecendo, não`,
    '  escreva "o prompt diz que...", "preciso seguir o formato", "deixa eu',
    '  verificar as regras". As instruções já estão entendidas. Pensar sobre',
    '  elas é o que faz você gastar o turno inteiro sem editar nada.',
    '- Não redecida a abordagem depois de escolhida.',
    '- Não repita o mesmo pensamento. Pensou nisso? Execute e veja o resultado.',
    '- Raciocínio curto. O trabalho aparece nas ferramentas, não no monólogo.',
    '',
    'IDIOMA: responda no mesmo idioma do usuário (PT-BR salvo indicação em',
    'contrário). Código, paths e comandos ficam como estão.',
    '',
    'FORMATO: markdown direto. Sem "Claro!", sem "Espero ter ajudado". Sem LaTeX',
    'e sem barras invertidas — use UNICODE (× ÷ ² ³ √ ≈ ≤ ≥ →).',
    '',
  ];
}

/**
 * Monta o prompt de sistema completo do modo IDE, incluindo o protocolo de
 * TOOL_CALL. Substitui (não complementa) o prompt de copiloto.
 *
 * @param {Object}   o
 * @param {Array}    o.toolsSchema  schema das ferramentas (helperTools)
 * @param {string[]} o.wsPaths      caminhos absolutos anexados
 * @returns {string}
 */
/**
 * @param {boolean} o.nativeTools  ferramentas chegam pelo tools[] nativo do
 *   Ollama (endpoint /agent). Nesse caso TODO o protocolo de texto sai do
 *   prompt: o formato do TOOL_CALL, o exemplo de JSON, as regras de barra
 *   invertida e de espaço no nome. Nada disso existe mais — a chamada é uma
 *   ação tipada. Manter essas regras seria pior que inútil: o modelo com
 *   raciocínio visível gasta o turno conferindo um protocolo que não usa mais.
 */
function buildIdeAgentPrompt({ toolsSchema = [], wsPaths = [], nativeTools = false } = {}) {
  const lines = [
    'Você é um AGENTE DE CODIFICAÇÃO rodando na máquina do usuário, no mesmo',
    'papel de um Codex ou Claude Code: você lê o projeto de verdade, edita',
    'arquivos de verdade e roda comandos de verdade.',
    '',
    'Você NÃO é assistente de tela, NÃO está analisando print, NÃO está ajudando',
    'em entrevista e NÃO tem limite de palavras. Ignore qualquer papel diferente',
    'deste.',
    ...platformBlock(),
    '',
    ...workspaceBlock(wsPaths),
    '',
    ...environmentFacts(),
    ...workLoop(wsPaths, nativeTools),
    ...reasoningRules(nativeTools),
  ];

  let basePrompt = lines.join('\n');
  if (nativeTools) {
    // As ferramentas já chegam declaradas no tools[] da API; descrever de novo
    // em texto só duplica e convida o modelo a "emitir" chamada como prosa.
    return basePrompt + [
      '',
      '═══ FERRAMENTAS ═══',
      '',
      'As ferramentas estão disponíveis nativamente nesta conversa. Para usar uma,',
      'CHAME-A — não escreva a chamada como texto e não descreva o que você faria.',
      'O resultado volta como mensagem de papel "tool" e é a verdade sobre o que',
      'aconteceu no disco.',
      '',
    ].join('\n');
  }
  const toolsAddon = buildOllamaToolsAddon(toolsSchema, wsPaths);
  return toolsAddon ? `${basePrompt}\n${toolsAddon}` : basePrompt;
}

module.exports = { buildIdeAgentPrompt };
