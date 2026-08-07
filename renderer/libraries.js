// Nó "Bibliotecas" no painel do projeto — lista as dependências Java
// resolvidas no repositório local, no espírito da pasta "External Libraries"
// do IntelliJ.
//
// Clicar numa lib com fonte abre a listagem de classes dela; clicar numa classe
// abre o código original (extraído do -sources.jar sob demanda, só leitura).
(function () {
  const LIB_ICON = '<svg class="ws-tree-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>';
  const CHEVRON = '<svg class="ws-tree-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>';

  let libsCache = null;
  let aberto = false;

  function elRaiz() { return document.getElementById('ws-libs'); }

  async function carregar() {
    if (!(window.electronAPI && window.electronAPI.libsList)) return null;
    try { return await window.electronAPI.libsList(); } catch (_) { return null; }
  }

  function criarNo(texto, iconeHtml, profundidade, extraClasse) {
    const n = document.createElement('div');
    n.className = 'ws-tree-node ' + (extraClasse || '');
    n.style.paddingLeft = (4 + profundidade * 12) + 'px';
    n.innerHTML = iconeHtml;
    const label = document.createElement('span');
    label.className = 'ws-tree-label';
    label.textContent = texto;
    n.appendChild(label);
    return n;
  }

  function marcaFonte(lib) {
    const tag = document.createElement('span');
    tag.className = 'ws-lib-tag';
    if (!lib.baixada) { tag.textContent = 'não baixada'; tag.classList.add('ausente'); }
    else if (!lib.temFonte) { tag.textContent = 'sem fonte'; tag.classList.add('sem-fonte'); }
    else { tag.textContent = 'fonte'; tag.classList.add('com-fonte'); }
    return tag;
  }

  async function abrirClasse(nomeClasse) {
    if (!(window.electronAPI && window.electronAPI.libsOpenClass)) return;
    const alvo = await window.electronAPI.libsOpenClass({ className: nomeClasse, imports: [] });
    if (alvo && alvo.filePath && window.EditorController) {
      await window.EditorController.openFile(alvo.filePath, alvo.line || 1);
      if (typeof showToast === 'function') {
        showToast(`${nomeClasse} — ${alvo.biblioteca} (somente leitura)`);
      }
    } else if (typeof showToast === 'function') {
      showToast(`Sem código-fonte para ${nomeClasse}`);
    }
  }

  async function render() {
    const host = elRaiz();
    if (!host) return;
    host.innerHTML = '';

    const cabecalho = criarNo('Bibliotecas', CHEVRON + LIB_ICON, 0, 'dir' + (aberto ? '' : ' collapsed'));
    cabecalho.addEventListener('click', async () => {
      aberto = !aberto;
      if (aberto && !libsCache) libsCache = await carregar();
      render();
    });
    host.appendChild(cabecalho);
    if (!aberto) return;

    if (!libsCache) {
      host.appendChild(criarNo('carregando…', '', 1, 'file'));
      return;
    }
    if (!libsCache.ok || !libsCache.libs || !libsCache.libs.length) {
      const msg = (libsCache && libsCache.nota) || (libsCache && libsCache.erro) || 'nenhuma dependência encontrada';
      host.appendChild(criarNo(msg, '', 1, 'file'));
      return;
    }

    for (const lib of libsCache.libs) {
      const rotulo = `${lib.artifactId}${lib.version ? ' : ' + lib.version : ''}`;
      const no = criarNo(rotulo, LIB_ICON, 1, 'file ws-lib');
      no.title = `${lib.groupId}:${lib.artifactId}${lib.version ? ':' + lib.version : ''}`
        + (lib.jar ? `\n${lib.jar}` : '\nnão encontrada no repositório local');
      no.appendChild(marcaFonte(lib));
      if (lib.temFonte) {
        no.addEventListener('click', () => {
          // Sem fonte não há o que abrir; com fonte, a navegação real acontece
          // por Ctrl+clique no código. Aqui só apontamos onde o jar está.
          if (window.electronAPI && window.electronAPI.workspaceOpenExternal && lib.sources) {
            window.electronAPI.workspaceOpenExternal(lib.sources);
          }
        });
      }
      host.appendChild(no);
    }
  }

  function invalidar() { libsCache = null; if (aberto) render(); }

  // Abre a seção e espera a lista chegar. O clique no cabeçalho dispara carga
  // assíncrona sem devolver promessa, o que torna impossível esperar por ele.
  async function abrir() {
    aberto = true;
    if (!libsCache) libsCache = await carregar();
    await render();
    return libsCache;
  }

  window.Libraries = { render, invalidar, abrirClasse, abrir };

  if (window.electronAPI && window.electronAPI.onWorkspaceChanged) {
    window.electronAPI.onWorkspaceChanged(() => invalidar());
  }
  document.addEventListener('DOMContentLoaded', () => render());
  render();
})();
