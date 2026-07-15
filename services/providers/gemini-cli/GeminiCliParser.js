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
const ANSI_RE = /[\u001b\u009b]\[[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g;

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
    // callbacks: { onChunk, onThinking, onToolStart, onToolDone, onDone, onError, onFileTool }
    this._cb = callbacks;
    this._buf = '';          // raw char buffer for incomplete lines
    this._stderrBuf = '';    // stderr buffer
    this._thinking = false;  // currently inside a thinking block
    this._responseLines = [];
    this._thinkingLines = [];
    this._initPhase = false;  // suppress startup banner (disabled for non-interactive print mode)
    this._lastStepNum = undefined;
    this._stepCount = 0;
    this._startTimeout = null;
    this._doneTimeout = null;
    this._pendingFileEdits = [];

    // Transcript polling state
    this._agyConvId = null;
    this._pollInterval = null;
    this._processedSteps = new Set();
    this._activeTools = new Map(); // step_index -> array of active tools
  }

  // Mark startup banner as over (call after first prompt is seen)
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

    // If it's a log line with Tool confirmation, process it!
    if (line.includes('Tool confirmation for conversation')) {
      this._processStderrLine(line);
      return;
    }

    // Prompt indicator → response complete
    if (isPrompt(line)) {
      if (this._initPhase) {
        this._exitInitPhase();
        this._emit('connected');
        return;
      }
      // End of response
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

    if (this._initPhase) return; // suppress startup chrome

    // Agentic loop step detection (e.g. "I will start by listing..." or "Vou listar...")
    const stepMatch = line.match(/^(?:I (?:will|need|am going to)|Vou|Eu vou|Preciso)\s+(.+)/i);
    if (stepMatch) {
      this._stepCount = (this._stepCount || 0) + 1;
      const stepNum = this._stepCount;
      const stepText = line;
      
      // If we had a previous step, close it
      this._closePendingStep();
      this._lastStepNum = stepNum;
      
      // Emit new tool start activity
      this._emit('toolStart', { id: `gcli-step-${stepNum}`, label: `Passo ${stepNum}`, detail: stepText });
      
      // Also emit thinking so it shows in the thinking spinner
      this._emit('thinking', stepText);
      
      // Estimate token count update: say 1500 tokens per step
      const estimatedTokens = stepNum * 1500;
      this._emit('tokenUpdate', { thinking: estimatedTokens });
      
      return;
    }

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
        
        // Check if it's a file write/edit tool
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

    // Check if the incomplete line in _buf is actually a prompt!
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

    // Schedule a fallback "done" if no prompt appears within 3s of last chunk.
    // This handles CLIs that don't emit a visible prompt.
    // Disabled: in non-interactive print mode, we rely exclusively on the process closing.
    // Otherwise, long-running tools / thinking blocks will trigger a premature "done".
    /*
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
    */
  }

  // Flush any remaining buffered content (e.g. on process close).
  flush() {
    this._stopTranscriptPolling();
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
    this._stopTranscriptPolling();
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

    this._agyConvId = null;
    this._processedSteps.clear();
    this._activeTools.clear();
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

  _startTranscriptPolling() {
    if (this._pollInterval) return;

    const os = require('os');
    const path = require('path');
    const fs = require('fs');

    const appDataDir = path.join(os.homedir(), '.gemini', 'antigravity-cli');
    const transcriptPath = path.join(appDataDir, 'brain', this._agyConvId, '.system_generated', 'logs', 'transcript.jsonl');

    // Pre-populate processed steps with existing ones from past turns
    try {
      if (fs.existsSync(transcriptPath)) {
        const content = fs.readFileSync(transcriptPath, 'utf8');
        const lines = content.split('\n');
        for (const rawLine of lines) {
          const trimmed = rawLine.trim();
          if (!trimmed) continue;
          try {
            const data = JSON.parse(trimmed);
            const stepIndex = data.step_index;
            if (stepIndex !== undefined) {
              this._processedSteps.add(stepIndex);
            }
          } catch (e) {
            // ignore partial/incomplete JSON lines
          }
        }
      }
    } catch (err) {
      console.error('[GeminiCliParser] Error pre-populating processed steps:', err.message);
    }

    let lastSize = 0;
    try {
      if (fs.existsSync(transcriptPath)) {
        const stats = fs.statSync(transcriptPath);
        lastSize = stats.size;
      }
    } catch (e) {}

    const poll = () => {
      try {
        if (!fs.existsSync(transcriptPath)) return;
        const stats = fs.statSync(transcriptPath);
        if (stats.size === lastSize) return;

        lastSize = stats.size;
        const content = fs.readFileSync(transcriptPath, 'utf8');
        this._parseTranscriptContent(content);
      } catch (e) {
        console.error('[GeminiCliParser] Error reading transcript:', e.message);
      }
    };

    poll();
    this._pollInterval = setInterval(poll, 400);
  }

  _stopTranscriptPolling() {
    if (this._pollInterval) {
      clearInterval(this._pollInterval);
      this._pollInterval = null;
    }

    if (this._agyConvId) {
      const os = require('os');
      const path = require('path');
      const fs = require('fs');
      const appDataDir = path.join(os.homedir(), '.gemini', 'antigravity-cli');
      const transcriptPath = path.join(appDataDir, 'brain', this._agyConvId, '.system_generated', 'logs', 'transcript.jsonl');
      try {
        if (fs.existsSync(transcriptPath)) {
          const content = fs.readFileSync(transcriptPath, 'utf8');
          this._parseTranscriptContent(content);
        }
      } catch (e) {
        console.error('[GeminiCliParser] Final transcript read error:', e.message);
      }
    }

    for (const [stepIdx, tools] of this._activeTools.entries()) {
      for (const tool of tools) {
        this._emit('toolDone', { id: tool.id, label: tool.label });
        if (tool.filePath) {
          this._emit('fileTool', { id: tool.id, name: 'Edit', filePath: tool.filePath, phase: 'after' });
        }
      }
    }
    this._activeTools.clear();
  }

  _parseTranscriptContent(content) {
    const lines = content.split('\n');
    for (const rawLine of lines) {
      const trimmed = rawLine.trim();
      if (!trimmed) continue;

      try {
        const data = JSON.parse(trimmed);
        const stepIndex = data.step_index;

        if (this._processedSteps.has(stepIndex)) continue;
        this._processedSteps.add(stepIndex);

        this._processTranscriptEntry(data);
      } catch (err) {
        // Line might be incomplete/partially written, skip and try again on next poll
      }
    }
  }

  _processTranscriptEntry(data) {
    const stepIndex = data.step_index;
    const type = data.type;

    if (type === 'PLANNER_RESPONSE') {
      const thinking = data.thinking;
      const toolCalls = data.tool_calls;

      if (thinking) {
        const cleanThinking = thinking.trim();
        if (cleanThinking) {
          this._emit('thinking', cleanThinking);
        }
      }

      if (toolCalls && toolCalls.length > 0) {
        const activeToolsForStep = [];

        toolCalls.forEach((tc, idx) => {
          const name = tc.name;
          const args = tc.args || {};

          const cleanArg = (val) => {
            if (typeof val === 'string') {
              if (val.startsWith('"') && val.endsWith('"')) {
                try {
                  return JSON.parse(val);
                } catch (_) {
                  return val.slice(1, -1);
                }
              }
            }
            return val;
          };

          const cleanArgs = {};
          for (const k in args) {
            cleanArgs[k] = cleanArg(args[k]);
          }

          let label = 'Executando ferramenta';
          let detail = '';
          let filePath = '';

          if (name === 'run_command') {
            label = 'Executando comando';
            detail = cleanArgs.CommandLine || '';
          } else if (name === 'write_to_file') {
            label = 'Criando arquivo';
            detail = cleanArgs.TargetFile || '';
            filePath = cleanArgs.TargetFile || '';
          } else if (name === 'replace_file_content' || name === 'multi_replace_file_content') {
            label = 'Editando arquivo';
            detail = cleanArgs.TargetFile || '';
            filePath = cleanArgs.TargetFile || '';
          } else if (name === 'list_dir') {
            label = 'Listando diretório';
            detail = cleanArgs.DirectoryPath || '';
          } else if (name === 'view_file') {
            label = 'Lendo arquivo';
            detail = cleanArgs.AbsolutePath || '';
          } else if (name === 'grep_search') {
            label = 'Buscando no projeto';
            detail = cleanArgs.Query || '';
          } else if (name === 'list_permissions') {
            label = 'Listando permissões';
            detail = '';
          } else {
            label = cleanArgs.toolSummary || cleanArgs.toolAction || name;
            detail = cleanArgs.toolAction || '';
          }

          const toolId = `agy-tool-${stepIndex}-${idx}`;
          const toolInfo = { id: toolId, label, detail, name, filePath };

          activeToolsForStep.push(toolInfo);

          this._emit('toolStart', toolInfo);

          const estimatedTokens = stepIndex * 1500;
          this._emit('tokenUpdate', { thinking: estimatedTokens });

          if (filePath) {
            this._emit('fileTool', { id: toolId, name: 'Edit', filePath, phase: 'before' });
          }
        });

        if (activeToolsForStep.length > 0) {
          this._activeTools.set(stepIndex, activeToolsForStep);
        }
      }
    } else if (type === 'RUN_COMMAND' || type === 'CODE_ACTION' || type === 'GENERIC') {
      let targetStepIndex = -1;
      for (const stepIdx of this._activeTools.keys()) {
        if (stepIdx < stepIndex && stepIdx > targetStepIndex) {
          targetStepIndex = stepIdx;
        }
      }

      if (targetStepIndex !== -1) {
        const tools = this._activeTools.get(targetStepIndex);
        if (tools) {
          for (const tool of tools) {
            this._emit('toolDone', { id: tool.id, label: tool.label });
            if (tool.filePath) {
              this._emit('fileTool', { id: tool.id, name: 'Edit', filePath: tool.filePath, phase: 'after' });
            }
          }
          this._activeTools.delete(targetStepIndex);
        }
      }
    }
  }

  _processStderrLine(line) {
    const convMatch = line.match(/(?:conversation[ =]|update stream for |Created conversation )([a-f0-9-]{36})/i);
    if (convMatch) {
      const agyConvId = convMatch[1];
      if (this._agyConvId !== agyConvId) {
        this._agyConvId = agyConvId;
        this._startTranscriptPolling();
      }
    }

    if (this._pollInterval) {
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
