// Seta "ir para a mensagem mais recente" do chat.
//
// Restaurar um histórico grande deixa o usuário no TOPO: `restoreConversation`
// chama scrollTranscriptionToBottom('auto'), que só rola se já estiver perto do
// fim — e acabou de anexar 50 mensagens, então não está. Sem uma seta, a única
// saída é rolar tudo na mão até achar a última resposta.
//
// A seta aparece sempre que existe conversa abaixo da área visível (não só no
// restaurar: vale também pra quem rolou pra cima pra reler algo) e some sozinha
// quando o scroll chega no fim.
(function () {
    const el = document.getElementById('transcription');
    const btn = document.getElementById('scroll-to-latest');
    if (!el || !btn) return;

    // Mesmo limiar do isNearBottom de scrollTranscriptionToBottom: os dois
    // precisam concordar sobre o que é "no fim", senão a seta fica visível
    // enquanto o chat se considera colado embaixo.
    const NEAR_BOTTOM_PX = 150;

    function distanceFromBottom() {
        return el.scrollHeight - el.scrollTop - el.clientHeight;
    }

    function update() {
        btn.classList.toggle('visible', distanceFromBottom() > NEAR_BOTTOM_PX);
    }

    btn.addEventListener('click', (e) => {
        e.stopPropagation();
        el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
        // O 'scroll' do smooth vai disparando e o update() esconde a seta ao
        // cruzar o limiar. O timer é só a rede de segurança pro caso de o
        // scroll terminar sem um último evento (acontece quando o container
        // já estava quase no fim).
        setTimeout(update, 700);
    });

    el.addEventListener('scroll', update, { passive: true });

    // Restaurar histórico anexa tudo de uma vez, sem gerar scroll nenhum — sem
    // observar o DOM a seta só apareceria depois de o usuário mexer na roda.
    new MutationObserver(update).observe(el, { childList: true, subtree: true });

    // Encolher a janela pode transformar "cabe na tela" em "não cabe".
    window.addEventListener('resize', update);

    update();
})();
