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
    this._currentTurnMinStep = 0;
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
    this._currentTurnMinStep = 0;
  }

  start() {
    if (this._pollInterval) return;

    const appDataDir = path.join(os.homedir(), '.gemini', 'antigravity-cli');
    const transcriptPath = path.join(appDataDir, 'brain', this._agyConvId, '.system_generated', 'logs', 'transcript.jsonl');

    let lastSize = 0;
    if (fs.existsSync(transcriptPath)) {
      try {
        const initialContent = fs.readFileSync(transcriptPath, 'utf8');
        const lines = initialContent.split('\n');
        let maxExisting = -1;
        for (const rawLine of lines) {
          const trimmed = rawLine.trim();
          if (!trimmed) continue;
          try {
            const data = JSON.parse(trimmed);
            if (data.step_index !== undefined) {
              this._processedSteps.add(data.step_index);
              if (data.step_index > maxExisting) maxExisting = data.step_index;
            }
          } catch (_) {}
        }
        this._currentTurnMinStep = Math.max(0, maxExisting + 1);
        lastSize = fs.statSync(transcriptPath).size;
      } catch (e) {
        console.warn('[GeminiCliParser] Initial transcript check warning:', e.message);
      }
    }

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
        this._emit('toolDone', { id: tool.id, label: tool.label, detail: tool.detail, name: tool.name, kind: tool.kind, filePath: tool.filePath });
        const isEditOperation = (tool.name === 'write_to_file' || tool.name === 'replace_file_content' || tool.name === 'multi_replace_file_content');
        if (tool.filePath && isEditOperation) {
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

        if (data.type === 'USER_INPUT' && stepIndex >= this._currentTurnMinStep) {
          this._currentTurnMinStep = stepIndex;
        }

        if (stepIndex < this._currentTurnMinStep) continue;
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

          let kind = 'tool';
          if (name === 'run_command') {
            label = 'Executando comando';
            kind = 'command';
            const cmd = cleanArgs.CommandLine || cleanArgs.command || '';
            detail = cmd.length > 60 ? cmd.slice(0, 57) + '…' : cmd;
          } else if (name === 'write_to_file') {
            label = 'Criando arquivo';
            kind = 'edit';
            const f = cleanArgs.TargetFile || cleanArgs.targetFile || cleanArgs.path || '';
            detail = shortPath(f);
            filePath = f;
          } else if (name === 'replace_file_content' || name === 'multi_replace_file_content') {
            label = 'Editando arquivo';
            kind = 'edit';
            const f = cleanArgs.TargetFile || cleanArgs.targetFile || cleanArgs.path || '';
            detail = shortPath(f);
            filePath = f;
          } else if (name === 'list_dir') {
            label = 'Listando diretório';
            kind = 'search';
            const d = cleanArgs.DirectoryPath || cleanArgs.dir || '';
            detail = shortPath(d);
          } else if (name === 'view_file') {
            label = 'Lendo arquivo';
            kind = 'read';
            const f = cleanArgs.AbsolutePath || cleanArgs.targetFile || cleanArgs.filePath || cleanArgs.path || '';
            detail = shortPath(f);
            filePath = f;
          } else if (name === 'grep_search') {
            label = 'Buscando no projeto';
            kind = 'search';
            const q = cleanArgs.Query || cleanArgs.query || cleanArgs.pattern || '';
            detail = q.length > 45 ? q.slice(0, 42) + '…' : q;
          } else if (name === 'find_by_name') {
            label = 'Localizando arquivos';
            kind = 'search';
            detail = cleanArgs.Pattern || cleanArgs.pattern || '';
          } else if (name === 'read_url_content' || name === 'search_web') {
            label = name === 'search_web' ? 'Pesquisando na web' : 'Lendo página web';
            kind = name === 'search_web' ? 'search' : 'read';
            const q = cleanArgs.query || cleanArgs.Url || cleanArgs.url || '';
            detail = q.length > 45 ? q.slice(0, 42) + '…' : q;
          } else {
            label = cleanArgs.toolSummary || cleanArgs.toolAction || name;
            detail = cleanArgs.toolAction || '';
            if (/read|view|inspect|lendo|lido/i.test(label) || /read|view/i.test(name)) kind = 'read';
            else if (/edit|write|creat|alter|modifi|escrev|cria|atual/i.test(label) || /write|edit|patch/i.test(name)) kind = 'edit';
            else if (/cmd|command|terminal|execut/i.test(label) || /cmd|command/i.test(name)) kind = 'command';
            else if (/search|find|grep|list|busc/i.test(label) || /search|find|grep/i.test(name)) kind = 'search';
          }

          const toolId = `agy-tool-${stepIndex}-${idx}`;
          const toolInfo = { id: toolId, label, detail, name, filePath, kind };

          activeToolsForStep.push(toolInfo);

          this._emit('toolStart', toolInfo);

          const estimatedTokens = stepIndex * 1500;
          this._emit('tokenUpdate', { thinking: estimatedTokens });

          const isEditOperation = (name === 'write_to_file' || name === 'replace_file_content' || name === 'multi_replace_file_content');
          if (filePath && isEditOperation) {
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
            this._emit('toolDone', { id: tool.id, label: tool.label, detail: tool.detail, name: tool.name, kind: tool.kind, filePath: tool.filePath });
            const isEditOperation = (tool.name === 'write_to_file' || tool.name === 'replace_file_content' || tool.name === 'multi_replace_file_content');
            if (tool.filePath && isEditOperation) {
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
