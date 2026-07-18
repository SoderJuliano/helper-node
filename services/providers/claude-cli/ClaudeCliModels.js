// Claude models available in Claude Code CLI.
// Aliases (opus, sonnet, haiku, fable) map to latest available at runtime.

const KNOWN_MODELS = [
  { id: 'claude-fable-5',           label: 'Fable 5'          },
  { id: 'claude-opus-4-8',          label: 'Opus 4.8'         },
  { id: 'claude-sonnet-4-6',        label: 'Sonnet 4.6'       },
  { id: 'claude-haiku-4-5-20251001',label: 'Haiku 4.5'        },
  { id: 'sonnet',                   label: 'Sonnet (latest)'  },
  { id: 'opus',                     label: 'Opus (latest)'    },
  { id: 'haiku',                    label: 'Haiku (latest)'   },
];

const DEFAULT_MODEL = 'claude-sonnet-4-6';

function getModels()       { return KNOWN_MODELS; }
function getDefaultModel() { return DEFAULT_MODEL; }

module.exports = { KNOWN_MODELS, DEFAULT_MODEL, getModels, getDefaultModel };
