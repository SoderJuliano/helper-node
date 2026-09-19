// main/ipc/githubAuth.js
// IPC handlers para autenticacao corporativa do GitHub / Copilot e importacao de sessoes (VSCode / IntelliJ).

const { ipcMain, shell } = require('electron');
const GithubAuthService = require('../../services/auth/githubAuthService.js');

module.exports = function registerGithubAuthIpc() {
  ipcMain.handle('github-auth-get-status', async () => {
    const saved = GithubAuthService.getSavedToken();
    if (saved && saved.oauth_token) {
      const verify = await GithubAuthService.verifyToken(saved.oauth_token);
      if (verify.valid) {
        return {
          authenticated: true,
          user: verify.user,
          name: verify.name,
          source: saved.source || 'Helper Node'
        };
      }
    }

    // Se nao tiver token salvo valido, verifica se ha sessao disponivel para importacao
    const detected = GithubAuthService.autoDetectLocalTokens();
    return {
      authenticated: false,
      detectedAvailable: !!detected,
      detectedSource: detected ? detected.source : null,
      detectedUser: detected ? detected.user : null
    };
  });

  ipcMain.handle('github-auth-auto-import', async () => {
    const detected = GithubAuthService.autoDetectLocalTokens();
    if (!detected || !detected.token) {
      return { success: false, error: 'Nenhuma credencial do VSCode ou IntelliJ encontrada na maquina.' };
    }

    const verify = await GithubAuthService.verifyToken(detected.token);
    if (!verify.valid) {
      return { success: false, error: `Credencial encontrada em ${detected.source}, mas expirada ou invalida.` };
    }

    GithubAuthService.saveToken({
      oauth_token: detected.token,
      user: verify.user,
      source: detected.source,
      savedAt: new Date().toISOString()
    });

    return {
      success: true,
      user: verify.user,
      name: verify.name,
      source: detected.source
    };
  });

  ipcMain.handle('github-auth-start-device-flow', async () => {
    try {
      const data = await GithubAuthService.startDeviceFlow();
      if (data.verification_uri) {
        try {
          shell.openExternal(data.verification_uri);
        } catch (_) {}
      }
      return { success: true, data };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('github-auth-poll-device-flow', async (event, { deviceCode }) => {
    try {
      const pollRes = await GithubAuthService.pollAccessToken(deviceCode);
      if (pollRes.status === 'success' && pollRes.token) {
        const verify = await GithubAuthService.verifyToken(pollRes.token);
        GithubAuthService.saveToken({
          oauth_token: pollRes.token,
          user: verify.user || 'GitHub User',
          source: 'GitHub Device Flow (Login Web)',
          savedAt: new Date().toISOString()
        });

        return {
          status: 'success',
          user: verify.user,
          name: verify.name
        };
      }
      return pollRes;
    } catch (err) {
      return { status: 'error', error: err.message };
    }
  });

  ipcMain.handle('github-auth-logout', async () => {
    GithubAuthService.clearToken();
    return { success: true };
  });
};
