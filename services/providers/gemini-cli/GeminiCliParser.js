// Parses raw stdout chunks from an interactive `gemini` CLI process.
//
// Responsibilities:
//   - Strip ANSI escape codes
//   - Detect when a response is complete (prompt indicator appears)
//   - Detect thinking blocks
//   - Detect tool activity (file edits, shell commands, etc.)
//   - Emit structured events via callbacks
//
// The parser is stateful: feed() each stdout chunk as it arrives.

// Matches any ANSI/VT100 escape sequence (CSI, OSC, color codes, etc.)
const ANSI_RE = /[](?:[@-Z\\-_]|\[[0-9;]*[ -/]*[@-~]|\][^]*(?:|\\)|[()][0-9A-Za-z])/g;

// Patterns that indicate the CLI is ready for the next input (response is done).
// Matched against ANSI-stripped lines.
const PROMPT_PATTERNS = [
  /^>\s*$/,          // ">" or "> " — standard
  /^❯\s*$/,          // "❯" or "❯ " — fancy unicode
  /^\$\s*$/,         // "$" or "$ " — shell-style
  /^gemini>\s*$/i,   // "gemini>" or "gemini> "
  /^agy>\s*$/i,      // "agy>" or "agy> "
  /^\(\d+\)\s*>\s*$/, // "(1) >" or "(1) > " — numbered prompts
];

// Patterns that signal the start of a thinking/planning block.
const THINKING_START_PATTERNS = [
  /^<thinking>/i,
  /^\[thinking\]/i,
  /^thinking\.\.\./i,
  /^✦\s+thinking/i,
  /^·\s+thinking/i,
  /^\*\*thinking\*\*/i,
];

// Patterns that signal the end of a thinking block.
const THINKING_END_PATTERNS = [
  /^<\/thinking>/i,
  /^\[\/thinking\]/i,
  /^done thinking/i,
];

// Tool activity patterns in Gemini CLI output.
const TOOL_PATTERNS = [
  { re: /^(?:edit|writing|updating|modifying)\s+(.+)/i,      label: 'Editando arquivo' },
  { re: /^(?:reading|opening)\s+(.+)/i,                       label: 'Lendo arquivo' },
  { re: /^(?:running|executing|running command):\s*(.+)/i,    label: 'Executando' },
  { re: /^(?:searching|looking for)\s+(.+)/i,                 label: 'Buscando' },
  { re: /^(?:creating|new file)\s+(.+)/i,                     label: 'Criando arquivo' },
  { re: /^(?:deleting|removing)\s+(.+)/i,                     label: 'Removendo arquivo' },
  // Box-drawing tool headers (gemini CLI uses these for tool calls)
  { re: /^[╭┌]\s*(?:Tool|Action|Command):\s*(.+)/i,          label: 'Ferramenta' },
];

// Lines that are UI chrome — suppress from the response.
const SUPPRESS_PATTERNS = [
  /^╭/, /^╰/, /^│/, /^╞/, /^╡/, /^─+$/,  // box-drawing
  /^✻\s+Welcome/i,                           // welcome banner
  /^\s*$/ ,                                   // blank lines at boundaries
  /^Gemini\s+\d/i,                           // "Gemini 2.5 Pro" header
  /^Type\s+\/help/i,                         // help hint
  /^Using\s+model/i,                         // model announcement
];

function stripAnsi(text) {
  return text.replace(ANSI_RE, '');
}

function isPrompt(line) {
  return PROMPT_PATTERNS.some(p => p.test(line));
}

function isSuppressed(line) {
  return SUPPRESS_PATTERNS.some(p => p.test(line));
}

class GeminiCliParser {
  constructor(callbacks = {}) {
    // callbacks: { onChunk, onThinking, onToolStart, onToolDone, onDone, onError }
    this._cb = callbacks;
    this._buf = '';          // raw char buffer for incomplete lines
    this._thinking = false;  // currently inside a thinking block
    this._responseLines = [];
    this._thinkingLines = [];
    this._initPhase = true;  // suppress startup banner
    this._startTimeout = null;
    this._doneTimeout = null;
  }

  // Mark startup banner as over (call after first prompt is seen)
  _exitInitPhase() {
    this._initPhase = false;
  }

  _emit(event, ...args) {
    const fn = this._cb['on' + event[0].toUpperCase() + event.slice(1)];
    if (typeof fn === 'function') fn(...args);
  }

  _processLine(raw) {
    const line = stripAnsi(raw).trimEnd();

    // Prompt indicator → response complete
    if (isPrompt(line)) {
      if (this._initPhase) {
        this._exitInitPhase();
        this._emit('connected');
        return;
      }
      // End of response
      clearTimeout(this._doneTimeout);
      this._doneTimeout = null;
      const fullText = this._responseLines.join('\n').trim();
      const thinkingText = this._thinkingLines.join('\n').trim();
      this._responseLines = [];
      this._thinkingLines = [];
      this._thinking = false;
      this._emit('done', { text: fullText, thinking: thinkingText });
      return;
    }

    if (this._initPhase) return; // suppress startup chrome

    // Thinking block detection
    if (THINKING_START_PATTERNS.some(p => p.test(line))) {
      this._thinking = true;
      return;
    }
    if (THINKING_END_PATTERNS.some(p => p.test(line))) {
      this._thinking = false;
      if (this._thinkingLines.length > 0) {
        this._emit('thinking', this._thinkingLines.join('\n').trim());
      }
      return;
    }

    if (this._thinking) {
      this._thinkingLines.push(line);
      this._emit('thinkingChunk', line);
      return;
    }

    // Tool activity
    for (const { re, label } of TOOL_PATTERNS) {
      const m = line.match(re);
      if (m) {
        this._emit('toolStart', { label, detail: m[1] || '' });
        return;
      }
    }

    // Suppress UI chrome
    if (isSuppressed(line)) return;

    // Regular response text
    this._responseLines.push(line);
    this._emit('chunk', line + '\n');
  }

  // Feed raw stdout data chunk. Call this from process.stdout 'data' event.
  feed(raw) {
    this._buf += raw;
    const parts = this._buf.split('\n');
    // Last element may be an incomplete line — keep it in buffer
    this._buf = parts.pop();

    for (const part of parts) {
      this._processLine(part);
    }

    // Schedule a fallback "done" if no prompt appears within 3s of last chunk.
    // This handles CLIs that don't emit a visible prompt.
    clearTimeout(this._doneTimeout);
    if (!this._initPhase && this._responseLines.length > 0) {
      this._doneTimeout = setTimeout(() => {
        const fullText = this._responseLines.join('\n').trim();
        const thinkingText = this._thinkingLines.join('\n').trim();
        this._responseLines = [];
        this._thinkingLines = [];
        this._thinking = false;
        this._doneTimeout = null;
        this._emit('done', { text: fullText, thinking: thinkingText });
      }, 3000);
    }
  }

  // Flush any remaining buffered content (e.g. on process close).
  flush() {
    clearTimeout(this._doneTimeout);
    this._doneTimeout = null;
    if (this._buf) {
      this._processLine(this._buf);
      this._buf = '';
    }
    if (this._responseLines.length > 0) {
      const fullText = this._responseLines.join('\n').trim();
      const thinkingText = this._thinkingLines.join('\n').trim();
      this._responseLines = [];
      this._thinkingLines = [];
      this._emit('done', { text: fullText, thinking: thinkingText });
    }
  }

  reset() {
    clearTimeout(this._doneTimeout);
    this._buf = '';
    this._thinking = false;
    this._responseLines = [];
    this._thinkingLines = [];
    this._initPhase = true;
    this._doneTimeout = null;
  }
}

module.exports = { GeminiCliParser, stripAnsi };
