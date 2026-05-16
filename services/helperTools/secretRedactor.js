// services/helperTools/secretRedactor.js
// Substitui possíveis segredos por [REDACTED] ANTES de mandar conteúdo
// de arquivo pra IA na nuvem. Não é à prova de bala — é defesa em profundidade.

const PATTERNS = [
  // PEM / chaves privadas inteiras
  {
    name: "PEM private key block",
    re: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  },

  // Bearer / Authorization
  { name: "Bearer token", re: /Bearer\s+[A-Za-z0-9._\-+/=]{16,}/gi },

  // JWT
  { name: "JWT", re: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g },

  // AWS Access Key
  { name: "AWS Access Key", re: /\bAKIA[0-9A-Z]{16}\b/g },

  // OpenAI
  { name: "OpenAI key", re: /\bsk-[A-Za-z0-9]{20,}\b/g },

  // GitHub
  { name: "GitHub token", re: /\bgh[pousr]_[A-Za-z0-9]{20,}\b/g },

  // Google API
  { name: "Google API key", re: /\bAIza[0-9A-Za-z\-_]{35}\b/g },

  // Slack
  { name: "Slack token", re: /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/g },

  // Genérico KEY/SECRET/PASSWORD em formato KEY=value ou KEY: value
  // Cobre .env, application.properties, etc.
  {
    name: "ENV-style secret",
    re: /\b((?:password|passwd|secret|api[_-]?key|access[_-]?token|auth[_-]?token|private[_-]?key|client[_-]?secret)\s*[:=]\s*)(['"]?)([^\s'"]{6,})\2/gi,
    replace: (_m, prefix, q, _val) => `${prefix}${q}[REDACTED]${q}`,
  },

  // postgres://user:pass@host
  {
    name: "URL with credentials",
    re: /\b([a-z][a-z0-9+.\-]*:\/\/)([^:\/\s]+):([^@\s]+)@/gi,
    replace: (_m, scheme, user, _pass) => `${scheme}${user}:[REDACTED]@`,
  },
];

/**
 * @returns {{ text: string, redactedCount: number, hits: Array<{name:string,count:number}> }}
 */
function redact(text) {
  if (!text) return { text: text || "", redactedCount: 0, hits: [] };
  let out = text;
  let total = 0;
  const hits = [];
  for (const p of PATTERNS) {
    let count = 0;
    if (p.replace) {
      out = out.replace(p.re, (...args) => {
        count++;
        return p.replace(...args);
      });
    } else {
      out = out.replace(p.re, () => {
        count++;
        return "[REDACTED]";
      });
    }
    if (count > 0) {
      hits.push({ name: p.name, count });
      total += count;
    }
  }
  return { text: out, redactedCount: total, hits };
}

module.exports = { redact };
