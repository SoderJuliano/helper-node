// services/helperTools/confirmationDetector.js
// Detecta se um texto (de voz Whisper ou input manual) é uma CONFIRMAÇÃO
// pra uma ação pendente. Usado quando overlay de confirmação está aberto.

function _normalize(s) {
  return (s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // tira acentos
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function _matches(text, list) {
  const t = _normalize(text);
  if (!t) return false;
  // Match exato com pequena tolerância: a frase do user deve SER ou COMECAR com
  // a palavra-chave, ou conter ela cercada por espaços.
  for (const raw of list) {
    const w = _normalize(raw);
    if (!w) continue;
    if (t === w) return true;
    if (t.startsWith(w + " ")) return true;
    if (t.endsWith(" " + w)) return true;
    if (t.includes(" " + w + " ")) return true;
  }
  return false;
}

const NEGATIONS = [
  "nao",
  "no",
  "negativo",
  "cancela",
  "cancelar",
  "para",
  "espera",
  "esquece",
  "abortar",
  "abort",
  "deixa",
  "deixa quieto",
];

/**
 * @returns 'yes' | 'no' | null
 */
function classify(text, yesWords) {
  if (_matches(text, NEGATIONS)) return "no";
  if (_matches(text, yesWords)) return "yes";
  return null;
}

module.exports = { classify };
