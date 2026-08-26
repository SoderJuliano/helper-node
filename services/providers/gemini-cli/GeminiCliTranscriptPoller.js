// services/providers/gemini-cli/GeminiCliTranscriptPoller.js
const os = require('os');
const path = require('path');
const fs = require('fs');

class GeminiCliTranscriptPoller {
  constructor(emitFn) {
    this._emit = emitFn;
    this._agyConvId = null;
    this._pollInterval = null;
    this._processedSteps = new Set();
    this._activeTools = new Map();
  }

  get agyConvId() {
    return this._agyConvId;
  }

  set agyConvId(id) {
    this._agyConvId = id;
  }

  get hasPoller() {
    return !!this._pollInterval;
  }

  reset() {
    this.stop();
    this._agyConvId = null;
    this._processedSteps.clear();
    this._activeTools.clear();
  }

  start() {
    if (this._pollInterval) return;

    const appDataDir = path.join(os.homedir(), '.gemini', 'antigravity-cli');
    const transcriptPath = path.join(appDataDir, 'brain', this._agyConvId, '.system_generated', 'logs', 'transcript.jsonl');

    let lastSize = 0;
    const poll = () => {
      try {
        if (!fs.existsSync(transcriptPath)) return;
        const stats = fs.statSync(transcriptPath);
        if (stats.size === lastSize && lastSize > 0) return;

        lastSize = stats.size;
        const content = fs.readFileSync(transcriptPath, 'utf8');
        this.parseTranscriptContent(content);
      } catch (e) {
        console.error('[GeminiCliParser] Error reading transcript:', e.message);
      }
    };

    poll();
    this._pollInterval = setInterval(poll, 300);
  }

  stop() {
    if (this._pollInterval) {
      clearInterval(this._pollInterval);
      this._pollInterval = null;
    }

    if (this._agyConvId) {
      const appDataDir = path.join(os.homedir(), '.gemini', 'antigravity-cli');
      const transcriptPath = path.join(appDataDir, 'brain', this._agyConvId, '.system_generated', 'logs', 'transcript.jsonl');
      try {
        if (fs.existsSync(transcriptPath)) {
          const content = fs.readFileSync(transcriptPath, 'utf8');
          this.parseTranscriptContent(content);
        }
      } catch (e) {
        console.error('[GeminiCliParser] Final transcript read error:', e.message);
      }
    }

    for (const [, tools] of this._activeTools.entries()) {
      for (const tool of tools) {
        this._emit('toolDone', { id: tool.id, label: tool.label, detail: tool.detail });
        if (tool.filePath) {
          this._emit('fileTool', { id: tool.id, name: 'Edit', filePath: tool.filePath, phase: 'after' });
        }
      }
    }
    this._activeTools.clear();
  }

  parseTranscriptContent(content) {
    const lines = content.split('\n');
    for (const rawLine of lines) {
      const trimmed = rawLine.trim();
      if (!trimmed) continue;

      try {
        const data = JSON.parse(trimmed);
        const stepIndex = data.step_index;

        if (this._processedSteps.has(stepIndex)) continue;
        this._processedSteps.add(stepIndex);

        this.processTranscriptEntry(data);
      } catch (err) {}
    }
  }

  processTranscriptEntry(data) {
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
              val = val.trim();
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

          const shortPath = (p) => {
            if (!p) return '';
            const normalized = String(p).replace(/\\/g, '/');
            const parts = normalized.split('/').filter(Boolean);
            if (parts.length === 0) return '';
            if (parts.length <= 2) return parts.join('/');
            return parts.slice(-2).join('/');
          };

          if (name === 'run_command') {
            label = 'Executando comando';
            const cmd = cleanArgs.CommandLine || cleanArgs.command || '';
            detail = cmd.length > 60 ? cmd.slice(0, 57) + '…' : cmd;
          } else if (name === 'write_to_file') {
            const f = cleanArgs.TargetFile || cleanArgs.targetFile || cleanArgs.path || '';
            label = 'Criando arquivo';
            detail = shortPath(f);
            filePath = f;
          } else if (name === 'replace_file_content' || name === 'multi_replace_file_content') {
            const f = cleanArgs.TargetFile || cleanArgs.targetFile || cleanArgs.path || '';
            label = 'Editando arquivo';
            detail = shortPath(f);
            filePath = f;
          } else if (name === 'list_dir') {
            const d = cleanArgs.DirectoryPath || cleanArgs.dir || '';
            label = 'Listando diretório';
            detail = shortPath(d);
          } else if (name === 'view_file') {
            const f = cleanArgs.AbsolutePath || cleanArgs.targetFile || cleanArgs.filePath || cleanArgs.path || '';
            label = 'Lendo arquivo';
            detail = shortPath(f);
            filePath = f;
          } else if (name === 'grep_search') {
            label = 'Buscando no projeto';
            const q = cleanArgs.Query || cleanArgs.query || cleanArgs.pattern || '';
            detail = q.length > 45 ? q.slice(0, 42) + '…' : q;
          } else if (name === 'find_by_name') {
            label = 'Localizando arquivos';
            detail = cleanArgs.Pattern || cleanArgs.pattern || '';
          } else if (name === 'read_url_content' || name === 'search_web') {
            label = name === 'search_web' ? 'Pesquisando na web' : 'Lendo página web';
            const q = cleanArgs.query || cleanArgs.Url || cleanArgs.url || '';
            detail = q.length > 45 ? q.slice(0, 42) + '…' : q;
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
    } else if (type === 'RUN_COMMAND' || type === 'CODE_ACTION' || type === 'GENERIC' || type === 'VIEW_FILE' || type === 'USER_INPUT') {
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
            this._emit('toolDone', { id: tool.id, label: tool.label, detail: tool.detail });
            if (tool.filePath) {
              this._emit('fileTool', { id: tool.id, name: 'Edit', filePath: tool.filePath, phase: 'after' });
            }
          }
          this._activeTools.delete(targetStepIndex);
        }
      }
    }
  }
}

module.exports = {
  GeminiCliTranscriptPoller,
};
