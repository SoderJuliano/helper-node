// services/javaLibs/zipReader.js
// Leitor de ZIP mínimo, em Node puro. Um .jar é um .zip.
//
// Por que não usar uma lib: `yauzl` só existe neste projeto como dependência
// TRANSITIVA (veio junto do electron-builder). Depender dela quebraria numa
// atualização de dependências sem ninguém perceber. E chamar `jar`/`unzip` por
// linha de comando amarraria a feature ao JDK instalado e a shells diferentes
// no Windows e no Linux — o tipo de coisa que já quebrou aqui antes.
//
// Só o necessário: ler o índice central e extrair uma entrada (armazenada ou
// deflacionada). Sem escrita, sem zip64, sem criptografia.

const fs = require('fs');
const zlib = require('zlib');

const ASSINATURA_FIM_CENTRAL = 0x06054b50;
const ASSINATURA_ENTRADA_CENTRAL = 0x02014b50;

// O "end of central directory" fica no fim do arquivo, depois de um comentário
// de tamanho variável (até 64KB). Procura de trás pra frente.
function acharFimCentral(fd, tamanho) {
  const maxComentario = 0xffff;
  const janela = Math.min(tamanho, maxComentario + 22);
  const buf = Buffer.alloc(janela);
  fs.readSync(fd, buf, 0, janela, tamanho - janela);
  for (let i = buf.length - 22; i >= 0; i--) {
    if (buf.readUInt32LE(i) === ASSINATURA_FIM_CENTRAL) {
      return {
        totalEntradas: buf.readUInt16LE(i + 10),
        tamanhoCentral: buf.readUInt32LE(i + 12),
        offsetCentral: buf.readUInt32LE(i + 16),
      };
    }
  }
  return null;
}

// Lê o índice central e devolve [{ nome, metodo, offsetLocal, tamanhoComprimido, tamanho }].
function listarEntradas(caminhoZip) {
  let fd;
  try {
    fd = fs.openSync(caminhoZip, 'r');
    const tamanho = fs.fstatSync(fd).size;
    const fim = acharFimCentral(fd, tamanho);
    if (!fim) return [];

    const central = Buffer.alloc(fim.tamanhoCentral);
    fs.readSync(fd, central, 0, fim.tamanhoCentral, fim.offsetCentral);

    const entradas = [];
    let p = 0;
    while (p + 46 <= central.length) {
      if (central.readUInt32LE(p) !== ASSINATURA_ENTRADA_CENTRAL) break;
      const metodo = central.readUInt16LE(p + 10);
      const tamanhoComprimido = central.readUInt32LE(p + 20);
      const tamanhoOriginal = central.readUInt32LE(p + 24);
      const tamNome = central.readUInt16LE(p + 28);
      const tamExtra = central.readUInt16LE(p + 30);
      const tamComentario = central.readUInt16LE(p + 32);
      const offsetLocal = central.readUInt32LE(p + 42);
      const nome = central.toString('utf8', p + 46, p + 46 + tamNome);
      entradas.push({ nome, metodo, offsetLocal, tamanhoComprimido, tamanho: tamanhoOriginal });
      p += 46 + tamNome + tamExtra + tamComentario;
    }
    return entradas;
  } catch (e) {
    console.warn('[zipReader] falha ao ler', caminhoZip, '-', e.message);
    return [];
  } finally {
    if (fd !== undefined) { try { fs.closeSync(fd); } catch (_) {} }
  }
}

// Extrai UMA entrada. Devolve Buffer, ou null.
function lerEntrada(caminhoZip, entrada) {
  if (!entrada) return null;
  let fd;
  try {
    fd = fs.openSync(caminhoZip, 'r');
    // O cabeçalho local tem tamanhos de nome/extra próprios — precisa ler ele
    // pra saber onde os dados começam de verdade.
    const cabecalho = Buffer.alloc(30);
    fs.readSync(fd, cabecalho, 0, 30, entrada.offsetLocal);
    const tamNome = cabecalho.readUInt16LE(26);
    const tamExtra = cabecalho.readUInt16LE(28);
    const inicioDados = entrada.offsetLocal + 30 + tamNome + tamExtra;

    const bruto = Buffer.alloc(entrada.tamanhoComprimido);
    fs.readSync(fd, bruto, 0, entrada.tamanhoComprimido, inicioDados);

    if (entrada.metodo === 0) return bruto;            // armazenado
    if (entrada.metodo === 8) return zlib.inflateRawSync(bruto); // deflate
    console.warn('[zipReader] método de compressão não suportado:', entrada.metodo);
    return null;
  } catch (e) {
    console.warn('[zipReader] falha ao extrair', entrada.nome, '-', e.message);
    return null;
  } finally {
    if (fd !== undefined) { try { fs.closeSync(fd); } catch (_) {} }
  }
}

// Conveniência: extrai pelo nome da entrada.
function lerArquivoDoZip(caminhoZip, nomeEntrada) {
  const entradas = listarEntradas(caminhoZip);
  const alvo = entradas.find(e => e.nome === nomeEntrada);
  return alvo ? lerEntrada(caminhoZip, alvo) : null;
}

module.exports = { listarEntradas, lerEntrada, lerArquivoDoZip };
