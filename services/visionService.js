// services/visionService.js
// Serviço Multimodal de Visão em Nuvem (100% livre de OCR local/Tesseract legado).
// Suporta:
//   Tier 1: Google Gemini Vision API (gemini-3.5-flash-lite / gemini-3.8-flash / gemini-flash-latest)
//   Tier 2: OpenAI Vision API (gpt-4o-mini / gpt-4o)

const fs = require('fs');
const path = require('path');
const https = require('https');
const crypto = require('crypto');
const configService = require('./configService');

class VisionService {
  constructor() {
    this._geminiModels = ['gemini-3.5-flash-lite', 'gemini-3.8-flash', 'gemini-flash-latest'];
    this._cache = new Map();
  }

  /**
   * Converte qualquer formato de entrada (data URL, base64 puro ou path) em Buffer e base64 limpo.
   */
  _normalizeImageInput(imageInput) {
    if (!imageInput) return null;

    let mimeType = 'image/png';
    let base64Data = '';
    let buffer = null;

    if (Buffer.isBuffer(imageInput)) {
      buffer = imageInput;
      base64Data = buffer.toString('base64');
    } else if (typeof imageInput === 'string') {
      const trimmed = imageInput.trim();
      if (trimmed.startsWith('data:image/')) {
        const match = trimmed.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/s);
        if (match) {
          mimeType = match[1];
          base64Data = match[2];
          buffer = Buffer.from(base64Data, 'base64');
        }
      } else if (trimmed.length > 500 && !trimmed.includes('\n') && /^[A-Za-z0-9+/=]+$/.test(trimmed.slice(0, 100))) {
        base64Data = trimmed;
        buffer = Buffer.from(base64Data, 'base64');
      } else if (fs.existsSync(trimmed)) {
        buffer = fs.readFileSync(trimmed);
        base64Data = buffer.toString('base64');
        const ext = path.extname(trimmed).toLowerCase();
        if (ext === '.jpg' || ext === '.jpeg') mimeType = 'image/jpeg';
        else if (ext === '.webp') mimeType = 'image/webp';
        else if (ext === '.bmp') mimeType = 'image/bmp';
      }
    }

    if (!base64Data || !buffer) return null;
    return { mimeType, base64Data, buffer };
  }

  /**
   * Extrai com máxima fidelidade o conteúdo de texto, fórmulas e elementos da imagem.
   * @param {string|Buffer} imageInput Data URL, path de arquivo ou base64
   * @param {Object} [options]
   * @returns {Promise<string>}
   */
  async extractContentFromImage(imageInput, options = {}) {
    const normalized = this._normalizeImageInput(imageInput);
    if (!normalized) {
      console.warn('[VisionService] Imagem inválida ou vazia recebida para análise.');
      return '';
    }

    const hash = crypto.createHash('md5').update(normalized.buffer).digest('hex');
    const cached = this._cache.get(hash);
    if (cached && (Date.now() - cached.timestamp < 120000)) {
      console.log(`[VisionService] ⚡ Usando cache em memória para a imagem (${hash.slice(0, 8)})`);
      return cached.text;
    }

    const _saveAndReturn = (text) => {
      const clean = (text || '').trim();
      this._cache.set(hash, { text: clean, timestamp: Date.now() });
      if (this._cache.size > 20) {
        const oldestKey = this._cache.keys().next().value;
        this._cache.delete(oldestKey);
      }
      return clean;
    };

    const googleKey = (configService.getGoogleApiKey ? configService.getGoogleApiKey() : '').trim();
    const openAiToken = (configService.getOpenIaToken ? configService.getOpenIaToken() : '').trim();

    // 1. Tier 1: Google Gemini Multimodal Vision API (Alta velocidade & Free Tier)
    if (googleKey) {
      if (this._lastQuotaErrorTime && (Date.now() - this._lastQuotaErrorTime < 60000)) {
        console.warn('[VisionService] Google Gemini Vision em cooldown temporário por quota esgotada (HTTP 429).');
      } else {
        try {
          console.log('[VisionService] Analisando imagem via Google Gemini Vision...');
          const result = await this._analyzeWithGoogleGemini(normalized, googleKey, options);
          if (result && result.trim()) {
            console.log(`[VisionService] ✅ Visão Google Gemini extraiu ${result.length} caracteres com sucesso`);
            return _saveAndReturn(result);
          }
        } catch (geminiErr) {
          console.warn('[VisionService] Google Gemini Vision falhou, tentando fallback:', geminiErr.message);
        }
      }
    }

    // 2. Tier 2: OpenAI Vision API (gpt-4o-mini / gpt-4o)
    if (openAiToken) {
      try {
        console.log('[VisionService] Analisando imagem via OpenAI Vision...');
        const result = await this._analyzeWithOpenAi(normalized, openAiToken, options);
        if (result && result.trim()) {
          console.log(`[VisionService] ✅ Visão OpenAI extraiu ${result.length} caracteres com sucesso`);
          return _saveAndReturn(result);
        }
      } catch (openAiErr) {
        console.warn('[VisionService] OpenAI Vision falhou, tentando fallback:', openAiErr.message);
      }
    }

    return _saveAndReturn('');
  }

  /**
   * Chamada HTTP para API Gemini Vision do Google AI Studio
   */
  async _analyzeWithGoogleGemini({ mimeType, base64Data }, apiKey, options = {}) {
    const promptText = options.prompt ||
      'Transcreva com absoluta fidelidade todo o conteúdo da imagem: enunciados completos, opções de múltipla escolha (A, B, C, D, E), funções e fórmulas matemáticas (notação exata de funções f(x), frações, potências, raízes, limites, integrais, matrizes), código, comandos de terminal ou mensagens de erro. Preserve rigorosamente a estrutura, a ordem e os símbolos matemáticos, sem omitir ou resumir nada.';

    let lastError = null;
    const models = ['gemini-3.5-flash-lite', 'gemini-3.8-flash', 'gemini-flash-latest'];
    for (const model of models) {
      try {
        const text = await this._callGeminiApi(model, mimeType, base64Data, promptText, apiKey);
        if (text && text.trim()) return text.trim();
      } catch (err) {
        lastError = err;
        console.warn(`[VisionService] Gemini modelo ${model} falhou (${err.message}), tentando próximo modelo...`);
        if (err.message && (err.message.includes('429') || err.message.includes('quota') || err.message.includes('ResourceExhausted'))) {
          this._lastQuotaErrorTime = Date.now();
          console.warn('[VisionService] Quota esgotada na chave do Gemini (429). Interrompendo tentativas.');
          break;
        }
      }
    }
    throw lastError || new Error('Todos os modelos do Google Gemini Vision falharam.');
  }

  _callGeminiApi(model, mimeType, base64Data, promptText, apiKey) {
    return new Promise((resolve, reject) => {
      const postData = JSON.stringify({
        contents: [{
          role: 'user',
          parts: [
            { inlineData: { mimeType, data: base64Data } },
            { text: promptText }
          ]
        }],
        generationConfig: {
          temperature: 0.2,
          maxOutputTokens: 4096,
        }
      });

      const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
      const req = https.request(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(postData),
        },
        timeout: 8000,
      }, (res) => {
        let body = '';
        res.on('data', (c) => { body += c; });
        res.on('end', () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            try {
              const json = JSON.parse(body);
              const part = json.candidates &&
                           json.candidates[0] &&
                           json.candidates[0].content &&
                           json.candidates[0].content.parts &&
                           json.candidates[0].content.parts[0];
              const text = (part && part.text) ? part.text.trim() : '';
              resolve(text);
            } catch (pErr) {
              reject(new Error(`Falha no parse do retorno Gemini: ${pErr.message}`));
            }
          } else {
            reject(new Error(`HTTP ${res.statusCode}: ${body.slice(0, 250)}`));
          }
        });
      });

      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Timeout ao conectar na API do Google Gemini Vision (8s).'));
      });
      req.on('error', (e) => reject(e));
      req.write(postData);
      req.end();
    });
  }

  /**
   * Chamada HTTP para OpenAI Vision (gpt-4o-mini ou gpt-4o)
   */
  async _analyzeWithOpenAi({ mimeType, base64Data }, apiKey, options = {}) {
    const promptText = options.prompt ||
      'Transcreva com absoluta fidelidade todo o conteúdo da imagem: enunciados completos, opções de múltipla escolha (A, B, C, D, E), funções e fórmulas matemáticas (notação exata de funções f(x), frações, potências, raízes, limites, integrais, matrizes), código, comandos de terminal ou mensagens de erro. Preserve rigorosamente a estrutura, a ordem e os símbolos matemáticos, sem omitir ou resumir nada.';

    const model = (configService.getOpenAiVisionModel ? configService.getOpenAiVisionModel() : 'gpt-4o-mini') || 'gpt-4o-mini';

    return new Promise((resolve, reject) => {
      const dataUrl = `data:${mimeType};base64,${base64Data}`;
      const postData = JSON.stringify({
        model,
        messages: [{
          role: 'user',
          content: [
            { type: 'text', text: promptText },
            { type: 'image_url', image_url: { url: dataUrl } }
          ]
        }],
        max_tokens: 2048,
        temperature: 0.2,
      });

      const req = https.request('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
          'Content-Length': Buffer.byteLength(postData),
        },
        timeout: 15000,
      }, (res) => {
        let body = '';
        res.on('data', (c) => { body += c; });
        res.on('end', () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            try {
              const json = JSON.parse(body);
              const text = json.choices && json.choices[0] && json.choices[0].message && json.choices[0].message.content
                ? json.choices[0].message.content.trim()
                : '';
              resolve(text);
            } catch (pErr) {
              reject(new Error(`Falha no parse do retorno OpenAI: ${pErr.message}`));
            }
          } else {
            reject(new Error(`HTTP ${res.statusCode}: ${body.slice(0, 250)}`));
          }
        });
      });

      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Timeout ao conectar na API OpenAI Vision (15s).'));
      });
      req.on('error', (e) => reject(e));
      req.write(postData);
      req.end();
    });
  }
}

module.exports = new VisionService();
