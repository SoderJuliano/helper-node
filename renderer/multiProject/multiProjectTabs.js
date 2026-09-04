// renderer/multiProject/multiProjectTabs.js
// Controlador de abas de execução concorrente no App Runner (Multi-Project Runner Tabs).

(function() {
  class MultiProjectTabs {
    constructor(controller) {
      this.controller = controller;
      /** @type {Map<string, Object>} */
      this.tabs = new Map();
      this.activeTabId = null;
      this.stripEl = null;

      this._initDom();
    }

    _initDom() {
      const pane = document.getElementById('pane-app-runner');
      if (!pane) return;

      let strip = document.getElementById('app-runner-tabs-strip');
      if (!strip) {
        strip = document.createElement('div');
        strip.id = 'app-runner-tabs-strip';
        strip.className = 'app-runner-tabs-strip';
        strip.style.cssText = 'display:none; align-items:center; background:#121217; border-bottom:1px solid var(--border-subtle, #2d2d38); padding:0 8px; height:32px; gap:4px; overflow-x:auto; flex-shrink:0; user-select:none;';
        
        // Insere logo abaixo do resizer superior
        const resizer = document.getElementById('app-runner-resizer');
        if (resizer && resizer.nextSibling) {
          pane.insertBefore(strip, resizer.nextSibling);
        } else {
          pane.prepend(strip);
        }
      }
      this.stripEl = strip;
    }

    getOrCreateTab(runId, meta = {}) {
      if (!this.tabs.has(runId)) {
        const projectDir = meta.projectDir || '';
        const projName = projectDir ? projectDir.split(/[/\\]/).filter(Boolean).pop() : 'App';
        const target = meta.target || {};
        const targetName = target.displayName || target.mainClass || (target.testMethod ? `${target.testClass}.${target.testMethod}` : 'App');
        const displayName = `[${projName}] ${targetName}`;

        const tabData = {
          runId,
          projectDir,
          target,
          displayName,
          projName,
          targetName,
          status: 'starting',
          port: null,
          outputBuffer: '',
          testEvents: [],
          testSummary: null,
          autoScroll: true,
          startedAt: Date.now(),
        };

        this.tabs.set(runId, tabData);
        this._renderStrip();
      }

      return this.tabs.get(runId);
    }

    activateTab(runId) {
      if (!this.tabs.has(runId)) return;
      this.activeTabId = runId;
      const tab = this.tabs.get(runId);

      this.controller.lastProjectDir = tab.projectDir;
      this.controller.lastTarget = tab.target;

      // Restaura saída do log
      if (this.controller.outputContainer) {
        this.controller.outputContainer.innerHTML = '';
        if (typeof this.controller.appendOutput === 'function') {
          this.controller.appendOutput(tab.outputBuffer);
        }
      }

      // Restaura porta
      if (tab.port) {
        this.controller.setPort(tab.port);
      } else if (this.controller.portLinkEl) {
        this.controller.portLinkEl.style.display = 'none';
        this.controller.portLinkEl.href = '#';
      }

      // Restaura status
      this.controller.updateStatus(tab.status, { displayName: tab.displayName });

      // Restaura nome do alvo
      if (this.controller.targetNameEl) {
        this.controller.targetNameEl.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 3 19 12 5 21 5 3"/></svg><span>${tab.displayName}</span>`;
      }

      // Restaura testes se houver
      if (this.controller.testViewer) {
        this.controller.testViewer.clear();
        if (tab.testEvents && tab.testEvents.length > 0) {
          for (const ev of tab.testEvents) {
            this.controller.testViewer.addTestEvent(ev);
          }
          if (this.controller.testsSidebarEl) this.controller.testsSidebarEl.style.display = 'flex';
          if (this.controller.splitResizerEl) this.controller.splitResizerEl.style.display = 'block';
        } else {
          if (this.controller.testsSidebarEl) this.controller.testsSidebarEl.style.display = 'none';
          if (this.controller.splitResizerEl) this.controller.splitResizerEl.style.display = 'none';
        }

        if (tab.testSummary) {
          this.controller.testViewer.setSummary(tab.testSummary);
        }
      }

      this._renderStrip();
    }

    appendChunk(runId, chunk) {
      const tab = this.getOrCreateTab(runId);
      tab.outputBuffer += chunk;

      if (this.activeTabId === runId || this.tabs.size === 1) {
        if (this.activeTabId !== runId) {
          this.activateTab(runId);
        } else {
          this.controller.appendOutput(chunk);
        }
      }
    }

    updateStatus(runId, statusData) {
      const tab = this.getOrCreateTab(runId);
      tab.status = statusData.status || tab.status;

      if (this.activeTabId === runId) {
        this.controller.updateStatus(tab.status, statusData.currentRun);
      }

      this._renderStrip();
    }

    setPort(runId, port) {
      const tab = this.getOrCreateTab(runId);
      tab.port = port;

      if (this.activeTabId === runId) {
        this.controller.setPort(port);
      }

      this._renderStrip();
    }

    addTestEvent(runId, testData) {
      const tab = this.getOrCreateTab(runId);
      tab.testEvents.push(testData);

      if (this.activeTabId === runId && this.controller.testViewer) {
        this.controller.testViewer.addTestEvent(testData);
        if (this.controller.testsSidebarEl) this.controller.testsSidebarEl.style.display = 'flex';
        if (this.controller.splitResizerEl) this.controller.splitResizerEl.style.display = 'block';
      }
    }

    setTestSummary(runId, summaryData) {
      const tab = this.getOrCreateTab(runId);
      tab.testSummary = summaryData;

      if (this.activeTabId === runId && this.controller.testViewer) {
        this.controller.testViewer.setSummary(summaryData);
      }
    }

    async closeTab(runId, ev) {
      if (ev) ev.stopPropagation();
      const tab = this.tabs.get(runId);
      if (!tab) return;

      if (window.electronAPI && window.electronAPI.appRunnerStop) {
        await window.electronAPI.appRunnerStop(runId);
      }

      this.tabs.delete(runId);

      if (this.activeTabId === runId) {
        const remainingKeys = Array.from(this.tabs.keys());
        if (remainingKeys.length > 0) {
          this.activateTab(remainingKeys[remainingKeys.length - 1]);
        } else {
          this.activeTabId = null;
          this.controller.clear();
          this.controller.updateStatus('idle');
          if (this.controller.targetNameEl) {
            this.controller.targetNameEl.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 3 19 12 5 21 5 3"/></svg><span>Pronto</span>`;
          }
        }
      }

      this._renderStrip();
    }

    _renderStrip() {
      if (!this.stripEl) this._initDom();
      if (!this.stripEl) return;

      const count = this.tabs.size;
      if (count <= 1) {
        this.stripEl.style.display = 'none';
        return;
      }

      this.stripEl.style.display = 'flex';
      this.stripEl.innerHTML = '';

      for (const [runId, tab] of this.tabs.entries()) {
        const isActive = this.activeTabId === runId;
        const tabEl = document.createElement('div');
        tabEl.className = 'app-runner-tab' + (isActive ? ' active' : '');
        tabEl.style.cssText = `
          display: inline-flex;
          align-items: center;
          gap: 6px;
          padding: 3px 8px;
          height: 24px;
          border-radius: 4px;
          cursor: pointer;
          font-size: 11px;
          font-family: var(--font-mono, monospace);
          color: ${isActive ? 'var(--text-bright, #fff)' : 'var(--text-muted, #9ca3af)'};
          background: ${isActive ? 'var(--bg-elevated, #242430)' : 'transparent'};
          border: 1px solid ${isActive ? 'var(--border-strong, #3f3f50)' : 'transparent'};
          transition: all .15s ease;
        `;

        // Status indicator dot
        const dot = document.createElement('span');
        const isRunning = tab.status === 'running';
        const isStarting = tab.status === 'starting';
        const isError = tab.status === 'error';
        const dotColor = isRunning ? '#4ade80' : isStarting ? '#facc15' : isError ? '#f87171' : '#6b7280';
        dot.style.cssText = `width: 7px; height: 7px; border-radius: 50%; background: ${dotColor}; display: inline-block; flex-shrink: 0;`;
        if (isRunning || isStarting) {
          dot.style.boxShadow = `0 0 6px ${dotColor}`;
        }
        tabEl.appendChild(dot);

        // Label
        const label = document.createElement('span');
        label.style.cssText = 'white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 160px;';
        label.textContent = tab.displayName;
        tabEl.appendChild(label);

        // Port badge
        if (tab.port) {
          const portBadge = document.createElement('span');
          portBadge.style.cssText = 'background: rgba(56, 189, 248, 0.15); color: #38bdf8; padding: 1px 4px; border-radius: 3px; font-size: 10px;';
          portBadge.textContent = `:${tab.port}`;
          tabEl.appendChild(portBadge);
        }

        // Close button
        const closeBtn = document.createElement('button');
        closeBtn.innerHTML = '×';
        closeBtn.title = 'Encerrar e fechar aba';
        closeBtn.style.cssText = 'background: transparent; border: none; color: inherit; font-size: 13px; line-height: 1; cursor: pointer; padding: 0 2px; margin-left: 2px; opacity: 0.7; border-radius: 2px;';
        closeBtn.addEventListener('mouseenter', () => { closeBtn.style.opacity = '1'; closeBtn.style.color = '#f87171'; });
        closeBtn.addEventListener('mouseleave', () => { closeBtn.style.opacity = '0.7'; closeBtn.style.color = 'inherit'; });
        closeBtn.addEventListener('click', (ev) => this.closeTab(runId, ev));
        tabEl.appendChild(closeBtn);

        tabEl.addEventListener('click', () => this.activateTab(runId));
        tabEl.addEventListener('auxclick', (ev) => {
          if (ev.button === 1) {
            ev.preventDefault();
            this.closeTab(runId, ev);
          }
        });
        this.stripEl.appendChild(tabEl);
      }
    }
  }

  window.MultiProjectTabs = MultiProjectTabs;
})();
