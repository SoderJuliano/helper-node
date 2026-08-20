// renderer/appRunner/appRunnerController.js
// Controlador do Console de Execução (Run Tab), streaming de logs, ANSI, resizer e ciclo de vida do processo.

(function() {
  const ANSI_COLOR_MAP = {
    '0': 'font-weight:normal;color:#d1d5db;',
    '1': 'font-weight:bold;',
    '30': 'color:#1f2937;',
    '31': 'color:#f87171;',
    '32': 'color:#4ade80;',
    '33': 'color:#facc15;',
    '34': 'color:#60a5fa;',
    '35': 'color:#c084fc;',
    '36': 'color:#38bdf8;',
    '37': 'color:#f3f4f6;',
    '90': 'color:#9ca3af;',
    '91': 'color:#fca5a5;',
    '92': 'color:#86efac;',
    '93': 'color:#fde047;',
    '94': 'color:#93c5fd;',
    '95': 'color:#d8b4fe;',
    '96': 'color:#7dd3fc;',
    '97': 'color:#ffffff;',
  };

  function ansiToHtml(str) {
    if (!str) return '';
    let escaped = str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');

    // Converte stacktraces para links clicáveis: at com.example.MyClass.method(MyClass.java:42)
    escaped = escaped.replace(/(at\s+[a-zA-Z0-9_$.]+\()([a-zA-Z0-9_]+\.java):(\d+)(\))/g, (match, prefix, file, line, suffix) => {
      return `${prefix}<a href="#" class="app-runner-stack-link" data-file="${file}" data-line="${line}">${file}:${line}</a>${suffix}`;
    });

    // Converte códigos ANSI para spans coloridos
    escaped = escaped.replace(/\x1b\[([0-9;]+)m/g, (match, codes) => {
      const codeArr = codes.split(';');
      let styles = '';
      for (const c of codeArr) {
        if (ANSI_COLOR_MAP[c]) styles += ANSI_COLOR_MAP[c] + ' ';
      }
      return styles ? `<span style="${styles}">` : '</span>';
    });

    return escaped;
  }

  class AppRunnerController {
    constructor() {
      this.currentStatus = 'idle';
      this.lastTarget = null;
      this.lastProjectDir = null;
      this.autoScroll = true;
      this.testViewer = null;

      this._initElements();
      this._wireIpcEvents();
      this._wireUiEvents();
      this._wireResizer();
    }

    _initElements() {
      this.paneEl = document.getElementById('pane-app-runner');
      this.tabBtn = document.getElementById('tab-btn-app-runner');
      this.resizerEl = document.getElementById('app-runner-resizer');
      this.targetNameEl = document.getElementById('app-runner-target-name');
      this.statusBadgeEl = document.getElementById('app-runner-status-badge');
      this.portLinkEl = document.getElementById('app-runner-port-link');
      this.outputContainer = document.getElementById('app-runner-output');
      this.testsSidebarEl = document.getElementById('app-runner-tests-sidebar');
      this.testsListEl = document.getElementById('app-runner-tests-list');
      this.testsCountEl = document.getElementById('app-runner-tests-count');

      this.btnRerun = document.getElementById('app-runner-btn-rerun');
      this.btnStop = document.getElementById('app-runner-btn-stop');
      this.btnConfig = document.getElementById('app-runner-btn-config');
      this.btnClear = document.getElementById('app-runner-btn-clear');
      this.btnAutoScroll = document.getElementById('app-runner-btn-autoscroll');
      this.btnCopy = document.getElementById('app-runner-btn-copy');

      const savedH = localStorage.getItem('helper_app_runner_height');
      if (savedH && this.paneEl) {
        this.paneEl.style.height = savedH;
      }

      if (this.testsListEl && window.TestResultsViewer) {
        this.testViewer = new window.TestResultsViewer(this.testsListEl, this.testsCountEl);
      }
    }

    _wireResizer() {
      if (!this.resizerEl || !this.paneEl) return;

      let startY = 0;
      let startH = 0;

      const onMouseDown = (e) => {
        e.preventDefault();
        startY = e.clientY;
        startH = this.paneEl.offsetHeight;
        this.resizerEl.classList.add('resizing');
        document.body.style.cursor = 'ns-resize';
        document.body.style.userSelect = 'none';

        const onMouseMove = (me) => {
          const dy = startY - me.clientY;
          const newH = Math.max(140, Math.min(window.innerHeight - 150, startH + dy));
          this.paneEl.style.height = `${newH}px`;
        };

        const onMouseUp = () => {
          this.resizerEl.classList.remove('resizing');
          document.body.style.cursor = '';
          document.body.style.userSelect = '';
          window.removeEventListener('mousemove', onMouseMove);
          window.removeEventListener('mouseup', onMouseUp);
          localStorage.setItem('helper_app_runner_height', this.paneEl.style.height);
        };

        window.addEventListener('mousemove', onMouseMove);
        window.addEventListener('mouseup', onMouseUp);
      };

      this.resizerEl.addEventListener('mousedown', onMouseDown);
    }

    _wireIpcEvents() {
      if (!window.electronAPI) return;

      if (window.electronAPI.onAppRunnerStreamChunk) {
        window.electronAPI.onAppRunnerStreamChunk((chunk) => {
          this.appendOutput(chunk);
        });
      }

      if (window.electronAPI.onAppRunnerStatusChanged) {
        window.electronAPI.onAppRunnerStatusChanged((statusData) => {
          this.updateStatus(statusData.status, statusData.currentRun);
        });
      }

      if (window.electronAPI.onAppRunnerTestEvent) {
        window.electronAPI.onAppRunnerTestEvent((testData) => {
          if (this.testViewer) this.testViewer.addTestEvent(testData);
          if (this.testsSidebarEl) this.testsSidebarEl.style.display = 'flex';
        });
      }

      if (window.electronAPI.onAppRunnerAppEvent) {
        window.electronAPI.onAppRunnerAppEvent((appData) => {
          if (appData.type === 'server-started' && appData.port) {
            this.setPort(appData.port);
          }
        });
      }
    }

    _wireUiEvents() {
      if (this.btnRerun) {
        this.btnRerun.addEventListener('click', () => this.rerun());
      }
      if (this.btnStop) {
        this.btnStop.addEventListener('click', () => this.stop());
      }
      if (this.btnConfig) {
        this.btnConfig.addEventListener('click', () => {
          if (typeof window.openAppRunnerConfigModal === 'function') {
            window.openAppRunnerConfigModal(this.lastProjectDir);
          }
        });
      }
      if (this.btnClear) {
        this.btnClear.addEventListener('click', () => this.clear());
      }
      if (this.btnAutoScroll) {
        this.btnAutoScroll.addEventListener('click', () => {
          this.autoScroll = !this.autoScroll;
          this.btnAutoScroll.classList.toggle('active', this.autoScroll);
        });
      }
      if (this.btnCopy) {
        this.btnCopy.addEventListener('click', () => {
          if (this.outputContainer && window.electronAPI && window.electronAPI.copyToClipboard) {
            window.electronAPI.copyToClipboard(this.outputContainer.innerText);
            if (typeof window.showCopyToast === 'function') window.showCopyToast();
          }
        });
      }

      if (this.outputContainer) {
        this.outputContainer.addEventListener('click', (e) => {
          const link = e.target.closest('.app-runner-stack-link');
          if (link) {
            e.preventDefault();
            const filename = link.dataset.file;
            const line = parseInt(link.dataset.line, 10);
            if (filename && typeof window.openFileViewer === 'function') {
              window.openFileViewer(filename, line);
            }
          }
        });
      }
    }

    async run(projectDir, target = {}) {
      this.lastProjectDir = projectDir;
      this.lastTarget = target;
      this.clear();
      this.showPane();

      if (target.kind && target.kind.startsWith('test')) {
        if (this.testsSidebarEl) this.testsSidebarEl.style.display = 'flex';
      } else {
        if (this.testsSidebarEl) this.testsSidebarEl.style.display = 'none';
      }

      const displayName = target.displayName || target.mainClass || (target.testMethod ? `${target.testClass}.${target.testMethod}` : 'App');
      if (this.targetNameEl) {
        this.targetNameEl.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 3 19 12 5 21 5 3"/></svg><span>${displayName}</span>`;
      }

      this.updateStatus('starting');

      try {
        if (window.electronAPI && window.electronAPI.appRunnerRun) {
          const res = await window.electronAPI.appRunnerRun({ projectDir, target });
          if (!res.ok) {
            this.appendOutput(`\n\x1b[31mErro ao iniciar: ${res.error}\x1b[0m\n`);
            this.updateStatus('error');
          }
        }
      } catch (e) {
        this.appendOutput(`\n\x1b[31mFalha: ${e.message}\x1b[0m\n`);
        this.updateStatus('error');
      }
    }

    async rerun() {
      if (this.lastProjectDir && this.lastTarget) {
        if (this.currentStatus === 'running' || this.currentStatus === 'starting') {
          await this.stop();
          setTimeout(() => this.run(this.lastProjectDir, this.lastTarget), 600);
        } else {
          this.run(this.lastProjectDir, this.lastTarget);
        }
      }
    }

    async stop() {
      if (window.electronAPI && window.electronAPI.appRunnerStop) {
        await window.electronAPI.appRunnerStop();
      }
      this.updateStatus('stopped');
    }

    clear() {
      if (this.outputContainer) this.outputContainer.innerHTML = '';
      if (this.testViewer) this.testViewer.clear();
      if (this.portLinkEl) {
        this.portLinkEl.style.display = 'none';
        this.portLinkEl.href = '#';
      }
    }

    appendOutput(chunk) {
      if (!this.outputContainer || !chunk) return;
      const html = ansiToHtml(chunk);
      this.outputContainer.innerHTML += html;

      if (this.autoScroll) {
        this.outputContainer.scrollTop = this.outputContainer.scrollHeight;
      }
    }

    setPort(port) {
      if (!this.portLinkEl || !port) return;
      this.portLinkEl.style.display = 'inline-flex';
      this.portLinkEl.href = `http://localhost:${port}`;
      this.portLinkEl.innerHTML = `🌐 localhost:${port}`;
      this.portLinkEl.onclick = (e) => {
        e.preventDefault();
        if (window.electronAPI && window.electronAPI.workspaceOpenExternal) {
          window.electronAPI.workspaceOpenExternal(`http://localhost:${port}`);
        }
      };
    }

    updateStatus(status, runMeta) {
      this.currentStatus = status || 'idle';
      if (!this.statusBadgeEl) return;

      this.statusBadgeEl.className = `app-runner-status-badge status-${this.currentStatus}`;
      const labels = {
        idle: 'Pronto',
        starting: 'Iniciando…',
        running: 'Executando',
        completed: 'Concluído',
        stopped: 'Parado',
        error: 'Erro',
      };
      this.statusBadgeEl.textContent = labels[this.currentStatus] || this.currentStatus;

      if (this.btnStop) {
        this.btnStop.style.display = (this.currentStatus === 'running' || this.currentStatus === 'starting') ? 'inline-flex' : 'none';
      }
      if (this.btnRerun) {
        this.btnRerun.style.display = (this.currentStatus === 'running' || this.currentStatus === 'starting') ? 'none' : 'inline-flex';
      }
    }

    showPane() {
      const composer = document.getElementById('composer');
      if (composer && composer.classList.contains('collapsed')) {
        composer.classList.remove('collapsed');
      }

      if (typeof window.activateComposerTab === 'function') {
        window.activateComposerTab('app-runner');
      } else if (this.paneEl) {
        document.querySelectorAll('.composer-view-pane').forEach(p => p.style.display = 'none');
        this.paneEl.style.display = 'flex';
      }
    }
  }

  window.AppRunnerController = AppRunnerController;
  window.appRunner = null;

  document.addEventListener('DOMContentLoaded', () => {
    window.appRunner = new AppRunnerController();
  });
})();
