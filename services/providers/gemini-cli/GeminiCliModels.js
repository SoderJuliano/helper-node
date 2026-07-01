// Known Gemini CLI models. The CLI itself doesn't expose a --list-models flag,
// so we maintain a curated list. Models are ordered by capability (best first).

const KNOWN_MODELS = [
  { id: 'gemini-2.5-pro',        label: 'Gemini 2.5 Pro'        },
  { id: 'gemini-2.5-flash',      label: 'Gemini 2.5 Flash'      },
  { id: 'gemini-2.0-flash',      label: 'Gemini 2.0 Flash'      },
  { id: 'gemini-2.0-flash-lite', label: 'Gemini 2.0 Flash Lite' },
  { id: 'gemini-1.5-pro',        label: 'Gemini 1.5 Pro'        },
  { id: 'gemini-1.5-flash',      label: 'Gemini 1.5 Flash'      },
];

const DEFAULT_MODEL = 'gemini-2.5-flash';

function getModels() {
  return KNOWN_MODELS;
}

function getDefaultModel() {
  return DEFAULT_MODEL;
}

function isKnownModel(id) {
  return KNOWN_MODELS.some(m => m.id === id);
}

module.exports = { KNOWN_MODELS, DEFAULT_MODEL, getModels, getDefaultModel, isKnownModel };
