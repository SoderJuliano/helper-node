// services/transcriptionService.js
// Serviço universal de transcrição de áudio (STT / Ditado)
// Suporta Google Gemini Multimodal Audio (Free Tier), OpenAI Whisper Cloud, Whisper Local e macOS Nativo.

const fs = require('fs');
const path = require('path');
const configService = require('./configService');
const { transcribeAudio: openAiTranscribe } = require('./translationAssistant/openaiClient');

class TranscriptionService {
  /**
   * Transcreve um arquivo de áudio com base no provedor configurado ou detecção automática.
   * @param {string} audioPath Caminho absoluto do arquivo WAV/OGG
   * @param {Object} [options] Opções adicionais (idioma, etc.)
   * @returns {Promise<string>} Texto transcrito
   */
  async transcribe(audioPath, options = {}) {
    if (!audioPath || !fs.existsSync(audioPath)) {
      throw new Error(`Arquivo de áudio não encontrado para transcrição: ${audioPath}`);
    }

    const preferredProvider = (configService.getTranscriptionProvider ? configService.getTranscriptionProvider() : 'auto') || 'auto';
    const googleKey = (configService.getGoogleApiKey ? configService.getGoogleApiKey() : '').trim();
    const openAiKey = (configService.getOpenIaToken ? configService.getOpenIaToken() : '').trim();
    const hasLocalWhisper = this._hasLocalWhisper();

    // 1. Provedor forçado pelo usuário
    if (preferredProvider === 'google') {
      return await this._transcribeWithGoogle(audioPath, googleKey, options);
    }
    if (preferredProvider === 'openai') {
      return await this._transcribeWithOpenAi(audioPath, openAiKey, options);
    }
    if (preferredProvider === 'local') {
      if (!hasLocalWhisper) {
        throw new Error('Whisper local selecionado, mas os binários (whisper-cli) ou modelos ggml não foram encontrados.');
      }
      return await this._transcribeWithLocal(audioPath, options);
    }
    if (preferredProvider === 'macos') {
      return await this._transcribeWithMacOs(audioPath, options);
    }

    // 2. Modo Automático (Smart Fallback com prioridade no Free Tier do Google)
    const errors = [];

    // Prioridade 1: Google Gemini (Free Tier com a chave do Google AI Studio já cadastrada)
    if (googleKey) {
      try {
        const text = await this._transcribeWithGoogle(audioPath, googleKey, options);
        if (text && text.trim()) return text.trim();
      } catch (err) {
        console.warn('[TranscriptionService] Transcrição via Google Gemini falhou, tentando fallback:', err.message);
        errors.push(`Google: ${err.message}`);
      }
    }

    // Prioridade 2: OpenAI Whisper Cloud
    if (openAiKey) {
      try {
        const text = await this._transcribeWithOpenAi(audioPath, openAiKey, options);
        if (text && text.trim()) return text.trim();
      } catch (err) {
        console.warn('[TranscriptionService] Transcrição via OpenAI Whisper falhou, tentando fallback:', err.message);
        errors.push(`OpenAI: ${err.message}`);
      }
    }

    // Prioridade 3: Whisper Local
    if (hasLocalWhisper) {
      try {
        const text = await this._transcribeWithLocal(audioPath, options);
        if (text && text.trim()) return text.trim();
      } catch (err) {
        console.warn('[TranscriptionService] Transcrição via Whisper local falhou:', err.message);
        errors.push(`Whisper local: ${err.message}`);
      }
    }

    // Prioridade 4: macOS Nativo (se estiver rodando em macOS)
    if (process.platform === 'darwin') {
      try {
        const text = await this._transcribeWithMacOs(audioPath, options);
        if (text && text.trim()) return text.trim();
      } catch (err) {
        console.warn('[TranscriptionService] Transcrição nativa macOS falhou:', err.message);
        errors.push(`macOS: ${err.message}`);
      }
    }

    if (errors.length > 0) {
      throw new Error(`Falha na transcrição de áudio: ${errors.join(' | ')}`);
    }

    throw new Error(
      'Nenhum provedor de transcrição disponível. Configure sua Google API Key (Gratuita) ou Token da OpenAI em Configurações > APIs & Provedores.'
    );
  }

  /**
   * Transcreve áudio via Google Gemini Multimodal Audio (API AI Studio).
   * Free Tier: 15 requisições/min sem custo adicional.
   */
  async _transcribeWithGoogle(audioPath, apiKey, options = {}) {
    if (!apiKey) {
      throw new Error('Google API Key não configurada. Adicione sua chave em Configurações > APIs & Provedores.');
    }

    const fileBuffer = fs.readFileSync(audioPath);
    const base64Audio = fileBuffer.toString('base64');
    const ext = path.extname(audioPath).toLowerCase();
    let mimeType = 'audio/wav';
    if (ext === '.ogg') mimeType = 'audio/ogg';
    else if (ext === '.mp3') mimeType = 'audio/mp3';
    else if (ext === '.m4a') mimeType = 'audio/mp4';

    const lang = options.language || (configService.getLanguage ? configService.getLanguage() : 'pt-br');
    const promptText = lang === 'us-en'
      ? 'Transcribe this audio with absolute accuracy. Return strictly the spoken text, without introductions, markdown formatting, quotes or commentary.'
      : 'Transcreva este áudio com precisão absoluta. Retorne estritamente o texto falado, sem introduções, formatação markdown, aspas ou comentários adicionais.';

    const model = 'gemini-2.0-flash';
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey.trim())}`;

    const payload = {
      contents: [
        {
          role: 'user',
          parts: [
            {
              inlineData: {
                mimeType,
                data: base64Audio
              }
            },
            {
              text: promptText
            }
          ]
        }
      ],
      generationConfig: {
        temperature: 0.0,
        maxOutputTokens: 2048
      }
    };

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      const msg = (errData && errData.error && errData.error.message) ? errData.error.message : `HTTP ${res.status}`;
      throw new Error(`Google Gemini Audio API erro: ${msg}`);
    }

    const data = await res.json();
    let text = '';
    if (data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts) {
      text = data.candidates[0].content.parts.map(p => p.text || '').join('').trim();
    }

    // Limpa eventuais aspas externas ou formatações redundantes
    text = text.replace(/^["'`]+|["'`]+$/g, '').trim();
    return text;
  }

  /**
   * Transcreve via OpenAI Whisper API Cloud.
   */
  async _transcribeWithOpenAi(audioPath, apiKey, options = {}) {
    if (!apiKey) {
      throw new Error('Token da OpenAI não configurado. Adicione seu token em Configurações > APIs & Provedores.');
    }
    const savedLang = configService.getLanguage ? configService.getLanguage() : 'pt-br';
    const whisperLang = options.language || (savedLang === 'us-en' ? 'en' : 'pt');
    return await openAiTranscribe(audioPath, apiKey, { language: whisperLang });
  }

  /**
   * Transcreve via Whisper local binário.
   */
  async _transcribeWithLocal(audioPath, options = {}) {
    const { helpers } = require('../main/globals');
    if (helpers && typeof helpers.transcribeAudio === 'function') {
      return await helpers.transcribeAudio(audioPath, { emitRenderer: false, emitNotifications: false });
    }
    throw new Error('Motor local de transcrição não carregado.');
  }

  /**
   * Transcreve via adapter nativo macOS (Speech.framework).
   */
  async _transcribeWithMacOs(audioPath, options = {}) {
    const macSpeechService = require('./platform/macSpeechService');
    if (macSpeechService && typeof macSpeechService.transcribeFile === 'function') {
      return await macSpeechService.transcribeFile(audioPath, options);
    }
    throw new Error('Módulo nativo macOS Speech não disponível.');
  }

  _hasLocalWhisper() {
    try {
      const { helpers } = require('../main/globals');
      if (helpers && typeof helpers.getWhisperBinaryPath === 'function' && typeof helpers.getWhisperModelPath === 'function') {
        return !!(helpers.getWhisperBinaryPath() && helpers.getWhisperModelPath());
      }
    } catch (_) {}
    return false;
  }
}

module.exports = new TranscriptionService();
