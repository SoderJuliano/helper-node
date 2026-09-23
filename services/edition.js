/**
 * services/edition.js
 * Edição unificada e leve (100% Lite): modelos de nuvem, Gemini Live,
 * visão multimodal nativa e CLIs nativos locais (AGY, Copilot, Claude).
 * Modelos pesados locais em C++ (Whisper) e Tesseract foram descontinuados.
 */

function getEdition() {
  return 'lite';
}

function isLite() {
  return true;
}

module.exports = { getEdition, isLite };
