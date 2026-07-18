// Known Antigravity (agy) CLI models. Models are ordered by capability (best first).

const KNOWN_MODELS = [
  { id: 'Gemini 3.5 Flash (High)',      label: 'Gemini 3.5 Flash (High)'      },
  { id: 'Gemini 3.5 Flash (Medium)',    label: 'Gemini 3.5 Flash (Medium)'    },
  { id: 'Gemini 3.5 Flash (Low)',       label: 'Gemini 3.5 Flash (Low)'       },
  { id: 'Gemini 3.1 Pro (High)',        label: 'Gemini 3.1 Pro (High)'        },
  { id: 'Gemini 3.1 Pro (Low)',         label: 'Gemini 3.1 Pro (Low)'         },
  { id: 'Claude Sonnet 4.6 (Thinking)', label: 'Claude Sonnet 4.6 (Thinking)' },
  { id: 'Claude Opus 4.6 (Thinking)',   label: 'Claude Opus 4.6 (Thinking)'   },
  { id: 'GPT-OSS 120B (Medium)',        label: 'GPT-OSS 120B (Medium)'        },
];

const DEFAULT_MODEL = 'Gemini 3.5 Flash (Medium)';

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
