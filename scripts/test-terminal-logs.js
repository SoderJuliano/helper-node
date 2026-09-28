#!/usr/bin/env node
// Teste unitário e de integração para o salvamento de logs do terminal.

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

const { defaultConfig } = require('../services/config/defaultConfig.js');
const configService = require('../services/configService.js');
const terminalLogService = require('../services/terminalLogService.js');

let falhas = 0;
function test(nome, fn) {
  try {
    fn();
    console.log(`  ok   ${nome}`);
  } catch (e) {
    falhas++;
    console.error(`  FALHA ${nome}:`, e.message);
  }
}

async function runTests() {
  console.log('Iniciando testes da funcionalidade de logs do terminal...\n');

  // 1. Configuração padrão desativada
  test('defaultConfig deve conter terminalLogs desativado por padrão', () => {
    assert.strictEqual(defaultConfig.terminalLogs, false);
  });

  // 2. Acessores do configService
  test('configService.getTerminalLogsStatus() retorna boolean', () => {
    const status = configService.getTerminalLogsStatus();
    assert.strictEqual(typeof status, 'boolean');
  });

  test('configService.setTerminalLogsStatus alterna corretamente o status', () => {
    const original = configService.getTerminalLogsStatus();
    try {
      configService.setTerminalLogsStatus(true);
      assert.strictEqual(configService.getTerminalLogsStatus(), true);
      configService.setTerminalLogsStatus(false);
      assert.strictEqual(configService.getTerminalLogsStatus(), false);
    } finally {
      configService.setTerminalLogsStatus(original);
    }
  });

  // 3. Caminho do arquivo de log na pasta do usuário
  test('terminalLogService deve apontar para arquivo na pasta do usuário (os.homedir)', () => {
    const logPath = terminalLogService.getLogFilePath();
    assert(logPath.startsWith(os.homedir()), 'O caminho do log deve estar em os.homedir()');
    assert(logPath.endsWith('terminal-logs.txt'), 'O arquivo deve ser terminal-logs.txt');
  });

  // 4. Limpeza de sequências ANSI e caracteres de controle
  test('stripAnsi remove cores ANSI SGR', () => {
    const raw = '\x1b[31mTexto em vermelho\x1b[0m e \x1b[32mverde\x1b[0m';
    const clean = terminalLogService.stripAnsi(raw);
    assert.strictEqual(clean, 'Texto em vermelho e verde');
  });

  test('stripAnsi remove sequências CSI complexas e OSC', () => {
    const raw = '\x1b]0;Titulo da janela\x07\x1b[?2004hls -la\x1b[?2004l\x1b[2K\r\n';
    const clean = terminalLogService.stripAnsi(raw);
    assert.strictEqual(clean, 'ls -la\r\n');
  });

  test('stripAnsi preserva tabulações e quebras de linha normais', () => {
    const raw = 'Linha 1\tColuna 2\r\nLinha 2';
    const clean = terminalLogService.stripAnsi(raw);
    assert.strictEqual(clean, 'Linha 1\tColuna 2\r\nLinha 2');
  });

  // 5. Escrita de logs em arquivo temporário
  const tmpLogFile = path.join(os.tmpdir(), `test-terminal-logs-${Date.now()}.txt`);
  terminalLogService.setLogFilePath(tmpLogFile);

  test('writeChunk escreve texto limpo no arquivo', async () => {
    terminalLogService.writeSessionMarker('start', 'teste unitario');
    terminalLogService.writeChunk('\x1b[34m$ git status\x1b[0m\r\nOn branch main\r\n');
    terminalLogService.writeSessionMarker('end', 'codigo: 0');
    terminalLogService.closeStream();

    assert(fs.existsSync(tmpLogFile), 'Arquivo de log temporário deve existir');
    const conteudo = fs.readFileSync(tmpLogFile, 'utf8');
    assert(conteudo.includes('Sessao do terminal iniciada'), 'Deve conter marcador de início');
    assert(conteudo.includes('$ git status'), 'Deve conter comando sem ANSI');
    assert(conteudo.includes('On branch main'), 'Deve conter saída do comando');
    assert(conteudo.includes('Sessao do terminal finalizada'), 'Deve conter marcador de término');
    assert(!conteudo.includes('\x1b['), 'Não deve conter caracteres de escape ANSI');
  });

  // Limpeza
  try {
    if (fs.existsSync(tmpLogFile)) fs.unlinkSync(tmpLogFile);
  } catch (_) {}

  // Restaura caminho original
  terminalLogService.setLogFilePath(path.join(os.homedir(), 'terminal-logs.txt'));

  console.log(`\nTestes concluídos com ${falhas} falha(s).`);
  process.exit(falhas > 0 ? 1 : 0);
}

runTests();
