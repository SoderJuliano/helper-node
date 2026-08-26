// services/providers/gemini-cli/GeminiCliPatterns.js

const ANSI_RE = /[\u001b\u009b]\[[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g;

const PROMPT_PATTERNS = [
  /^>\s*$/,
  /^❯\s*$/,
  /^\$\s*$/,
  /^gemini>\s*$/i,
  /^agy>\s*$/i,
  /^\(\d+\)\s*>\s*$/,
];

const THINKING_START_PATTERNS = [
  /^<thinking>/i,
  /^\[thinking\]/i,
  /^thinking\.\.\./i,
  /^✦\s+thinking/i,
  /^·\s+thinking/i,
  /^\*\*thinking\*\*/i,
];

const THINKING_END_PATTERNS = [
  /^<\/thinking>/i,
  /^\[\/thinking\]/i,
  /^done thinking/i,
];

const TOOL_PATTERNS = [
  { re: /^(?:edit|writing|updating|modifying)\s+(.+)/i, label: 'Editando arquivo' },
  { re: /^(?:reading|opening)\s+(.+)/i, label: 'Lendo arquivo' },
  { re: /^(?:running|executing|running command):\s*(.+)/i, label: 'Executando' },
  { re: /^(?:searching|looking for)\s+(.+)/i, label: 'Buscando' },
  { re: /^(?:creating|new file)\s+(.+)/i, label: 'Criando arquivo' },
  { re: /^(?:deleting|removing)\s+(.+)/i, label: 'Removendo arquivo' },
  { re: /^[╭┌]\s*(?:Tool|Action|Command):\s*(.+)/i, label: 'Ferramenta' },
];

const SUPPRESS_PATTERNS = [
  /^╭/, /^╰/, /^│/, /^╞/, /^╡/, /^─+$/,
  /^✻\s+Welcome/i,
  /^\s*$/,
  /^Gemini\s+\d/i,
  /^Type\s+\/help/i,
  /^Using\s+model/i,
];

function stripAnsi(text) {
  return (text || '').replace(ANSI_RE, '');
}

function isPrompt(line) {
  return PROMPT_PATTERNS.some(p => p.test(line));
}

function isSuppressed(line) {
  return SUPPRESS_PATTERNS.some(p => p.test(line));
}

module.exports = {
  ANSI_RE,
  PROMPT_PATTERNS,
  THINKING_START_PATTERNS,
  THINKING_END_PATTERNS,
  TOOL_PATTERNS,
  SUPPRESS_PATTERNS,
  stripAnsi,
  isPrompt,
  isSuppressed,
};
