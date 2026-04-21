const fs = require('fs').promises;
const path = require('path');
const { app } = require('electron');

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB
const HISTORY_FILENAME_PATTERN = 'history_';
const HISTORY_FILE_EXT = '.json';

let historyDir = null;
let currentFileIndex = 1;
let currentSessions = []; // Cache da sessão atual em memória

/**
 * Inicializa o diretório de histórico
 */
async function initialize() {
  try {
    const userData = app.getPath('userData');
    historyDir = path.join(userData, 'history');
    
    // Criar diretório se não existir
    try {
      await fs.mkdir(historyDir, { recursive: true });
    } catch (e) {
      // Diretório já existe
    }

    // Encontrar o arquivo mais recente
    await findLatestFile();
    console.log(`✓ History service initialized at: ${historyDir}`);
  } catch (error) {
    console.error('Erro ao inicializar historyService:', error);
  }
}

/**
 * Encontra o arquivo de histórico mais recente
 */
async function findLatestFile() {
  try {
    const files = await fs.readdir(historyDir);
    const historyFiles = files
      .filter(f => f.startsWith(HISTORY_FILENAME_PATTERN) && f.endsWith(HISTORY_FILE_EXT))
      .sort((a, b) => {
        const numA = parseInt(a.replace(HISTORY_FILENAME_PATTERN, '').replace(HISTORY_FILE_EXT, ''));
        const numB = parseInt(b.replace(HISTORY_FILENAME_PATTERN, '').replace(HISTORY_FILE_EXT, ''));
        return numB - numA; // Ordem decrescente
      });

    if (historyFiles.length > 0) {
      const latestFile = historyFiles[0];
      currentFileIndex = parseInt(
        latestFile.replace(HISTORY_FILENAME_PATTERN, '').replace(HISTORY_FILE_EXT, '')
      );
      
      // Carregar sessões do arquivo mais recente
      await loadCurrentFile();
    } else {
      // Primeiro arquivo
      currentFileIndex = 1;
      currentSessions = [];
      await saveCurrentFile();
    }
  } catch (error) {
    console.error('Erro ao encontrar arquivo de histórico:', error);
    currentFileIndex = 1;
    currentSessions = [];
  }
}

/**
 * Carrega o arquivo de histórico atual
 */
async function loadCurrentFile() {
  try {
    const filePath = getHistoryFilePath(currentFileIndex);
    const data = await fs.readFile(filePath, 'utf-8');
    currentSessions = JSON.parse(data) || [];
  } catch (error) {
    console.error(`Erro ao carregar arquivo ${currentFileIndex}:`, error);
    currentSessions = [];
  }
}

/**
 * Salva o arquivo de histórico atual
 */
async function saveCurrentFile() {
  try {
    if (!historyDir) return;
    
    const filePath = getHistoryFilePath(currentFileIndex);
    const data = JSON.stringify(currentSessions, null, 2);
    const size = Buffer.byteLength(data, 'utf-8');

    // Se arquivo exceder 5MB, criar novo
    if (size > MAX_FILE_SIZE) {
      currentFileIndex++;
      currentSessions = [];
      await saveCurrentFile();
      return;
    }

    await fs.writeFile(filePath, data, 'utf-8');
  } catch (error) {
    console.error('Erro ao salvar arquivo de histórico:', error);
  }
}

/**
 * Retorna o caminho do arquivo de histórico
 */
function getHistoryFilePath(index) {
  return path.join(historyDir, `${HISTORY_FILENAME_PATTERN}${index}${HISTORY_FILE_EXT}`);
}

/**
 * Cria uma nova sessão com título
 */
async function createNewSession(title) {
  const session = {
    id: Date.now(),
    title: title || 'Sem título',
    created: new Date().toISOString(),
    conversations: []
  };

  currentSessions.push(session);
  await saveCurrentFile();

  return session;
}

/**
 * Adiciona uma mensagem à sessão atual
 */
async function addMessage(sessionId, role, content) {
  const session = currentSessions.find(s => s.id === sessionId);
  if (!session) return;

  session.conversations.push({
    role, // 'user' ou 'assistant'
    content,
    timestamp: new Date().toISOString()
  });

  await saveCurrentFile();
}

/**
 * Retorna as últimas 3 sessões
 */
function getLastThreeSessions() {
  return currentSessions
    .sort((a, b) => new Date(b.created) - new Date(a.created))
    .slice(0, 3)
    .map(s => ({
      id: s.id,
      title: s.title,
      created: s.created
    }));
}

/**
 * Retorna uma sessão completa com histórico
 */
function getSessionById(sessionId) {
  return currentSessions.find(s => s.id === sessionId);
}

/**
 * Limpa sessão em memória (inicia novo chat)
 */
function clearCurrentSessionFromMemory() {
  // Simplesmente retorna para não manter contexto
  return null;
}

/**
 * Retorna sessão atual (última criada)
 */
function getCurrentSession() {
  if (currentSessions.length === 0) return null;
  return currentSessions[currentSessions.length - 1];
}

/**
 * Deleta uma sessão pelo ID
 */
async function deleteSession(sessionId) {
  try {
    const initialLength = currentSessions.length;
    currentSessions = currentSessions.filter(s => s.id !== sessionId);
    
    // Se algo foi deletado, salva o arquivo
    if (currentSessions.length < initialLength) {
      await saveCurrentFile();
      return true;
    }
    return false;
  } catch (error) {
    console.error('Erro ao deletar sessão:', error);
    return false;
  }
}

module.exports = {
  initialize,
  createNewSession,
  addMessage,
  getLastThreeSessions,
  getSessionById,
  getCurrentSession,
  clearCurrentSessionFromMemory,
  deleteSession,
};
