// renderer/windowResize.js
// Controlador de redimensionamento da janela pelas bordas e cantos (Frameless cross-platform)

(function() {
    function initWindowResizeHandles() {
        const handles = document.querySelectorAll('.win-resize-handle');
        if (!handles.length || !window.electronAPI || !window.electronAPI.setWindowBounds) return;

        let activeDir = null;
        let startMouseX = 0;
        let startMouseY = 0;
        let startBounds = null;
        let isResizing = false;
        let resizeRaf = null;
        let pendingBounds = null;
        const minW = 680;
        const minH = 480;

        function onPointerMove(e) {
            if (!isResizing || !activeDir || !startBounds) return;
            const deltaX = e.screenX - startMouseX;
            const deltaY = e.screenY - startMouseY;

            let newX = startBounds.x;
            let newY = startBounds.y;
            let newW = startBounds.width;
            let newH = startBounds.height;

            if (activeDir.includes('right')) newW = Math.max(minW, startBounds.width + deltaX);
            if (activeDir.includes('bottom')) newH = Math.max(minH, startBounds.height + deltaY);
            if (activeDir.includes('left')) {
                const targetW = startBounds.width - deltaX;
                newW = Math.max(minW, targetW);
                newX = startBounds.x + (startBounds.width - newW);
            }
            if (activeDir.includes('top')) {
                const targetH = startBounds.height - deltaY;
                newH = Math.max(minH, targetH);
                newY = startBounds.y + (startBounds.height - newH);
            }

            pendingBounds = {
                x: Math.round(newX),
                y: Math.round(newY),
                width: Math.round(newW),
                height: Math.round(newH)
            };

            if (!resizeRaf) {
                resizeRaf = requestAnimationFrame(() => {
                    resizeRaf = null;
                    if (pendingBounds && window.electronAPI.setWindowBounds) {
                        window.electronAPI.setWindowBounds(pendingBounds);
                    }
                });
            }
        }

        function onPointerUp() {
            if (!isResizing) return;
            isResizing = false;
            activeDir = null;
            startBounds = null;
            pendingBounds = null;
            if (resizeRaf) {
                cancelAnimationFrame(resizeRaf);
                resizeRaf = null;
            }
            document.body.classList.remove('is-window-resizing');
            window.removeEventListener('mousemove', onPointerMove, true);
            window.removeEventListener('mouseup', onPointerUp, true);
            window.removeEventListener('blur', onPointerUp, true);

            window.dispatchEvent(new Event('resize'));
            if (typeof window._termFit === 'function') window._termFit();
            const cm = window.EditorController && window.EditorController.getCm ? window.EditorController.getCm() : null;
            if (cm) cm.refresh();
        }

        handles.forEach(handle => {
            handle.addEventListener('mousedown', async (e) => {
                if (e.button !== 0) return;
                if (document.body.classList.contains('is-maximized')) return;
                e.preventDefault();
                e.stopPropagation();

                activeDir = handle.dataset.dir;
                startMouseX = e.screenX;
                startMouseY = e.screenY;

                try {
                    if (window.electronAPI.getWindowBounds) {
                        startBounds = await window.electronAPI.getWindowBounds();
                    }
                } catch (_) {}

                if (!startBounds) {
                    startBounds = {
                        x: window.screenX || 0,
                        y: window.screenY || 0,
                        width: window.outerWidth || 800,
                        height: window.outerHeight || 600
                    };
                }

                isResizing = true;
                document.body.classList.add('is-window-resizing');
                window.addEventListener('mousemove', onPointerMove, true);
                window.addEventListener('mouseup', onPointerUp, true);
                window.addEventListener('blur', onPointerUp, true);
            });
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initWindowResizeHandles);
    } else {
        initWindowResizeHandles();
    }
})();
