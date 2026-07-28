// Claude models available in Claude Code CLI.
// Aliases (opus, sonnet, haiku, fable) map to latest available at runtime.
const { exec } = require('child_process');
const { resolveBinary } = require('./ClaudeCliProcess');

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
      ? `cmd.exe /c "${bin} --print \"/model\" < NUL"`
      : `${bin} --print "/model"`;

    const stdout = await new Promise((resolve, reject) => {
      exec(cmd, { timeout: 4000 }, (err, stdout) => {
        // We only reject if there's no output at all (sometimes warnings trigger code 1 but output is fine)
        if (err && !stdout) reject(err);
        else resolve(stdout);
      });
    });

    const match = stdout.match(/Available:\s*(.+)$/m);
    if (match) {
      const cleanList = match[1].replace(/or\s+a\s+full\s+model\s+ID\.?/i, '');
      const rawIds = cleanList
        .split(',')
        .map(s => s.trim().replace(/\.$/, ''))
        .filter(s => s && s.toLowerCase() !== 'default' && s.toLowerCase() !== 'best');

      if (rawIds.length > 0) {
        const dynamicModels = rawIds.map(id => {
          let label = id;
          if (id === 'sonnet') label = 'Sonnet (latest)';
          else if (id === 'opus') label = 'Opus (latest)';
          else if (id === 'haiku') label = 'Haiku (latest)';
          else if (id === 'fable') label = 'Fable (latest)';
          else {
            try {
              if (id.startsWith('claude-')) {
                const parts = id.split('-');
                const name = parts[1] || '';
                const version = parts.slice(2).join('.') || '';
                label = name.charAt(0).toUpperCase() + name.slice(1);
                if (version) label += ' ' + version;
              } else {
                label = id.charAt(0).toUpperCase() + id.slice(1);
              }
            } catch (_) {}
          }
          return { id, label };
        });

        // Merge to guarantee full model IDs are present
        const combined = [...dynamicModels];
        for (const km of KNOWN_MODELS) {
          if (!combined.some(m => m.id.toLowerCase() === km.id.toLowerCase())) {
            combined.push(km);
          }
        }

        cachedModels = combined;
        lastFetchTime = now;
        return cachedModels;
      }
    }
  } catch (e) {
    console.warn('[ClaudeCliModels] Failed to fetch dynamic models from claude --print /model:', e.message);
  }

  return KNOWN_MODELS;
}

function getDefaultModel() {
  return DEFAULT_MODEL;
}

module.exports = { KNOWN_MODELS, DEFAULT_MODEL, getModels, getDefaultModel };
