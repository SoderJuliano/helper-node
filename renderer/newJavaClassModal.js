// New Java Class Modal Module (IntelliJ IDEA Style)
(function() {
  const SVGI_JAVA = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="java-class-icon"><path d="M18 8h1a4 4 0 0 1 0 8h-1"/><path d="M2 8h16v9a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4V8z"/><line x1="6" y1="1" x2="6" y2="4"/><line x1="10" y1="1" x2="10" y2="4"/><line x1="14" y1="1" x2="14" y2="4"/></svg>';

  const JAVA_TYPES = [
    { id: 'class', label: 'Class', badge: 'C', badgeClass: 'badge-class', keyword: 'class' },
    { id: 'interface', label: 'Interface', badge: 'I', badgeClass: 'badge-interface', keyword: 'interface' },
    { id: 'enum', label: 'Enum', badge: 'E', badgeClass: 'badge-enum', keyword: 'enum' },
    { id: 'record', label: 'Record', badge: 'R', badgeClass: 'badge-record', keyword: 'record' },
    { id: 'annotation', label: '@interface', badge: '@', badgeClass: 'badge-annotation', keyword: '@interface' }
  ];

  function resolveJavaClassTarget(parentDirPath, rawInput, projectRoot) {
    let input = String(rawInput || '').trim();
    if (input.endsWith('.java')) input = input.slice(0, -5);
    input = input.replace(/\\/g, '/');

    const normParent = String(parentDirPath || '').replace(/\\/g, '/').replace(/\/+$/, '');
    const normRoot = String(projectRoot || '').replace(/\\/g, '/').replace(/\/+$/, '');

    // Identifica raiz de código-fonte Java padrão
    let sourceRoot = '';
    let basePkgPath = '';

    const srcPatterns = ['/src/main/java', '/src/test/java', '/src/java', '/src'];
    for (const pat of srcPatterns) {
      const idx = normParent.indexOf(pat);
      if (idx !== -1) {
        sourceRoot = normParent.substring(0, idx + pat.length);
        basePkgPath = normParent.substring(idx + pat.length).replace(/^\/+/, '');
        break;
      }
    }

    if (!sourceRoot && normRoot && normParent.startsWith(normRoot)) {
      sourceRoot = normRoot;
      basePkgPath = normParent.substring(normRoot.length).replace(/^\/+/, '');
    }

    const basePkg = basePkgPath ? basePkgPath.replace(/\//g, '.').replace(/^\.+|\.+$/g, '') : '';

    let typeName = '';
    let userPkg = '';

    if (input.includes('/')) {
      const parts = input.split('/');
      typeName = parts.pop();
      userPkg = parts.join('.');
    } else if (input.includes('.')) {
      const parts = input.split('.');
      typeName = parts.pop();
      userPkg = parts.join('.');
    } else {
      typeName = input;
    }

    // Capitaliza primeira letra do tipo
    if (typeName) {
      typeName = typeName.charAt(0).toUpperCase() + typeName.slice(1);
    }

    let finalPkg = '';
    let targetDir = normParent;

    if (userPkg) {
      if (basePkg) {
        if (userPkg === basePkg || userPkg.startsWith(basePkg + '.')) {
          finalPkg = userPkg;
          const extraPath = userPkg.substring(basePkg.length).replace(/^\.+/, '').replace(/\./g, '/');
          targetDir = extraPath ? `${normParent}/${extraPath}` : normParent;
        } else {
          finalPkg = `${basePkg}.${userPkg}`;
          targetDir = `${normParent}/${userPkg.replace(/\./g, '/')}`;
        }
      } else {
        finalPkg = userPkg;
        targetDir = `${sourceRoot || normParent}/${userPkg.replace(/\./g, '/')}`;
      }
    } else {
      finalPkg = basePkg;
      targetDir = normParent;
    }

    const separator = parentDirPath && parentDirPath.includes('\\') ? '\\' : '/';
    const finalDirPath = targetDir.replace(/\//g, separator);
    const finalFilePath = `${finalDirPath}${finalDirPath.endsWith(separator) ? '' : separator}${typeName ? typeName + '.java' : ''}`;

    return {
      typeName,
      packageName: finalPkg,
      dirPath: finalDirPath,
      filePath: finalFilePath
    };
  }

  function generateJavaTemplate(packageName, typeName, kind = 'class') {
    const pkgHeader = packageName ? `package ${packageName};\n\n` : '';
    let body = '';
    if (kind === 'interface') {
      if (typeName.endsWith('Repository')) {
        body = `import org.springframework.stereotype.Repository;\n\n@Repository\npublic interface ${typeName} {\n    \n}\n`;
      } else {
        body = `public interface ${typeName} {\n    \n}\n`;
      }
    } else if (kind === 'enum') {
      body = `public enum ${typeName} {\n    \n}\n`;
    } else if (kind === 'record') {
      body = `public record ${typeName}() {\n    \n}\n`;
    } else if (kind === 'annotation') {
      body = `public @interface ${typeName} {\n    \n}\n`;
    } else {
      if (typeName.endsWith('Service')) {
        body = `import org.springframework.stereotype.Service;\n\n@Service\npublic class ${typeName} {\n    \n}\n`;
      } else if (typeName.endsWith('Controller')) {
        body = `import org.springframework.web.bind.annotation.RestController;\nimport org.springframework.web.bind.annotation.RequestMapping;\n\n@RestController\npublic class ${typeName} {\n    \n}\n`;
      } else if (typeName.endsWith('Repository')) {
        body = `import org.springframework.stereotype.Repository;\n\n@Repository\npublic class ${typeName} {\n    \n}\n`;
      } else {
        body = `public class ${typeName} {\n    \n}\n`;
      }
    }
    return `${pkgHeader}${body}`;
  }

  function openNewJavaClassDialog(parentDirPath) {
    // Remove modal anterior se houver
    const old = document.getElementById('java-class-modal-backdrop');
    if (old) old.remove();

    const wsProjectMain = document.getElementById('ws-project-main');
    const projectRoot = (wsProjectMain && wsProjectMain.dataset.path) || '';
    const targetDir = parentDirPath || projectRoot || '';

    let selectedKind = 'class';

    const backdrop = document.createElement('div');
    backdrop.id = 'java-class-modal-backdrop';
    backdrop.className = 'java-class-modal-backdrop';

    backdrop.innerHTML = `
      <div class="java-class-modal" id="java-class-modal">
        <div class="java-class-header">
          <div class="java-class-title">
            ${SVGI_JAVA}
            <span>New Java Class</span>
          </div>
          <button type="button" class="java-class-btn-close" id="java-class-btn-close" title="Fechar (Esc)">✕</button>
        </div>

        <div class="java-class-body">
          <div class="java-class-input-wrap">
            <label class="java-class-label" for="java-class-name-input">Nome / Pacote:</label>
            <input type="text" id="java-class-name-input" class="java-class-input" placeholder="Ex: UserService ou com.example.service.UserService" autofocus autocomplete="off" spellcheck="false" />
          </div>

          <div class="java-class-preview" id="java-class-preview">
            Pacote: <span class="pkg-name">...</span>
          </div>

          <div class="java-class-input-wrap">
            <label class="java-class-label">Tipo:</label>
            <div class="java-class-types-group" id="java-class-types-group">
              ${JAVA_TYPES.map((t, idx) => `
                <div class="java-class-type-chip ${idx === 0 ? 'selected' : ''}" data-kind="${t.id}">
                  <span class="java-class-type-badge ${t.badgeClass}">${t.badge}</span>
                  <span>${t.label}</span>
                </div>
              `).join('')}
            </div>
          </div>
        </div>

        <div class="java-class-footer">
          <div class="java-class-hints">
            <span>Enter para criar e abrir • Esc para cancelar</span>
          </div>
          <div class="java-class-actions">
            <button type="button" class="java-class-btn java-class-btn-cancel" id="java-class-btn-cancel">Cancelar</button>
            <button type="button" class="java-class-btn java-class-btn-create" id="java-class-btn-create">Criar e Abrir</button>
          </div>
        </div>
      </div>
    `;

    document.body.appendChild(backdrop);

    const input = document.getElementById('java-class-name-input');
    const previewEl = document.getElementById('java-class-preview');
    const chips = document.querySelectorAll('.java-class-type-chip');
    const btnClose = document.getElementById('java-class-btn-close');
    const btnCancel = document.getElementById('java-class-btn-cancel');
    const btnCreate = document.getElementById('java-class-btn-create');

    setTimeout(() => {
      if (input) {
        input.focus();
        input.select();
      }
    }, 50);

    const updatePreview = () => {
      const val = input.value.trim();
      const resolved = resolveJavaClassTarget(targetDir, val, projectRoot);
      const pkgSpan = previewEl.querySelector('.pkg-name');
      if (pkgSpan) {
        pkgSpan.textContent = resolved.packageName || '(default package)';
      }
    };

    updatePreview();

    chips.forEach(chip => {
      chip.onclick = () => {
        chips.forEach(c => c.classList.remove('selected'));
        chip.classList.add('selected');
        selectedKind = chip.dataset.kind;
      };
    });

    const closeModal = () => {
      backdrop.remove();
    };

    const handleCreate = async () => {
      const val = input.value.trim();
      if (!val) {
        input.focus();
        return;
      }

      const resolved = resolveJavaClassTarget(targetDir, val, projectRoot);
      if (!resolved.typeName) {
        alert('Por favor, informe um nome válido para a classe Java.');
        input.focus();
        return;
      }

      const template = generateJavaTemplate(resolved.packageName, resolved.typeName, selectedKind);

      if (window.electronAPI && window.electronAPI.createFile) {
        const res = await window.electronAPI.createFile(resolved.filePath, template);
        if (res && res.ok) {
          closeModal();
          
          // Adiciona pasta criada aos expandidos para nunca fechar
          if (window.expandedDirPaths) {
            window.expandedDirPaths.add(resolved.dirPath);
            window.expandedDirPaths.add(targetDir);
          }

          if (typeof window.openFileViewer === 'function') {
            await window.openFileViewer(resolved.filePath);
          }

          if (typeof window.refreshProjectTree === 'function') {
            window.refreshProjectTree();
          }

          if (typeof window.showToast === 'function') {
            window.showToast(`Classe Java '${resolved.typeName}' criada e aberta!`);
          }
        } else {
          alert('Erro ao criar classe Java: ' + (res ? res.error : 'erro desconhecido'));
        }
      }
    };

    input.oninput = updatePreview;

    input.onkeydown = (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        e.stopPropagation();
        handleCreate();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        closeModal();
      } else if (e.key === 'Tab') {
        e.preventDefault();
        // Cicla entre os tipos (Class -> Interface -> Enum -> Record -> @interface)
        const curIdx = JAVA_TYPES.findIndex(t => t.id === selectedKind);
        const nextIdx = (curIdx + 1) % JAVA_TYPES.length;
        selectedKind = JAVA_TYPES[nextIdx].id;
        chips.forEach((c, idx) => {
          c.classList.toggle('selected', idx === nextIdx);
        });
      }
    };

    btnClose.onclick = closeModal;
    btnCancel.onclick = closeModal;
    btnCreate.onclick = handleCreate;

    backdrop.onclick = (e) => {
      if (e.target === backdrop) closeModal();
    };

    setTimeout(() => {
      input.focus();
    }, 60);
  }

  window.openNewJavaClassDialog = openNewJavaClassDialog;
  window.resolveJavaClassTarget = resolveJavaClassTarget;
  window.generateJavaTemplate = generateJavaTemplate;
})();
