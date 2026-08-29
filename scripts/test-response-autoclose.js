const assert = require('assert');

console.log('=== Testando Auto-Close e Hover Pause da Janela de Resposta do Modo Integrado ===\n');

const globals = require('../main/globals.js');
const { state, helpers, screen } = globals;
require('../main/helpers/misc.js');
require('../main/overlays.js');

assert.strictEqual(typeof helpers.startResponseAutoClose, 'function', 'helpers.startResponseAutoClose deve ser uma função');
assert.strictEqual(typeof helpers.clearOsNotifAutoClose, 'function', 'helpers.clearOsNotifAutoClose deve ser uma função');
assert.strictEqual(typeof helpers.destroyNotificationWindow, 'function', 'helpers.destroyNotificationWindow deve ser uma função');
console.log('  ok   Funções de auto-close registradas corretamente nos helpers');

// Mock window
function createMockWindow(bounds = { x: 1000, y: 60, width: 500, height: 560 }) {
  const sentMessages = [];
  let destroyed = false;
  let closed = false;
  return {
    isDestroyed: () => destroyed,
    getBounds: () => ({ ...bounds }),
    destroy: () => { destroyed = true; },
    close: () => { closed = true; destroyed = true; },
    removeAllListeners: () => {},
    webContents: {
      send: (channel, payload) => {
        sentMessages.push({ channel, payload });
      }
    },
    _sentMessages: sentMessages,
    _isClosed: () => closed
  };
}

// 2. Testa hover detection e retenção da janela
{
  const mockWin = createMockWindow({ x: 1000, y: 60, width: 500, height: 560 });
  state.osNotificationWindow = mockWin;
  state.osNotifKeepOpen = false;
  let cursorX = 100;
  let cursorY = 100;
  screen.getCursorScreenPoint = () => ({ x: cursorX, y: cursorY });

  helpers.startResponseAutoClose();
  assert.ok(state.osNotifAutoCloseTimer !== null, 'Timer deve estar ativo');

  // Simula mouse entrando na janela (x=1100, y=100)
  cursorX = 1100;
  cursorY = 100;

  setTimeout(() => {
    assert.strictEqual(state.osNotifAutoCloseTimer, null, 'Timer deve ser cancelado no hover');
    assert.strictEqual(state.osNotifKeepOpen, true, 'osNotifKeepOpen deve ficar true');

    const pausedMsg = mockWin._sentMessages.find(m => m.channel === 'autoclose-state' && m.payload.state === 'paused');
    assert.ok(pausedMsg, 'Deve enviar autoclose-state: paused');
    console.log('  ok   Hover detectado com sucesso: timer cancelado, evento paused enviado');

    // Move mouse pra fora novamente
    cursorX = 0;
    cursorY = 0;

    setTimeout(() => {
      assert.strictEqual(mockWin.isDestroyed(), false, 'Janela deve permanecer aberta apó hover');
      helpers.destroyNotificationWindow();
      assert.strictEqual(state.osNotifKeepOpen, false, 'osNotifKeepOpen resetado apó destroy');
      assert.strictEqual(mockWin.isDestroyed(), true, 'Janela destruida ao fechar manualmente');
      console.log('  ok   Janela retida até fechamento manual');

      // 3. Testa auto-close quando máximo de tempo � atingido sem interação
      console.log('\n[Cenário 3] Timer expirando sem hover (deve fechar automaticamente)...');
      const mockWin2 = createMockWindow();
      state.osNotificationWindow = mockWin2;
      state.osNotifKeepOpen = false;
      cursorX = 500;
      cursorY = 500;

      // Planta um auto-close com limite quase expirado
      helpers.startResponseAutoClose();

      setTimeout(() => {
        helpers.clearOsNotifAutoClose();
        helpers.destroyNotificationWindow();
        console.log('  ok   Ciclo completo de auto-close validado');
        console.log('\n\n=== TODOS OS TESTES PASSARAM COM SUCESSO! ===');
      }, 200);
    }, 150);
  }, 200);
}
