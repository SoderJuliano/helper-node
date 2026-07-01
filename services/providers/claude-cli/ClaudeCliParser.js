// Parses the newline-delimited JSON stream from:
//   claude --print --output-format stream-json --include-partial-messages
//
// Each line is a complete JSON object. Events are emitted via callbacks.
//
// Event types from the CLI:
//   system / init        → session connected, capture session_id
//   assistant (partial)  → streaming text chunk
//   assistant (thinking) → thinking block
//   assistant (tool_use) → tool call started
//   user (tool_result)   → tool call finished
//   result / success     → response done
//   result / error       → error

// Human-readable labels for Claude's built-in tools
const TOOL_LABELS = {
  Bash:          'Executando comando',
  Read:          'Lendo arquivo',
  Edit:          'Editando arquivo',
  Write:         'Escrevendo arquivo',
  MultiEdit:     'Editando múltiplos arquivos',
  Glob:          'Buscando arquivos',
  Grep:          'Buscando conteúdo',
  LS:            'Listando diretório',
  WebFetch:      'Buscando URL',
  WebSearch:     'Pesquisando na web',
  TodoWrite:     'Atualizando tarefas',
  TodoRead:      'Lendo tarefas',
  NotebookRead:  'Lendo notebook',
  NotebookEdit:  'Editando notebook',
  Task:          'Iniciando agente',
  Thinking:      'Pensando',
};

// Tools that touch files — used for diff emission
const FILE_TOOLS = new Set(['Edit', 'Write', 'MultiEdit']);

function labelForTool(name, input) {
  const base = TOOL_LABELS[name] || name;
  if (!input) return base;
  const target =
    input.file_path || input.path || input.command ||
    input.pattern || input.query || input.url || '';
  if (!target) return base;
  const short = String(target).length > 60 ? String(target).slice(0, 57) + '…' : String(target);
  return `${base}: ${short}`;
}

class ClaudeCliParser {
  // callbacks: { onSessionId, onChunk, onThinking, onToolStart, onToolDone, onFileTool, onDone, onError }
  constructor(callbacks = {}) {
    this._cb      = callbacks;
    this._buf     = '';        // incomplete JSON line buffer
    this._text    = '';        // accumulated full response text
    this._toolMap = new Map(); // tool_use_id → { name, input, label }
  }

  // Feed a raw stdout chunk (may contain multiple partial / complete lines).
  feed(raw) {
    this._buf += raw;
    const lines = this._buf.split('\n');
    this._buf = lines.pop(); // last might be incomplete
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        this._handleEvent(JSON.parse(trimmed));
      } catch (_) {
        // Not JSON (e.g. debug output). Ignore.
      }
    }
  }

  // Flush remaining buffer on process close.
  flush() {
    if (this._buf.trim()) {
      try { this._handleEvent(JSON.parse(this._buf.trim())); } catch (_) {}
      this._buf = '';
    }
  }

  _emit(name, ...args) {
    const fn = this._cb[name];
    if (typeof fn === 'function') fn(...args);
  }

  _handleEvent(ev) {
    if (!ev || !ev.type) return;

    switch (ev.type) {

      case 'system':
        if (ev.subtype === 'init' && ev.session_id) {
          this._emit('onSessionId', ev.session_id);
          this._emit('onConnected', { model: ev.model });
        }
        break;

      // Deltas em tempo real (--include-partial-messages): thinking e texto
      // chegam aqui conforme o modelo gera, não só no fim do bloco.
      case 'stream_event': {
        const se = ev.event || {};
        if (se.type === 'content_block_delta' && se.delta) {
          if (se.delta.type === 'thinking_delta' && se.delta.thinking) {
            this._sawThinkingDelta = true;
            this._emit('onThinking', se.delta.thinking);
          } else if (se.delta.type === 'text_delta' && se.delta.text) {
            this._sawTextDelta = true;
            this._text += se.delta.text;
            this._emit('onChunk', se.delta.text);
          }
        }
        break;
      }

      case 'assistant': {
        const msg = ev.message || {};
        const content = Array.isArray(msg.content) ? msg.content : [];
        for (const block of content) {
          if (!block || !block.type) continue;

          if (block.type === 'thinking') {
            // Já foi emitido via thinking_delta em tempo real — não duplica
            if (this._sawThinkingDelta) continue;
            const text = block.thinking || block.text || '';
            if (text) this._emit('onThinking', text);
            continue;
          }

          if (block.type === 'text') {
            // Já foi emitido via text_delta em tempo real — não duplica
            if (this._sawTextDelta) continue;
            const chunk = block.text || '';
            if (chunk) {
              this._text += chunk;
              this._emit('onChunk', chunk);
            }
            continue;
          }

          if (block.type === 'tool_use') {
            const { id, name, input } = block;
            const label = labelForTool(name, input);
            this._toolMap.set(id, { name, input, label });
            this._emit('onToolStart', { id, name, input, label });
            // If this tool edits a file, notify so we can take a backup.
            if (FILE_TOOLS.has(name)) {
              const filePath = (input && (input.file_path || input.path)) || null;
              if (filePath) this._emit('onFileTool', { id, name, filePath, phase: 'before' });
            }
          }
        }
        break;
      }

      case 'user': {
        const msg = ev.message || {};
        const content = Array.isArray(msg.content) ? msg.content : [];
        for (const block of content) {
          if (!block || block.type !== 'tool_result') continue;
          const { tool_use_id, content: result, is_error } = block;
          const tool = this._toolMap.get(tool_use_id) || {};
          this._emit('onToolDone', { id: tool_use_id, name: tool.name, label: tool.label, result, isError: !!is_error });
          // Signal that file edit is done (renderer can now show diff).
          if (FILE_TOOLS.has(tool.name)) {
            const filePath = (tool.input && (tool.input.file_path || tool.input.path)) || null;
            if (filePath) this._emit('onFileTool', { id: tool_use_id, name: tool.name, filePath, phase: 'after' });
          }
        }
        break;
      }

      case 'result':
        if (ev.subtype === 'success') {
          if (ev.session_id) this._emit('onSessionId', ev.session_id);
          this._emit('onDone', { text: this._text, cost: ev.cost_usd || 0, sessionId: ev.session_id });
          this._text = '';
          this._sawTextDelta = false;
          this._sawThinkingDelta = false;
          this._toolMap.clear();
        } else if (ev.subtype === 'error' || ev.is_error) {
          const msg = (ev.error && ev.error.message) || ev.error || 'Erro no Claude CLI';
          this._emit('onError', new Error(String(msg)));
        }
        break;
    }
  }

  reset() {
    this._buf  = '';
    this._text = '';
    this._sawTextDelta = false;
    this._sawThinkingDelta = false;
    this._toolMap.clear();
  }
}

module.exports = { ClaudeCliParser, FILE_TOOLS, labelForTool };
