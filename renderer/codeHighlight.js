// Realce persistente de ocorrências no editor (CodeMirror 5).
//
// Dois usos, mesmo mecanismo:
//   1. Selecionar uma palavra realça TODAS as ocorrências iguais no arquivo
//      aberto. Some ao clicar fora.
//   2. Clicar no ícone de implementação na calha navega até o método e deixa o
//      nome dele realçado no destino, também até clicar fora.
//
// Separado de codeNavigation.js, que já passa de 1000 linhas.
(function () {
  let marks = [];
  let activeCm = null;
  // Realce vindo da navegação (ícone da calha). Sobrevive ao reposicionamento
  // do cursor que o openFile faz — senão ele se apagaria sozinho na hora.
  let pinned = false;

  const WORD_RE = /^[A-Za-z_$][A-Za-z0-9_$]*$/;
  const MAX_MARKS = 500; // arquivo gigante com palavra comum não pode travar

  function clear() {
    for (const m of marks) { try { m.clear(); } catch (_) {} }
    marks = [];
    pinned = false;
  }

  // Marca todas as ocorrências de `word` como palavra inteira.
  // `skip` (opcional) evita remarcar a própria seleção do usuário.
  function markAll(cm, word, opts = {}) {
    if (!cm || !word || !WORD_RE.test(word)) return 0;
    clear();
    activeCm = cm;

    const className = opts.className || 'cm-occurrence-highlight';
    let count = 0;
    const total = cm.lineCount();
    for (let line = 0; line < total && count < MAX_MARKS; line++) {
      const text = cm.getLine(line);
      if (!text || text.indexOf(word) === -1) continue;
      let from = 0;
      while (count < MAX_MARKS) {
        const idx = text.indexOf(word, from);
        if (idx === -1) break;
        from = idx + word.length;
        // Só palavra inteira: "id" não pode acender dentro de "idade".
        const antes = idx > 0 ? text[idx - 1] : '';
        const depois = idx + word.length < text.length ? text[idx + word.length] : '';
        if (/[A-Za-z0-9_$]/.test(antes) || /[A-Za-z0-9_$]/.test(depois)) continue;
        try {
          marks.push(cm.markText(
            { line, ch: idx },
            { line, ch: idx + word.length },
            { className }
          ));
          count++;
        } catch (_) {}
      }
    }
    return count;
  }

  // Realce da navegação: fica preso até o próximo clique do usuário.
  function pin(cm, word) {
    const n = markAll(cm, word, { className: 'cm-occurrence-target' });
    pinned = n > 0;
    return n;
  }

  function attach(cm) {
    if (!cm || cm._hasOccurrenceHighlight) return;
    cm._hasOccurrenceHighlight = true;
    activeCm = cm;

    cm.on('cursorActivity', () => {
      // Um realce fixado (veio do ícone da calha) não morre com o
      // reposicionamento de cursor que o próprio openFile provoca.
      if (pinned) return;
      if (!cm.somethingSelected()) { clear(); return; }
      const sel = cm.getSelection();
      if (!sel || sel.length > 100 || !WORD_RE.test(sel.trim())) { clear(); return; }
      markAll(cm, sel.trim());
    });

    // Clicar em qualquer lugar solta o realce fixado. Em `mousedown` pra soltar
    // antes do cursorActivity do próprio clique.
    cm.getWrapperElement().addEventListener('mousedown', () => {
      if (pinned) clear();
    }, true);
  }

  // Clique fora do editor também limpa.
  document.addEventListener('mousedown', (ev) => {
    if (!marks.length || !activeCm) return;
    const wrapper = activeCm.getWrapperElement && activeCm.getWrapperElement();
    if (wrapper && !wrapper.contains(ev.target)) clear();
  }, true);

  // ── Régua de limite de coluna ───────────────────────────────────────────
  // Linha vertical discreta no limite de comprimento da linha, como o "ruler"
  // do VS Code e o "hard wrap guide" do IntelliJ.
  //
  // Um elemento só, posicionado no scroller — não um por linha. A posição vem
  // da largura REAL do caractere (defaultCharWidth), porque a fonte do editor é
  // configurável; recalcula quando a fonte muda ou a janela é redimensionada.
  const COLUNA_PADRAO = 120;

  function colunaConfigurada() {
    const salvo = parseInt(localStorage.getItem('editor_column_ruler'), 10);
    if (Number.isFinite(salvo) && salvo > 0) return salvo;
    return COLUNA_PADRAO;
  }

  function posicionarRegua(cm) {
    if (!cm) return;
    const scroller = cm.getScrollerElement();
    if (!scroller) return;

    const coluna = colunaConfigurada();
    if (coluna <= 0) { // 0 desliga
      const antiga = scroller.querySelector('.cm-column-ruler');
      if (antiga) antiga.remove();
      return;
    }

    let regua = scroller.querySelector('.cm-column-ruler');
    if (!regua) {
      regua = document.createElement('div');
      regua.className = 'cm-column-ruler';
      scroller.appendChild(regua);
    }
    const larguraChar = cm.defaultCharWidth();
    if (!larguraChar) return;
    // gutters ficam à esquerda do texto; a régua conta a partir do texto.
    const offsetGutter = cm.getGutterElement() ? cm.getGutterElement().offsetWidth : 0;
    regua.style.left = (offsetGutter + coluna * larguraChar) + 'px';
    // Cobre a altura toda, inclusive o que está rolado.
    regua.style.height = Math.max(scroller.scrollHeight, scroller.clientHeight) + 'px';
  }

  function attachRuler(cm) {
    if (!cm || cm._hasColumnRuler) return;
    cm._hasColumnRuler = true;
    posicionarRegua(cm);
    // `refresh` cobre troca de fonte, resize e troca de arquivo.
    cm.on('refresh', () => posicionarRegua(cm));
    cm.on('changes', () => posicionarRegua(cm));
    window.addEventListener('resize', () => posicionarRegua(cm));
  }

  window.CodeHighlight = { attach, markAll, pin, clear, attachRuler, posicionarRegua };
})();
