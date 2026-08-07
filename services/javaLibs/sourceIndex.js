// services/javaLibs/sourceIndex.js
// Índice das classes que vivem dentro dos -sources.jar das bibliotecas, para
// que Ctrl+clique num símbolo de biblioteca abra o código original.
//
// O índice guarda só nomes de entrada (string), nunca o conteúdo dos jars: um
// projeto Spring tem dezenas de milhares de classes e carregar o fonte de
// todas na memória não se paga. O arquivo pedido é extraído sob demanda para
// um cache em disco, e é esse caminho real que o editor abre.

const fs = require('fs');
const os = require('os');
const path = require('path');
const zip = require('./zipReader');
const libs = require('./index');

const CACHE_DIR = path.join(os.homedir(), '.config', 'helper-node', 'lib-sources');

// nome simples da classe -> [{ artifactId, version, jar, entrada, pacote }]
let indice = new Map();
let projetoIndexado = null;
let indexando = false;

function limpar() {
  indice = new Map();
  projetoIndexado = null;
}

function getCacheDir() { return CACHE_DIR; }

// Um caminho está no cache de fontes de biblioteca? Usado pra liberar a leitura
// desses arquivos, que ficam fora do workspace do usuário.
function ehCaminhoDeCache(p) {
  if (!p) return false;
  const rel = path.relative(CACHE_DIR, path.resolve(p));
  return !!rel && !rel.startsWith('..') && !path.isAbsolute(rel);
}

// Indexa os -sources.jar do projeto. Sem I/O de conteúdo: só o índice central
// de cada jar, que é barato (medido em ~2ms por jar).
function indexar(projectPath) {
  if (indexando) return { ok: false, erro: 'indexação em andamento' };
  indexando = true;
  try {
    const t0 = Date.now();
    const r = libs.listarBibliotecas(projectPath);
    const novo = new Map();
    let jarsLidos = 0;

    for (const lib of (r.libs || [])) {
      if (!lib.sources) continue;
      const entradas = zip.listarEntradas(lib.sources);
      if (!entradas.length) continue;
      jarsLidos++;
      for (const e of entradas) {
        if (!e.nome.endsWith('.java')) continue;
        const nomeSimples = path.basename(e.nome, '.java');
        // package-info e module-info não são classes navegáveis.
        if (nomeSimples === 'package-info' || nomeSimples === 'module-info') continue;
        const pacote = path.dirname(e.nome).replace(/\//g, '.');
        const lista = novo.get(nomeSimples) || [];
        lista.push({
          artifactId: lib.artifactId,
          version: lib.version,
          jar: lib.sources,
          entrada: e.nome,
          pacote: pacote === '.' ? '' : pacote,
        });
        novo.set(nomeSimples, lista);
      }
    }

    indice = novo;
    projetoIndexado = projectPath;
    const ms = Date.now() - t0;
    console.log(`[javaLibs] índice de fontes: ${indice.size} classes de ${jarsLidos} jar(s) em ${ms}ms`);
    return { ok: true, classes: indice.size, jars: jarsLidos, ms };
  } catch (e) {
    console.warn('[javaLibs] falha ao indexar fontes:', e.message);
    return { ok: false, erro: e.message };
  } finally {
    indexando = false;
  }
}

function estaIndexado(projectPath) {
  return projetoIndexado === projectPath && indice.size > 0;
}

// Procura a classe pelo nome simples. `dicasImport` são as linhas de import do
// arquivo atual, usadas pra desempatar quando o nome existe em mais de um
// pacote (`List` em java.util e em outra lib, por exemplo).
function acharClasse(nomeSimples, dicasImport = []) {
  const achados = indice.get(nomeSimples);
  if (!achados || !achados.length) return null;
  if (achados.length === 1) return achados[0];

  for (const dica of dicasImport) {
    const alvo = achados.find(a => a.pacote && dica.includes(a.pacote + '.' + nomeSimples));
    if (alvo) return alvo;
  }
  return achados[0];
}

// Extrai a classe pro cache e devolve o caminho em disco. Idempotente.
function extrairClasse(alvo) {
  if (!alvo || !alvo.jar || !alvo.entrada) return null;
  const destino = path.join(
    CACHE_DIR,
    `${alvo.artifactId}-${alvo.version || 'sem-versao'}`,
    ...alvo.entrada.split('/')
  );
  try {
    if (fs.existsSync(destino) && fs.statSync(destino).size > 0) return destino;
    const entradas = zip.listarEntradas(alvo.jar);
    const e = entradas.find(x => x.nome === alvo.entrada);
    if (!e) return null;
    const buf = zip.lerEntrada(alvo.jar, e);
    if (!buf) return null;
    fs.mkdirSync(path.dirname(destino), { recursive: true });
    fs.writeFileSync(destino, buf);
    return destino;
  } catch (err) {
    console.warn('[javaLibs] falha ao extrair', alvo.entrada, '-', err.message);
    return null;
  }
}

// Ponto de entrada do "ir para definição" quando o símbolo não está no projeto.
function abrirDefinicao(nomeSimples, dicasImport = []) {
  const alvo = acharClasse(nomeSimples, dicasImport);
  if (!alvo) return null;
  const caminho = extrairClasse(alvo);
  if (!caminho) return null;
  return {
    filePath: caminho,
    line: 1,
    col: 1,
    symbol: nomeSimples,
    kind: 'library',
    className: nomeSimples,
    biblioteca: `${alvo.artifactId}:${alvo.version || '?'}`,
    pacote: alvo.pacote,
    somenteLeitura: true,
  };
}

module.exports = {
  indexar, estaIndexado, acharClasse, extrairClasse, abrirDefinicao,
  limpar, getCacheDir, ehCaminhoDeCache, CACHE_DIR,
};
