// Main Application Entry Point
(function() {
    document.addEventListener('DOMContentLoaded', async () => {
        console.log('App initialized and loading history/context...');
        
        // Load settings & data
        if (typeof window.loadHistory === 'function') window.loadHistory();
        if (typeof window.refreshProjectContext === 'function') window.refreshProjectContext();
        if (typeof window.refreshWorkspacePanel === 'function') window.refreshWorkspacePanel();
        if (typeof window.refreshComposerModel === 'function') window.refreshComposerModel();
        
        // Initial setup for Terminal Tab UI
        if (typeof window.setupTerminalUI === 'function') window.setupTerminalUI();

        // Initial shortcuts fetch
        if (typeof window.electronAPI !== 'undefined' && window.electronAPI.onShortcutsChanged) {
            window.electronAPI.onShortcutsChanged(() => {
                if (typeof renderShortcuts === 'function') renderShortcuts();
            });
        }
    });

    // Listen to changes in project structure or file updates
    if (window.electronAPI) {
        window.electronAPI.onWorkspaceChanged(async () => {
            if (typeof window.refreshProjectTree === 'function') {
                await window.refreshProjectTree();
            }
            if (typeof window.refreshProjectContext === 'function') {
                await window.refreshProjectContext();
            }
        });

        window.electronAPI.onWorkspaceFileWritten(async (data) => {
            if (typeof window.triggerTreeRefresh === 'function') {
                window.triggerTreeRefresh();
            } else if (typeof window.refreshProjectTree === 'function') {
                await window.refreshProjectTree();
            }
            if (typeof window.fetchAndUpdateGitStatus === 'function') {
                window.fetchAndUpdateGitStatus();
            }
        });

        if (window.electronAPI.onFileMutated) {
            window.electronAPI.onFileMutated(async (data) => {
                if (typeof window.triggerTreeRefresh === 'function') {
                    window.triggerTreeRefresh();
                } else if (typeof window.refreshProjectTree === 'function') {
                    await window.refreshProjectTree();
                }
                if (typeof window.fetchAndUpdateGitStatus === 'function') {
                    window.fetchAndUpdateGitStatus();
                }
            });
        }

        // Trigger loading file in viewer from config or other windows
        window.electronAPI.onOpenFileInViewer((filePath) => {
            if (typeof window.openFileViewer === 'function') {
                window.openFileViewer(filePath);
            }
        });
    }
})();
