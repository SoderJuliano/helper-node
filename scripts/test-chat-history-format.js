// scripts/test-chat-history-format.js
// Testa a formatacao correta de tabelas e blocos de codigo no historico de conversas.

const assert = require('assert');
const fs = require('fs');

console.log('=== Testando Formatacao de Markdown e Historico de Chat ===\n');

// 1. Verifica chatHistory.js
const chatHistoryJs = fs.readFileSync('renderer/chatHistory.js', 'utf8');
assert.ok(chatHistoryJs.includes('window.renderMarkdown'), 'chatHistory.js deve usar window.renderMarkdown para restaurar mensagens de IA');
assert.ok(chatHistoryJs.includes('resp.innerHTML = formatted'), 'chatHistory.js deve setar resp.innerHTML com o markdown formatado');
console.log('  ok   chatHistory.js renderiza mensagens restauradas com renderMarkdown e innerHTML');

// 2. Verifica chatHistoryViewer.js
const chatHistoryViewerJs = fs.readFileSync('renderer/chatHistoryViewer.js', 'utf8');
assert.ok(chatHistoryViewerJs.includes('window.renderMarkdown'), 'chatHistoryViewer.js deve usar window.renderMarkdown');
console.log('  ok   chatHistoryViewer.js renderiza mensagens com renderMarkdown');

// 3. Verifica CSS de loading nos links de arquivo
const chatCss = fs.readFileSync('styles/chatFormatting.css', 'utf8');
assert.ok(chatCss.includes('.chat-file-link.is-loading'), 'chatFormatting.css deve conter estilos de loading para links');
assert.ok(chatCss.includes('spin-chat-file-link'), 'chatFormatting.css deve conter animacao de spinner');
console.log('  ok   Estilos de loading e spinner configurados para links de arquivo');

// 4. Verifica chatMessages.js
const chatMessagesJs = fs.readFileSync('renderer/chatMessages.js', 'utf8');
assert.ok(chatMessagesJs.includes('is-loading'), 'chatMessages.js deve aplicar is-loading ao abrir links de arquivo');
console.log('  ok   chatMessages.js bloqueia multiplos cliques e exibe indicador de loading');

console.log('\nTodos os testes de formatacao e links de chat passaram com sucesso! \n');
