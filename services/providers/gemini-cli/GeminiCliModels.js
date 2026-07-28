// Known Antigravity (agy) CLI models. Models are ordered by capability (best first).
const { exec } = require('child_process');
const { resolveBinary } = require('./GeminiCliProcess');

const KNOWN_MODELS = [
  { id: 'gemini-3.6-flash-high',        label: 'Gemini 3.6 Flash (High)'      },
  { id: 'gemini-3.6-flash-medium',      label: 'Gemini 3.6 Flash (Medium)'    },
  { id: 'gemini-3.6-flash-low',         label: 'Gemini 3.6 Flash (Low)'       },
  { id: 'gemini-3.5-flash-high',        label: 'Gemini 3.5 Flash (High)'      },
  { id: 'gemini-3.5-flash-medium',      label: 'Gemini 3.5 Flash (Medium)'    },
  { id: 'gemini-3.5-flash-low',         label: 'Gemini 3.5 Flash (Low)'       },
  { id: 'gemini-3.1-pro-high',          label: 'Gemini 3.1 Pro (High)'        },
  { id: 'gemini-3.1-pro-low',           label: 'Gemini 3.1 Pro (Low)'         },
  { id: 'claude-sonnet-4-6',            label: 'Claude Sonnet 4.6'            },
  { id: 'claude-opus-4-6-thinking',     label: 'Claude Opus 4.6 (Thinking)'   },
  { id: 'gpt-oss-120b-medium',          label: 'GPT-OSS 120B (Medium)'        },
];

const DEFAULT_MODEL = 'gemini-3.5-flash-medium';

let cachedModels = null;
let lastFetchTime = 0;
const CACHE_TTL = 10 * 60 * 1000; // 10 minutes

async function getModels() {
  const now = Date.now();
  if (cachedModels && (now - lastFetchTime < CACHE_TTL)) {
    return cachedModels;
  }

  try {
    const bin = await resolveBinary();
    if (!bin) {
      return KNOWN_MODELS;
    }

    const cmd = process.platform === 'win32'
      ? `cmd.exe /c "${bin} models < NUL"`
      : `${bin} models`;

    const stdout = await new Promise((resolve, reject) => {
      exec(cmd, { timeout: 4000 }, (err, stdout) => {
        if (err) reject(err);
        else resolve(stdout);
      });
    });

    const lines = stdout.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
    if (lines.length > 0) {
      const dynamicModels = lines.map(id => {
        let label = id;
        try {
          const parts = id.split('-');
          if (parts[0] === 'gemini' || parts[0] === 'claude' || parts[0] === 'gpt') {
            const brand = parts[0] === 'gemini' ? 'Gemini' : (parts[0] === 'claude' ? 'Claude' : 'GPT');
            const version = parts[1] || '';
            const type = parts[2] || '';
            const tier = parts.slice(3).join('-') || '';

            let mainPart = brand;
            if (version) mainPart += ' ' + version.charAt(0).toUpperCase() + version.slice(1);
            if (type) mainPart += ' ' + type.charAt(0).toUpperCase() + type.slice(1);
            if (tier) {
              const formattedTier = tier.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
              mainPart += ` (${formattedTier})`;
            }
            label = mainPart;
          }
        } catch (_) {}
        return { id, label };
      });

      // Merge custom model mapping to preserve labels of known models if IDs match
      const mergedModels = dynamicModels.map(m => {
        const known = KNOWN_MODELS.find(k => k.id.toLowerCase() === m.id.toLowerCase());
        return known ? { id: m.id, label: known.label } : m;
      });

      cachedModels = mergedModels;
      lastFetchTime = now;
      return cachedModels;
    }
  } catch (e) {
    console.warn('[GeminiCliModels] Failed to fetch dynamic models from agy models:', e.message);
  }

  // Fallback to hardcoded list if command failed, but don't cache it forever
  return KNOWN_MODELS;
}

function getDefaultModel() {
  return DEFAULT_MODEL;
}

function isKnownModel(id) {
  if (cachedModels) {
    return cachedModels.some(m => m.id === id);
  }
  return KNOWN_MODELS.some(m => m.id === id);
}

module.exports = { KNOWN_MODELS, DEFAULT_MODEL, getModels, getDefaultModel, isKnownModel };
