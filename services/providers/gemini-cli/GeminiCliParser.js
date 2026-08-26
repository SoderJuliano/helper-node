// services/providers/gemini-cli/GeminiCliParser.js
// Parses raw stdout chunks from an interactive `gemini` CLI process.

const {
  stripAnsi,
  isPrompt,
  isSuppressed,
  THINKING_START_PATTERNS,
  THINKING_END_PATTERNS,
  TOOL_PATTERNS,
} = require('./GeminiCliPatterns');
const { GeminiCliTranscriptPoller } = require('./GeminiCliTranscriptPoller');

class GeminiCliParser {
  constructor(callbacks = {}) {
    this._cb = callbacks;
    this._buf = '';
    this._stderrBuf = '';
    this._thinking = false;
    this._responseLines = [];
    this._thinkingLines = [];
    this._initPhase = false;
    this._lastStepNum = undefined;
    this._stepCount = 0;
    this._doneTimeout = null;
    this._pendingFileEdits = [];

    this._poller = new GeminiCliTranscriptPoller((event, ...args) => this._emit(event, ...args));
  }

  _exitInitPhase() {
    this._initPhase = false;
  }

  _emit(event, ...args) {
    const fn = this._cb['on' + event[0].toUpperCase() + event.slice(1)];
    if (typeof fn === 'function') fn(...args);
  }

  _closePendingStep() {
    if (this._lastStepNum !== undefined) {
      this._emit('toolDone', { id: `gcli-step-${this._lastStepNum}`, label: `Passo ${this._lastStepNum}` });
      this._lastStepNum = undefined;
    }
    if (this._pendingFileEdits && this._pendingFileEdits.length > 0) {
      for (const edit of this._pendingFileEdits) {
        this._emit('fileTool', { id: edit.id, name: 'Edit', filePath: edit.filePath, phase: 'after' });
      }
      this._pendingFileEdits = [];
    }
  }

  _processLine(raw) {
    const line = stripAnsi(raw).trimEnd();

    if (line.includes('Tool confirmation for conversation')) {
      this._processStderrLine(line);
      return;
    }

    if (isPrompt(line)) {
      if (this._initPhase) {
        this._exitInitPhase();
        this._emit('connected');
        return;
      }
      this._closePendingStep();
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

    if (this._initPhase) return;

    const stepMatch = line.match(/^(?:I (?:will|need|am going to)|Vou|Eu vou|Preciso)\s+(.+)/i);
    if (stepMatch) {
      this._stepCount = (this._stepCount || 0) + 1;
      const stepNum = this._stepCount;
      const stepText = line;

      this._closePendingStep();
      this._lastStepNum = stepNum;

      this._emit('toolStart', { id: `gcli-step-${stepNum}`, label: `Passo ${stepNum}`, detail: stepText });
      this._emit('thinking', stepText);

      const estimatedTokens = stepNum * 1500;
      this._emit('tokenUpdate', { thinking: estimatedTokens });
      return;
    }

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

    for (const { re, label } of TOOL_PATTERNS) {
      const m = line.match(re);
      if (m) {
        this._emit('toolStart', { label, detail: m[1] || '' });

        const isEdit = /edit|writing|updating|modifying|creating|new file/i.test(label) ||
                       /edit|writing|updating|modifying|creating|new file/i.test(line);
        if (isEdit && m[1]) {
          const filePath = m[1].trim();
          const toolId = `gcli-edit-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`;
          this._emit('fileTool', { id: toolId, name: 'Edit', filePath, phase: 'before' });
          if (!this._pendingFileEdits) this._pendingFileEdits = [];
          this._pendingFileEdits.push({ id: toolId, filePath });
        }
        return;
      }
    }

    if (isSuppressed(line)) return;

    this._responseLines.push(line);
    this._emit('chunk', line + '\n');
  }

  feed(raw) {
    this._buf += raw;
    const parts = this._buf.split('\n');
    this._buf = parts.pop();

    if (this._buf) {
      const line = stripAnsi(this._buf).trimEnd();
      if (isPrompt(line)) {
        this._buf = '';
        this._processLine(line);
      }
    }

    for (const part of parts) {
      this._processLine(part);
    }
  }

  flush() {
    this._poller.stop();
    this._closePendingStep();
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
    this._poller.reset();
    clearTimeout(this._doneTimeout);
    this._buf = '';
    this._stderrBuf = '';
    this._thinking = false;
    this._responseLines = [];
    this._thinkingLines = [];
    this._initPhase = false;
    this._lastStepNum = undefined;
    this._stepCount = 0;
    this._doneTimeout = null;
    this._pendingFileEdits = [];
  }

  feedStderr(chunk) {
    this._stderrBuf = (this._stderrBuf || '') + chunk;
    let idx;
    while ((idx = this._stderrBuf.indexOf('\n')) !== -1) {
      const line = this._stderrBuf.slice(0, idx);
      this._stderrBuf = this._stderrBuf.slice(idx + 1);
      this._processStderrLine(line);
    }
  }

  _processStderrLine(line) {
    const convMatch = line.match(/(?:conversation[ =]|update stream for |Created conversation )([a-f0-9-]{36})/i);
    if (convMatch) {
      const agyConvId = convMatch[1];
      if (this._poller.agyConvId !== agyConvId) {
        this._poller.agyConvId = agyConvId;
        this._poller.start();
      }
    }

    if (this._poller.hasPoller) {
      return;
    }

    const match = line.match(/Tool confirmation for conversation \S+ step (\d+) \(type=\*gemini_coder_go_proto\.Step_(\w+) approved=(true|false)\)/);
    if (match) {
      const stepNum = parseInt(match[1], 10);
      const stepType = match[2];

      const STEP_LABELS = {
        RunCommand: 'Executando comando',
        CodeAction: 'Editando código',
        ViewFile: 'Lendo arquivo',
        GrepSearch: 'Buscando no projeto',
        ListDir: 'Listando diretório',
        default: 'Processando'
      };

      const label = STEP_LABELS[stepType] || STEP_LABELS.default;

      if (this._lastStepNum !== undefined && this._lastStepNum !== stepNum) {
        this._closePendingStep();
      }
      this._lastStepNum = stepNum;
      this._stepCount = stepNum;

      this._emit('toolStart', { id: `gcli-step-${stepNum}`, label, detail: `Passo ${stepNum}: ${label}` });
      this._emit('thinking', `${label} (Passo ${stepNum})`);

      const estimatedTokens = stepNum * 1500;
      this._emit('tokenUpdate', { thinking: estimatedTokens });
    }
  }
}

module.exports = { GeminiCliParser, stripAnsi };
