// renderer/appRunner/testResultsViewer.js
// Gerenciador e renderizador visual de resultados de testes JUnit.

(function() {
  const ICON_PASS = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';
  const ICON_FAIL = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
  const ICON_SKIP = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>';

  class TestResultsViewer {
    constructor(containerEl, countEl) {
      this.containerEl = containerEl;
      this.countEl = countEl;
      this.tests = new Map(); // key -> { className, methodName, status, duration }
      this.counts = { passed: 0, failed: 0, skipped: 0 };
    }

    clear() {
      this.tests.clear();
      this.counts = { passed: 0, failed: 0, skipped: 0 };
      if (this.containerEl) this.containerEl.innerHTML = '';
      this._updateSummary();
    }

    addTestEvent(event) {
      if (!event || !event.methodName) return;
      const key = `${event.className}.${event.methodName}`;
      const status = (event.status || 'passed').toLowerCase();

      const prev = this.tests.get(key);
      if (!prev) {
        if (status === 'passed') this.counts.passed++;
        else if (status === 'failed') this.counts.failed++;
        else if (status === 'skipped') this.counts.skipped++;
      } else if (prev.status !== status) {
        if (prev.status === 'passed') this.counts.passed--;
        else if (prev.status === 'failed') this.counts.failed--;
        else if (prev.status === 'skipped') this.counts.skipped--;

        if (status === 'passed') this.counts.passed++;
        else if (status === 'failed') this.counts.failed++;
        else if (status === 'skipped') this.counts.skipped++;
      }

      this.tests.set(key, { ...event, status });
      this._renderList();
      this._updateSummary();
    }

    setSummary(summary) {
      if (!summary) return;
      this.counts.failed = summary.failures || 0;
      this.counts.skipped = summary.skipped || 0;
      this.counts.passed = Math.max(0, (summary.total || 0) - this.counts.failed - this.counts.skipped);
      this._updateSummary();
    }

    _updateSummary() {
      if (!this.countEl) return;
      const total = this.counts.passed + this.counts.failed + this.counts.skipped;
      if (total === 0) {
        this.countEl.textContent = '0 testes';
        return;
      }
      this.countEl.innerHTML = `<span style="color:#4ade80;">${this.counts.passed}✓</span> ` +
                               (this.counts.failed > 0 ? `<span style="color:#f87171;">${this.counts.failed}✗</span> ` : '') +
                               (this.counts.skipped > 0 ? `<span style="color:#94a3b8;">${this.counts.skipped}↷</span> ` : '');
    }

    _renderList() {
      if (!this.containerEl) return;
      this.containerEl.innerHTML = '';

      for (const [key, test] of this.tests.entries()) {
        const item = document.createElement('div');
        item.className = `app-runner-test-item ${test.status}`;
        const ic = test.status === 'passed' ? ICON_PASS : (test.status === 'failed' ? ICON_FAIL : ICON_SKIP);
        item.innerHTML = `${ic}<span>${test.methodName}</span>`;
        item.title = `${test.className}.${test.methodName} (${test.status})`;
        this.containerEl.appendChild(item);
      }
    }
  }

  window.TestResultsViewer = TestResultsViewer;
})();
