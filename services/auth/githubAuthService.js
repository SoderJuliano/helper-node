// services/auth/githubAuthService.js
// Servico de autenticacao corporativa GitHub / Copilot com suporte a Device Flow
// e auto-descoberta de tokens existentes do VSCode, IntelliJ e GitHub CLI (100% user-space, zero admin).

const fs = require('fs');
const path = require('path');
const os = require('os');
const https = require('https');

// Client ID padrao para integracoes Copilot / GitHub Device Flow
const COPILOT_CLIENT_ID = 'Iv1.b507a08c87ec2981';

function getStorageDir() {
  const base = process.env.USERPROFILE || process.env.HOME || os.homedir();
  const dir = path.join(base, '.config', 'helper-node');
  if (!fs.existsSync(dir)) {
    try {
      fs.mkdirSync(dir, { recursive: true });
    } catch (_) {}
  }
  return dir;
}

function getTokenFilePath() {
  return path.join(getStorageDir(), 'github-token.json');
}

class GithubAuthService {
  /**
   * Le o token salvo do Helper Node no diretorio do usuario.
   */
  static getSavedToken() {
    try {
      const p = getTokenFilePath();
      if (fs.existsSync(p)) {
        const data = JSON.parse(fs.readFileSync(p, 'utf8'));
        if (data && data.oauth_token) return data;
      }
    } catch (_) {}
    return null;
  }

  /**
   * Salva o token no diretorio do usuario.
   */
  static saveToken(tokenData) {
    try {
      const p = getTokenFilePath();
      fs.writeFileSync(p, JSON.stringify(tokenData, null, 2), 'utf8');
      return true;
    } catch (e) {
      console.error('[GithubAuth] Erro ao salvar token:', e.message);
      return false;
    }
  }

  /**
   * Remove o token salvo do usuario.
   */
  static clearToken() {
    try {
      const p = getTokenFilePath();
      if (fs.existsSync(p)) fs.unlinkSync(p);
      return true;
    } catch (_) {
      return false;
    }
  }

  /**
   * Busca e importa sessoes ja ativas e autorizadas de outras IDEs instaladas no Windows/Linux.
   */
  static autoDetectLocalTokens() {
    const homedir = process.env.USERPROFILE || process.env.HOME || os.homedir();
    const appdata = process.env.APPDATA || path.join(homedir, 'AppData', 'Roaming');
    const localappdata = process.env.LOCALAPPDATA || path.join(homedir, 'AppData', 'Local');

    const candidatePaths = [
      // VSCode & Copilot Plugin
      path.join(appdata, 'github-copilot', 'hosts.json'),
      path.join(localappdata, 'github-copilot', 'hosts.json'),
      path.join(homedir, '.config', 'github-copilot', 'hosts.json'),
      path.join(homedir, '.config', 'github-copilot', 'apps.json'),
      
      // JetBrains / IntelliJ IDEA Copilot
      path.join(appdata, 'JetBrains', 'github-copilot', 'hosts.json'),
      path.join(localappdata, 'JetBrains', 'github-copilot', 'hosts.json'),
    ];

    // Busca dinamica em pastas do JetBrains (ex: AppData/Roaming/JetBrains/IntelliJIdea2024.1/...)
    const jbDir = path.join(appdata, 'JetBrains');
    if (fs.existsSync(jbDir)) {
      try {
        const subdirs = fs.readdirSync(jbDir);
        for (const sub of subdirs) {
          candidatePaths.push(path.join(jbDir, sub, 'github-copilot', 'hosts.json'));
        }
      } catch (_) {}
    }

    for (const cPath of candidatePaths) {
      if (fs.existsSync(cPath)) {
        try {
          const raw = fs.readFileSync(cPath, 'utf8');
          const parsed = JSON.parse(raw);
          // Estrutura padrao hosts.json: { "github.com": { "user": "...", "oauth_token": "ghu_..." } }
          for (const key of Object.keys(parsed)) {
            const entry = parsed[key];
            if (entry && (entry.oauth_token || entry.token)) {
              const token = entry.oauth_token || entry.token;
              const user = entry.user || 'Desconhecido';
              return {
                source: cPath.includes('JetBrains') ? 'IntelliJ / JetBrains' : 'VSCode / Copilot',
                token,
                user,
                path: cPath
              };
            }
          }
        } catch (_) {}
      }
    }

    return null;
  }

  /**
   * Faz requisicao HTTPS generica em JSON sem depender de binarios externos.
   */
  static _httpRequest(urlStr, options = {}, postData = null) {
    return new Promise((resolve, reject) => {
      const url = new URL(urlStr);
      const reqOpts = {
        hostname: url.hostname,
        port: 443,
        path: url.pathname + url.search,
        method: options.method || 'GET',
        headers: {
          'User-Agent': 'Helper-Node-Copilot-Auth/1.0',
          'Accept': 'application/json',
          ...(options.headers || {})
        }
      };

      const req = https.request(reqOpts, (res) => {
        let body = '';
        res.on('data', chunk => { body += chunk; });
        res.on('end', () => {
          try {
            const data = JSON.parse(body);
            resolve({ statusCode: res.statusCode, data, raw: body });
          } catch (_) {
            resolve({ statusCode: res.statusCode, data: null, raw: body });
          }
        });
      });

      req.on('error', err => reject(err));
      if (postData) req.write(typeof postData === 'string' ? postData : JSON.stringify(postData));
      req.end();
    });
  }

  /**
   * Inicia o fluxo Device Flow (RFC 8628).
   * Retorna { user_code, device_code, verification_uri, interval, expires_in }
   */
  static async startDeviceFlow(clientId = COPILOT_CLIENT_ID) {
    const postData = JSON.stringify({
      client_id: clientId,
      scope: 'read:user,copilot'
    });

    const res = await this._httpRequest('https://github.com/login/device/code', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData)
      }
    }, postData);

    if (res.statusCode !== 200 || !res.data || !res.data.device_code) {
      throw new Error((res.data && res.data.error_description) || 'Falha ao iniciar login com GitHub.');
    }

    return res.data;
  }

  /**
   * Executa uma tentativa de polling para obter o token de acesso.
   */
  static async pollAccessToken(deviceCode, clientId = COPILOT_CLIENT_ID) {
    const postData = JSON.stringify({
      client_id: clientId,
      device_code: deviceCode,
      grant_type: 'urn:ietf:params:oauth:grant-type:device_code'
    });

    const res = await this._httpRequest('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData)
      }
    }, postData);

    if (res.data) {
      if (res.data.access_token) {
        return { status: 'success', token: res.data.access_token, tokenData: res.data };
      }
      if (res.data.error === 'authorization_pending') {
        return { status: 'pending' };
      }
      if (res.data.error === 'slow_down') {
        return { status: 'slow_down', interval: (res.data.interval || 5) };
      }
      if (res.data.error === 'expired_token') {
        return { status: 'expired', error: 'Código de autorização expirado.' };
      }
      return { status: 'error', error: res.data.error_description || res.data.error };
    }

    return { status: 'pending' };
  }

  /**
   * Valida se um token é valido no GitHub e recupera perfil de usuario.
   */
  static async verifyToken(token) {
    if (!token) return { valid: false, error: 'Token ausente' };

    try {
      const res = await this._httpRequest('https://api.github.com/user', {
        headers: {
          'Authorization': `token ${token}`
        }
      });

      if (res.statusCode === 200 && res.data && res.data.login) {
        return {
          valid: true,
          user: res.data.login,
          name: res.data.name || res.data.login,
          avatar: res.data.avatar_url
        };
      }
      return { valid: false, error: (res.data && res.data.message) || `HTTP ${res.statusCode}` };
    } catch (e) {
      return { valid: false, error: e.message };
    }
  }
}

module.exports = GithubAuthService;
