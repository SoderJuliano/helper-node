// renderer/chatHistoryViewer.js
// Modal conversation viewer, realtime bubbles and toast notifications.
(function() {
  'use strict';

  const conversationViewer = document.getElementById('conversation-viewer');
  const conversationContent = document.getElementById('conversation-content');
  const conversationCloseBtn = document.getElementById('conversation-close-btn');
  const conversationDownloadBtn = document.getElementById('conversation-download-btn');
  const transcriptionElement = document.getElementById('transcription');
  const appToast = document.getElementById('app-toast');

  let toastTimer = null;

  function showToast(text, kind) {
    if (!appToast) return;
    appToast.textContent = text;
    appToast.classList.toggle('error', kind === 'error');
    appToast.classList.add('show');
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      appToast.classList.remove('show');
    }, 5000);
  }

  async function viewConversation(sessionId) {
    try {
      const session = await window.electronAPI.getSessionById(sessionId);
      if (!session) return;

      if (conversationContent) {
        conversationContent.innerHTML = '';
        session.conversations.forEach(msg => {
          const msgDiv = document.createElement('div');
          msgDiv.className = `conversation-message ${msg.role}`;
          msgDiv.innerHTML = `
              <div class="conversation-message-label">${msg.role === 'user' ? 'P:' : 'R:'}</div>
              <div class="conversation-message-content">${msg.content}</div>
          `;
          conversationContent.appendChild(msgDiv);
        });
      }

      if (conversationViewer) {
        conversationViewer.dataset.sessionId = sessionId;
        conversationViewer.style.display = 'block';
      }
    } catch (error) {
      console.error('Erro ao visualizar conversa:', error);
    }
  }

  if (conversationCloseBtn && conversationViewer) {
    conversationCloseBtn.addEventListener('click', () => {
      conversationViewer.style.display = 'none';
    });
  }

  if (conversationDownloadBtn && conversationViewer) {
    conversationDownloadBtn.addEventListener('click', async () => {
      const sid = conversationViewer.dataset.sessionId;
      if (!sid) {
        showToast('Nenhuma conversa aberta pra baixar.', 'error');
        return;
      }
      conversationDownloadBtn.disabled = true;
      try {
        const res = await window.electronAPI.downloadConversationTxt(sid);
        if (res && res.ok) {
          showToast(`Conversa salva em:\n${res.path}`);
        } else {
          showToast(`Falha ao baixar: ${(res && res.error) || 'erro desconhecido'}`, 'error');
        }
      } catch (e) {
        showToast(`Falha ao baixar: ${e.message}`, 'error');
      } finally {
        conversationDownloadBtn.disabled = false;
      }
    });
  }

  function getOrCreateRealtimeFeed() {
    let feed = document.getElementById('rt-assistant-feed');
    if (!feed && transcriptionElement) {
      feed = document.createElement('div');
      feed.id = 'rt-assistant-feed';
      feed.className = 'rt-assistant-feed';
      transcriptionElement.appendChild(feed);
      const hero = document.getElementById('welcome-hero');
      if (hero) hero.classList.add('hidden');
    }
    return feed;
  }

  function appendRealtimeBubble(type, text) {
    if (!text) return;
    const feed = getOrCreateRealtimeFeed();
    if (!feed) return;
    const bubble = document.createElement('div');
    bubble.className = `rt-bubble ${type}`;

    if (type === 'user') {
      const lines = text.split('\n');
      const title = lines[0] || '';
      const body = lines.slice(1).join('\n').trim();

      const header = document.createElement('div');
      header.className = 'rt-bubble-header';
      header.innerHTML = `<span>${title}</span><span class="rt-bubble-toggle">▼</span>`;

      const bodyEl = document.createElement('div');
      bodyEl.className = 'rt-bubble-body';
      bodyEl.textContent = body;

      header.addEventListener('click', () => {
        const isOpen = bodyEl.classList.toggle('open');
        header.querySelector('.rt-bubble-toggle').classList.toggle('open', isOpen);
      });

      bubble.appendChild(header);
      if (body) bubble.appendChild(bodyEl);
    } else {
      bubble.textContent = text;
    }

    feed.appendChild(bubble);
    if (transcriptionElement) {
      transcriptionElement.scrollTo({
        top: transcriptionElement.scrollHeight,
        behavior: 'smooth'
      });
    }
  }

  window.showToast = showToast;
  window.viewConversation = viewConversation;
  window.appendRealtimeBubble = appendRealtimeBubble;
  window.getOrCreateRealtimeFeed = getOrCreateRealtimeFeed;
})();
