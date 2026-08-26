// services/visionGuide/visionApiClient.js
const fs = require('fs');
const { nativeImage } = require('electron');
const configService = require('../configService');
const { maxTokensParam } = require('../openAiRealtimeModels');

async function fetchWithTimeout(url, options = {}, timeoutMs = 30000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function withTimeout(promise, timeoutMs, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} excedeu ${timeoutMs}ms`)), timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

const MAX_IMG_WIDTH = 1600;
function optimizeToJpegBase64(pngPath) {
  try {
    let img = nativeImage.createFromPath(pngPath);
    const size = img.getSize();
    if (size.width > MAX_IMG_WIDTH) {
      img = img.resize({ width: MAX_IMG_WIDTH, quality: 'good' });
    }
    const jpeg = img.toJPEG(75);
    if (jpeg && jpeg.length) return jpeg.toString('base64');
  } catch (_) {}
  return fs.readFileSync(pngPath).toString('base64');
}

function visionDetailFor(model) {
  return /mini|nano/i.test(model || '') ? 'low' : 'high';
}

function isSimilarToRecentGuidance(text, recentGuidanceList) {
  if (!text || !recentGuidanceList || !recentGuidanceList.length) return false;

  const cleanWords = (str) => {
    return str
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[.,\/#!$%\^&\*;:{}=\-_`~()?"']/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .split(" ")
      .filter(w => w.length > 2);
  };

  const userWords = cleanWords(text);
  if (userWords.length === 0) return false;

  for (const guidance of recentGuidanceList) {
    const guidanceWords = cleanWords(guidance);
    if (guidanceWords.length === 0) continue;

    let matches = 0;
    for (const word of userWords) {
      if (guidanceWords.includes(word)) {
        matches++;
      }
    }

    if (userWords.length >= 3) {
      const userRatio = matches / userWords.length;
      if (userRatio > 0.70) return true;
    } else {
      if (matches === userWords.length && guidanceWords.length <= 4) return true;
    }
  }

  return false;
}

function containsDuplicateCodeBlock(newText, recentList) {
  if (!newText || !recentList || !recentList.length) return false;

  const extractCodeBlocks = (text) => {
    const blocks = [];
    const regex = /```[\s\S]*?```/g;
    let match;
    while ((match = regex.exec(text)) !== null) {
      blocks.push(match[0].replace(/```[a-zA-Z]*\n?|```/g, '').trim());
    }
    return blocks;
  };

  const newBlocks = extractCodeBlocks(newText);
  if (newBlocks.length === 0) return false;

  for (const recentText of recentList) {
    const recentBlocks = extractCodeBlocks(recentText);
    for (const nb of newBlocks) {
      if (recentBlocks.includes(nb)) {
        return true;
      }
    }
  }
  return false;
}

function isSimilarToLastTip(newText, lastTip) {
  if (!newText || !lastTip) return false;

  const clean = (str) => {
    return str
      .toLowerCase()
      .replace(/```[\s\S]*?```/g, '')
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[.,\/#!$%\^&\*;:{}=\-_`~()?"']/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .split(" ")
      .filter(w => w.length > 2);
  };

  const newWords = clean(newText);
  const lastWords = clean(lastTip);
  if (newWords.length === 0 || lastWords.length === 0) return false;

  let matches = 0;
  for (const word of newWords) {
    if (lastWords.includes(word)) {
      matches++;
    }
  }

  const ratio = matches / Math.max(newWords.length, lastWords.length);
  return ratio > 0.75;
}

async function getIdeAutocomplete(prefix, suffix, lang, apiKey) {
  const model = configService.getOpenAiVisionModel() || 'gpt-4o-mini';
  const key = apiKey || configService.getConfig().openIaToken;
  if (!key) return null;

  const systemPrompt = `Você é um assistente de autocomplete de código.
Complete o código onde o cursor está. O usuário enviará o prefixo e o sufixo.
Retorne APENAS o trecho de código exato que deve ser inserido entre o prefixo e o sufixo, sem blocos markdown (\`\`\`), sem explicações, sem texto extra.

REGRAS DE IDIOMA E NOMEAÇÃO (críticas):
- Mantenha rigorosamente a mesma linguagem de programação e o mesmo idioma de identificadores, variáveis, funções e comentários que o usuário já está escrevendo no prefixo e sufixo. A escolha dele tem prioridade máxima.
- Se o usuário estiver escrevendo em inglês (comentários ou variáveis em inglês), complete em inglês. Se estiver escrevendo em português, complete em português. Se for inglês no enunciado, use inglês.`;

  const userPrompt = `Prefixo (antes do cursor):
${prefix}

Sufixo (depois do cursor):
${suffix}

Linguagem: ${lang || 'text'}`;

  try {
    const res = await fetchWithTimeout('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: model,
        max_tokens: 60,
        temperature: 0.2,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ]
      })
    }, 20000);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error?.message || 'OpenAI autocomplete error');
    let suggestion = data.choices?.[0]?.message?.content || '';
    suggestion = suggestion.replace(/^```[\w]*\n/, '').replace(/```$/, '').trimEnd();
    return suggestion;
  } catch (e) {
    console.warn('[vision-guide] getIdeAutocomplete falhou:', e.message);
    return null;
  }
}

module.exports = {
  fetchWithTimeout,
  withTimeout,
  optimizeToJpegBase64,
  visionDetailFor,
  isSimilarToRecentGuidance,
  containsDuplicateCodeBlock,
  isSimilarToLastTip,
  getIdeAutocomplete,
};
