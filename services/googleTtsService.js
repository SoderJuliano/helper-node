/**
 * services/googleTtsService.js
 * Módulo isolado e dedicado para integração com Google Cloud Text-to-Speech (TTS).
 * Suporta autenticação via Service Account JSON (arquivo ou string) e API Key direta.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const https = require('https');

let cachedToken = null;
let cachedTokenExpiresAt = 0;
let cachedKeyPathOrString = '';

/**
 * Utilitário para codificação Base64URL sem padding.
 */
function base64url(source) {
  const buf = Buffer.isBuffer(source) ? source : Buffer.from(source);
  return buf.toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

/**
 * Tenta parsear credenciais JSON (do caminho do arquivo ou string bruta).
 */
function parseCredentials(keyOrPath) {
  if (!keyOrPath || typeof keyOrPath !== 'string') return null;
  const trimmed = keyOrPath.trim();

  // Se for um caminho de arquivo existente
  if (fs.existsSync(trimmed)) {
    try {
      const content = fs.readFileSync(trimmed, 'utf8');
      const parsed = JSON.parse(content);
      if (parsed.type === 'service_account' && parsed.private_key) {
        return { type: 'service_account', data: parsed };
      }
    } catch (err) {
      console.error('[googleTtsService] Erro ao ler arquivo de credenciais:', err.message);
    }
  }

  // Se for uma string JSON bruta
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
    try {
      const parsed = JSON.parse(trimmed);
      if (parsed.type === 'service_account' && parsed.private_key) {
        return { type: 'service_account', data: parsed };
      }
    } catch (err) {
      // não é JSON válido
    }
  }

  // Caso contrário, trata como API Key simples (ex: AIzaSy...)
  return { type: 'api_key', data: trimmed };
}

/**
 * Obtém OAuth2 Access Token a partir de Service Account JSON via JWT nativo.
 */
async function getAccessTokenFromServiceAccount(sa) {
  const now = Math.floor(Date.now() / 1000);
  if (cachedToken && cachedKeyPathOrString === sa.private_key_id && now < cachedTokenExpiresAt - 60) {
    return cachedToken;
  }

  const iat = now;
  const exp = iat + 3600;

  const header = { alg: 'RS256', typ: 'JWT' };
  const claimSet = {
    iss: sa.client_email,
    scope: 'https://www.googleapis.com/auth/cloud-platform',
    aud: sa.token_uri || 'https://oauth2.googleapis.com/token',
    exp,
    iat
  };

  const encodedHeader = base64url(JSON.stringify(header));
  const encodedClaimSet = base64url(JSON.stringify(claimSet));
  const signatureInput = `${encodedHeader}.${encodedClaimSet}`;

  const signer = crypto.createSign('RSA-SHA256');
  signer.update(signatureInput);
  const signature = signer.sign(sa.private_key, 'base64')
    .replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');

  const jwt = `${signatureInput}.${signature}`;

  const postData = new URLSearchParams({
    grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
    assertion: jwt
  }).toString();

  const tokenUri = sa.token_uri || 'https://oauth2.googleapis.com/token';

  return new Promise((resolve, reject) => {
    const req = https.request(tokenUri, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(postData)
      }
    }, (res) => {
      let body = '';
      res.on('data', d => body += d);
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try {
            const json = JSON.parse(body);
            cachedToken = json.access_token;
            cachedTokenExpiresAt = now + (json.expires_in || 3600);
            cachedKeyPathOrString = sa.private_key_id;
            resolve(cachedToken);
          } catch (e) {
            reject(new Error(`Falha ao decodificar token OAuth: ${e.message}`));
          }
        } else {
          reject(new Error(`Erro OAuth2 Google (${res.statusCode}): ${body}`));
        }
      });
    });

    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

/**
 * Sintetiza o texto em áudio MP3 (retorna Buffer com os bytes MP3).
 *
 * @param {string} text Texto a ser sintetizado.
 * @param {object} options Opções de sintetização.
 * @returns {Promise<Buffer>} Buffer contendo o MP3 gerado.
 */
async function synthesizeText(text, options = {}) {
  const {
    keyOrPath,
    voiceName = 'pt-BR-Neural2-C',
    languageCode = 'pt-BR',
    speakingRate = 1.0,
    pitch = 0.0
  } = options;

  const cleanText = prepareTextForSpeech(text);
  if (!cleanText) {
    throw new Error('Texto vazio ou sem conteúdo inteligível para áudio.');
  }

  const creds = parseCredentials(keyOrPath);
  if (!creds) {
    throw new Error('Credencial do Google Cloud TTS não configurada ou inválida.');
  }

  let requestUrl = 'https://texttospeech.googleapis.com/v1/text:synthesize';
  const headers = { 'Content-Type': 'application/json' };

  if (creds.type === 'service_account') {
    const token = await getAccessTokenFromServiceAccount(creds.data);
    headers['Authorization'] = `Bearer ${token}`;
  } else {
    requestUrl += `?key=${encodeURIComponent(creds.data)}`;
  }

  const postData = JSON.stringify({
    input: { text: cleanText },
    voice: {
      languageCode,
      name: voiceName
    },
    audioConfig: {
      audioEncoding: 'MP3',
      speakingRate,
      pitch
    }
  });

  headers['Content-Length'] = Buffer.byteLength(postData);

  return new Promise((resolve, reject) => {
    const req = https.request(requestUrl, {
      method: 'POST',
      headers
    }, (res) => {
      let body = '';
      res.on('data', d => body += d);
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try {
            const json = JSON.parse(body);
            if (json.audioContent) {
              resolve(Buffer.from(json.audioContent, 'base64'));
            } else {
              reject(new Error('Resposta do Google TTS não contem audioContent.'));
            }
          } catch (e) {
            reject(new Error(`Erro ao parsear resposta de áudio: ${e.message}`));
          }
        } else {
          let errMsg = body;
          try {
            const errJson = JSON.parse(body);
            if (errJson.error && errJson.error.message) {
              errMsg = errJson.error.message;
            }
          } catch (_) {}
          reject(new Error(`Google TTS API (${res.statusCode}): ${errMsg}`));
        }
      });
    });

    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

/**
 * Valida a chave/arquivo de credenciais testando conexão/cota com a API.
 */
async function testConnection(keyOrPath) {
  try {
    const creds = parseCredentials(keyOrPath);
    if (!creds) {
      return { ok: false, error: 'Chave ou caminho do arquivo JSON inválido.' };
    }
    // Faz sintetização de teste bem curta
    await synthesizeText('Teste de áudio.', { keyOrPath, voiceName: 'pt-BR-Neural2-C' });
    return { ok: true, message: 'Conexão e cota do Google TTS validadas com sucesso!' };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

/**
 * Lista as vozes disponíveis para um idioma.
 */
async function listVoices(keyOrPath, languageCode = 'pt-BR') {
  const creds = parseCredentials(keyOrPath);
  if (!creds) return [];

  let requestUrl = `https://texttospeech.googleapis.com/v1/voices?languageCode=${encodeURIComponent(languageCode)}`;
  const headers = {};

  if (creds.type === 'service_account') {
    const token = await getAccessTokenFromServiceAccount(creds.data);
    headers['Authorization'] = `Bearer ${token}`;
  } else {
    requestUrl += `&key=${encodeURIComponent(creds.data)}`;
  }

  return new Promise((resolve) => {
    const req = https.request(requestUrl, { method: 'GET', headers }, (res) => {
      let body = '';
      res.on('data', d => body += d);
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try {
            const json = JSON.parse(body);
            const voices = (json.voices || []).map(v => ({
              name: v.name,
              gender: v.ssmlGender,
              sampleRate: v.naturalSampleRateHertz
            }));
            resolve(voices);
          } catch (_) {
            resolve([]);
          }
        } else {
          resolve([]);
        }
      });
    });
    req.on('error', () => resolve([]));
    req.end();
  });
}

/**
 * Prepara o texto para sintetização removendo marcadores markdown, HTML e limpos.
 */
function prepareTextForSpeech(text) {
  if (!text || typeof text !== 'string') return '';
  let cleaned = text
    .replace(/```[\s\S]*?```/g, '') // remove blocos de código
    .replace(/`([^`]+)`/g, '$1')     // remove inline code
    .replace(/<[^>]*>/g, '')         // remove tags HTML
    .replace(/https?:\/\/\S+/g, '')  // remove URLs
    .replace(/\|[^\n]+\|/g, '')      // remove tabelas markdown
    .replace(/^[-*#]+\s+/gm, '')     // remove marcadores de lista e headers
    .replace(/[*_~#]/g, '')          // remove símbolos markdown
    .replace(/\s+/g, ' ')            // colapsa espaços duplos
    .trim();

  return cleaned;
}

/**
 * Extrai o resumo exclusivo para voz a partir da resposta inteira da IA.
 * Se houver a tag <voice_summary>...</voice_summary>, extrai o conteúdo.
 * Caso contrário, faz o fallback inteligente limpando códigos e limitando estritamente a 1-2 frases curtas.
 */
function extractVoiceSummary(fullResponse) {
  if (!fullResponse || typeof fullResponse !== 'string') return '';

  const match = fullResponse.match(/<voice_summary>([\s\S]*?)<\/voice_summary>/i);
  if (match && match[1] && match[1].trim()) {
    const summary = prepareTextForSpeech(match[1].trim());
    if (summary) return summary;
  }

  // Fallback: se a IA não gerou a tag, extrai estritamente o início resumido
  const hadCode = /```[\s\S]*?```/.test(fullResponse);
  let textOnly = prepareTextForSpeech(fullResponse);

  if (!textOnly) {
    return hadCode ? 'O resultado e os exemplos de código foram exibidos na tela.' : '';
  }

  // Pega o primeiro parágrafo/bloco
  const firstParagraph = textOnly.split(/\n+/).map(p => p.trim()).filter(Boolean)[0] || textOnly;

  // Limita a 1-2 frases ou ~200 caracteres
  const sentences = firstParagraph.match(/[^.!?\n]+[.!?]+/g) || [firstParagraph];
  let summary = sentences.slice(0, 2).join(' ').trim();
  if (!summary || summary.length > 200) {
    summary = (summary || firstParagraph).slice(0, 200).replace(/[,;:\s]+[^\s]*$/, '') + '...';
  }

  if (hadCode && !summary.toLowerCase().includes('tela') && !summary.toLowerCase().includes('código')) {
    summary += ' Os detalhes e códigos foram exibidos na tela.';
  }

  return summary;
}

module.exports = {
  synthesizeText,
  testConnection,
  listVoices,
  extractVoiceSummary,
  prepareTextForSpeech,
  parseCredentials
};
