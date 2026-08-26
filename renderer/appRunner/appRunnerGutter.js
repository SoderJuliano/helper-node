// renderer/appRunner/appRunnerGutter.js
// Desenha os ícones de Play (▶) na calha do CodeMirror para métodos main(),
// Spring Boot e testes JUnit, permitindo executar com um único clique.

(function() {
  const PLAY_ICON_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 3 19 12 5 21 5 3"/></svg>';

  function dismissActivePopover() {
    document.querySelectorAll('.app-runner-popover').forEach(p => p.remove());
  }

  document.addEventListener('click', (e) => {
    if (!e.target.closest('.app-runner-popover') && !e.target.closest('.app-runner-gutter-marker')) {
      dismissActivePopover();
    }
  });

  function showGutterPopover(event, actions) {
    dismissActivePopover();
    const popover = document.createElement('div');
    popover.className = 'app-runner-popover';

    actions.forEach(act => {
      const btn = document.createElement('button');
      btn.className = 'app-runner-popover-item';
      btn.innerHTML = `${PLAY_ICON_SVG}<span>${act.label}</span>`;
      btn.onclick = () => {
        dismissActivePopover();
        act.run();
      };
      popover.appendChild(btn);
    });

    document.body.appendChild(popover);
    const rect = event.target.getBoundingClientRect();
    const popoverHeight = popover.offsetHeight || 60;
    const popoverWidth = popover.offsetWidth || 150;
    let top = rect.top - 4;
    let left = rect.right + 6;
    if (top + popoverHeight > window.innerHeight - 8) {
      top = window.innerHeight - popoverHeight - 8;
    }
    if (top < 8) top = 8;
    if (left + popoverWidth > window.innerWidth - 8) {
      left = Math.max(8, rect.left - popoverWidth - 6);
    }
    popover.style.left = `${Math.round(left)}px`;
    popover.style.top = `${Math.round(top)}px`;
  }

  function getProjectDir(filePath) {
    const wsProjectMain = document.getElementById('ws-project-main');
    if (wsProjectMain && wsProjectMain.dataset && wsProjectMain.dataset.path) {
      return wsProjectMain.dataset.path;
    }
    if (window.ctxProject && window.ctxProject.path) {
      return window.ctxProject.path;
    }
    if (window.workspaceContext && window.workspaceContext.projectPath) {
      return window.workspaceContext.projectPath;
    }
    if (filePath) {
      const norm = String(filePath).replace(/\\/g, '/');
      const idx = norm.indexOf('/src/');
      if (idx !== -1) {
        return norm.substring(0, idx);
      }
    }
    return '';
  }

  class AppRunnerGutter {
    static attach(cm, filePath) {
      if (!cm || !filePath || !filePath.endsWith('.java')) return;

      this.updateMarkers(cm, filePath);

      // Atualiza calha quando o conteúdo do editor muda (com debounce)
      let changeTimeout = null;
      cm.on('change', () => {
        if (changeTimeout) clearTimeout(changeTimeout);
        changeTimeout = setTimeout(() => {
          this.updateMarkers(cm, filePath);
        }, 500);
      });
    }

    static async updateMarkers(cm, filePath) {
      if (!cm || !filePath || !filePath.endsWith('.java')) return;
      cm.clearGutter('app-runner-gutter');

      const source = cm.getValue();
      let parseRes = null;

      try {
        if (window.electronAPI && window.electronAPI.appRunnerParseJava) {
          const res = await window.electronAPI.appRunnerParseJava({ source, filePath });
          if (res && res.ok) parseRes = res.data;
        }
      } catch (_) {}

      if (!parseRes) return;

      // 1. Marca métodos main() / Spring Boot
      if (parseRes.mainMethods && parseRes.mainMethods.length) {
        parseRes.mainMethods.forEach(main => {
          const lineIdx = main.line - 1;
          if (lineIdx < 0 || lineIdx >= cm.lineCount()) return;

          const marker = document.createElement('div');
          marker.className = 'app-runner-gutter-marker';
          marker.title = `Executar '${main.className}.main()'`;
          marker.innerHTML = PLAY_ICON_SVG;

          marker.onclick = (e) => {
            e.stopPropagation();
            const projectDir = getProjectDir(filePath);
            const target = {
              kind: 'app',
              mainClass: main.fullClassName || main.className,
              isSpringBoot: main.isSpringBoot || parseRes.isSpringBoot,
              displayName: `${main.className}.main()`,
            };
            if (window.appRunner) {
              window.appRunner.run(projectDir, target);
            }
          };

          cm.setGutterMarker(lineIdx, 'app-runner-gutter', marker);
        });
      }

      // 2. Marca métodos de teste JUnit (@Test)
      if (parseRes.testMethods && parseRes.testMethods.length) {
        parseRes.testMethods.forEach(test => {
          const lineIdx = test.line - 1;
          if (lineIdx < 0 || lineIdx >= cm.lineCount()) return;

          const marker = document.createElement('div');
          marker.className = 'app-runner-gutter-marker';
          marker.title = `Executar teste '${test.name}()'`;
          marker.innerHTML = PLAY_ICON_SVG;

          marker.onclick = (e) => {
            e.stopPropagation();
            const projectDir = getProjectDir(filePath);
            const target = {
              kind: 'test-method',
              testClass: test.fullClassName || test.className,
              testMethod: test.name,
              displayName: `${test.className}.${test.name}()`,
            };
            if (window.appRunner) {
              window.appRunner.run(projectDir, target);
            }
          };

          cm.setGutterMarker(lineIdx, 'app-runner-gutter', marker);
        });

        // Marca a classe de teste para rodar todos os testes da classe
        if (parseRes.classLine) {
          const classLineIdx = parseRes.classLine - 1;
          if (classLineIdx >= 0 && classLineIdx < cm.lineCount()) {
            const classMarker = document.createElement('div');
            classMarker.className = 'app-runner-gutter-marker';
            classMarker.title = `Executar todos os testes em '${parseRes.className}'`;
            classMarker.innerHTML = PLAY_ICON_SVG;

            classMarker.onclick = (e) => {
              e.stopPropagation();
              const projectDir = getProjectDir(filePath);
              const target = {
                kind: 'test-class',
                testClass: parseRes.fullClassName || parseRes.className,
                displayName: `Tests in ${parseRes.className}`,
              };
              if (window.appRunner) {
                window.appRunner.run(projectDir, target);
              }
            };

            cm.setGutterMarker(classLineIdx, 'app-runner-gutter', classMarker);
          }
        }
      }
    }
  }

  window.AppRunnerGutter = AppRunnerGutter;
})();
