// services/techGlossary.js
//
// Catálogo de vocabulário para ENVIESAR A TRANSCRIÇÃO (parâmetro `prompt` dos
// endpoints de áudio da OpenAI). Resolve o problema de entrevista técnica em
// PT-BR com termos em inglês: "SOLID", "Spring Boot", "Kafka", "idempotência".
//
// POR QUE ISSO IMPORTA
// O decoder de STT usa o `prompt` como contexto prévio: termos que aparecem ali
// ganham probabilidade. É a forma CERTA de resolver o que o antigo
// `vosk-vocab.json` tentava resolver DEPOIS do erro (tabela de substituição
// "claudio" → "cloud"). Aqui a gente evita o erro em vez de remendar.
//
// CUSTO DE LATÊNCIA: ZERO em rede. O prompt viaja no mesmo request que já é
// feito. O único custo é montar uma string — por isso o resultado é cacheado.
//
// LIMITE DURO: os modelos da família Whisper aceitam ~224 tokens de prompt e
// TRUNCAM o excesso silenciosamente. Despejar o catálogo inteiro seria pior que
// não mandar nada (os termos do fim seriam cortados). Por isso existe o
// selecionador: um núcleo fixo + termos escolhidos por relevância ao contexto.

// ---------------------------------------------------------------------------
// NÚCLEO — sempre entra. São os termos de maior valor: ou aparecem em quase
// toda entrevista de backend/fullstack, ou são os mais massacrados pelo STT
// quando ditos com sotaque brasileiro no meio de uma frase em português.
// ---------------------------------------------------------------------------
const CORE = [
  'SOLID', 'Clean Architecture', 'design patterns', 'code review',
  'Java', 'Spring Boot', 'JavaScript', 'TypeScript', 'Node.js', 'React', 'Python',
  'REST', 'API', 'microserviços', 'Kafka', 'Docker', 'Kubernetes', 'AWS',
  'SQL', 'PostgreSQL', 'Git', 'GitHub', 'CI/CD', 'deploy', 'backend', 'frontend',
  'idempotência', 'escalabilidade', 'observabilidade', 'latência', 'throughput',
];

// ---------------------------------------------------------------------------
// CATÁLOGO — entra por relevância (match com o background do usuário e com o
// que já foi falado na sessão). Foco em tecnologia/programação, incluindo o que
// está em alta em 2026, mais um bloco de termos de fora da área que costumam
// pintar numa entrevista (negócio, RH, finanças).
// ---------------------------------------------------------------------------
const CATALOG = {
  javaSpring: [
    'Jakarta EE', 'Javax', 'Spring Security', 'Spring Data JPA', 'Spring Cloud',
    'Hibernate', 'Maven', 'Gradle', 'JUnit', 'Mockito', 'Lombok', 'JVM',
    'garbage collector', 'Virtual Threads', 'Project Loom', 'GraalVM', 'Quarkus',
    'record', 'stream API', 'Optional', 'JPA', 'Flyway', 'Liquibase',
  ],
  jsWeb: [
    'Next.js', 'Vue', 'Angular', 'Svelte', 'Vite', 'Webpack', 'ESLint', 'Prettier',
    'npm', 'pnpm', 'Deno', 'Bun', 'Express', 'NestJS', 'Jest', 'Vitest', 'Playwright',
    'Cypress', 'hooks', 'server components', 'hydration', 'bundle', 'tree shaking',
    'TailwindCSS', 'Redux', 'Zustand', 'TanStack Query',
  ],
  outrasLinguagens: [
    'Go', 'Golang', 'Rust', 'Kotlin', 'Swift', 'C#', '.NET', 'PHP', 'Laravel',
    'Ruby on Rails', 'Elixir', 'Scala', 'Django', 'FastAPI', 'Flask', 'Pandas', 'NumPy',
  ],
  dadosBanco: [
    'MySQL', 'MongoDB', 'Redis', 'Elasticsearch', 'Cassandra', 'DynamoDB',
    'ORM', 'query', 'índice', 'sharding', 'replicação', 'transação', 'ACID',
    'deadlock', 'N+1', 'migration', 'normalização', 'data lake', 'ETL',
    'Snowflake', 'Databricks', 'Airflow', 'dbt', 'OLAP', 'OLTP',
  ],
  infraCloud: [
    'GCP', 'Azure', 'OpenShift', 'Terraform', 'Ansible', 'Helm', 'Jenkins',
    'GitHub Actions', 'GitLab CI', 'ArgoCD', 'nginx', 'load balancer', 'CDN',
    'serverless', 'Lambda', 'EC2', 'S3', 'EKS', 'VPC', 'IaC', 'blue-green',
    'canary deploy', 'rollback', 'Prometheus', 'Grafana', 'OpenTelemetry',
    'Datadog', 'SRE', 'SLA', 'SLO', 'uptime',
  ],
  arquitetura: [
    'DDD', 'TDD', 'BDD', 'CQRS', 'event sourcing', 'saga', 'circuit breaker',
    'monolito', 'monorepo', 'hexagonal', 'API Gateway', 'service mesh',
    'message broker', 'RabbitMQ', 'SQS', 'pub/sub', 'webhook', 'gRPC', 'GraphQL',
    'WebSocket', 'cache', 'rate limiting', 'backpressure', 'eventual consistency',
    'feature flag', 'refactor', 'tech debt', 'legado',
  ],
  seguranca: [
    'OAuth2', 'JWT', 'OpenID Connect', 'SSO', 'MFA', 'TLS', 'HTTPS', 'CORS',
    'XSS', 'CSRF', 'SQL injection', 'OWASP', 'hash', 'bcrypt', 'criptografia',
    'LGPD', 'GDPR', 'compliance', 'pentest', 'zero trust', 'secret', 'vault',
  ],
  iaDados: [
    'LLM', 'GPT', 'Claude', 'Gemini', 'RAG', 'embeddings', 'vector database',
    'pgvector', 'fine-tuning', 'prompt engineering', 'token', 'context window',
    'MCP', 'Model Context Protocol', 'agentes', 'agentic', 'inferência',
    'hallucination', 'guardrails', 'LangChain', 'Ollama', 'machine learning',
    'deep learning', 'transformer', 'PyTorch', 'TensorFlow', 'MLOps',
    'copiloto', 'AI code review', 'vibe coding',
  ],
  processoTime: [
    'Scrum', 'Kanban', 'sprint', 'daily', 'retrospectiva', 'planning', 'backlog',
    'story points', 'épico', 'pull request', 'merge request', 'branch', 'rebase',
    'merge', 'commit', 'squash', 'trunk based', 'GitFlow', 'pair programming',
    'code owner', 'onboarding', 'mentoria', 'squad', 'tech lead', 'stakeholder',
  ],
  foraDaArea: [
    // Aparecem em entrevista mesmo sem ser o foco: negócio, finanças, RH.
    'startup', 'scale-up', 'IPO', 'M&A', 'valuation', 'runway', 'burn rate',
    'ARR', 'MRR', 'churn', 'ROI', 'KPI', 'OKR', 'B2B', 'B2C', 'SaaS',
    'product market fit', 'roadmap', 'MVP', 'discovery', 'stakeholder',
    'CLT', 'PJ', 'home office', 'híbrido', 'remoto', 'equity', 'stock options',
    'PLR', 'benefícios', 'pretensão salarial', 'soft skills', 'hard skills',
    'fit cultural', 'turnover', 'headcount', 'freelance', 'nearshore',
  ],
};

const ALL_CATALOG_TERMS = Object.values(CATALOG).flat();

// Teto conservador de caracteres para o prompt. ~4 chars/token → ~200 tokens,
// abaixo do limite de ~224 onde os modelos começam a truncar.
const MAX_PROMPT_CHARS = 800;

// Normaliza pra comparação: minúsculas, sem acento, sem pontuação.
function norm(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s+#./-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Escolhe os termos do catálogo mais relevantes ao contexto. Um termo pontua
// quando alguma das suas palavras aparece no contexto — assim "Spring Boot" no
// background puxa o bloco Java inteiro, sem precisar listar tudo à mão.
function pickRelevantTerms(context, budgetChars) {
  const ctx = norm(context);
  if (!ctx) return [];

  const ctxWords = new Set(ctx.split(' ').filter(w => w.length >= 3));
  const scored = [];
  for (const term of ALL_CATALOG_TERMS) {
    const words = norm(term).split(' ').filter(Boolean);
    if (!words.length) continue;
    let hits = 0;
    for (const w of words) {
      if (ctxWords.has(w) || (w.length >= 4 && ctx.includes(w))) hits++;
    }
    if (hits > 0) scored.push({ term, score: hits / words.length });
  }

  scored.sort((a, b) => b.score - a.score || a.term.length - b.term.length);

  const out = [];
  let used = 0;
  for (const { term } of scored) {
    if (used + term.length + 2 > budgetChars) break;
    out.push(term);
    used += term.length + 2;
  }
  return out;
}

// Cache: o prompt só muda quando o contexto muda. Evita refazer a seleção a
// cada segmento de fala (o caminho crítico não paga nada por isso).
let _cacheKey = null;
let _cacheValue = null;

/**
 * Monta o `prompt` de transcrição.
 *
 * @param {object} opts
 * @param {string} [opts.background] - background/currículo do usuário (Configurações).
 * @param {string} [opts.context]    - texto recente da sessão (últimas falas), opcional.
 * @returns {string} prompt pronto pro campo `prompt` do endpoint de áudio.
 */
function buildTranscriptionPrompt({ background = '', context = '' } = {}) {
  const key = `${background}||${context}`;
  if (key === _cacheKey) return _cacheValue;

  const core = CORE.join(', ');
  const budget = MAX_PROMPT_CHARS - core.length - 2;
  const extra = budget > 40 ? pickRelevantTerms(`${background} ${context}`, budget) : [];

  const prompt = extra.length ? `${core}, ${extra.join(', ')}` : core;

  _cacheKey = key;
  _cacheValue = prompt;
  return prompt;
}

module.exports = {
  CORE,
  CATALOG,
  buildTranscriptionPrompt,
  // exportados pra teste
  _pickRelevantTerms: pickRelevantTerms,
  MAX_PROMPT_CHARS,
};
