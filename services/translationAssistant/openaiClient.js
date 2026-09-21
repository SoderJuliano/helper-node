// openaiClient.js — Chamadas à API OpenAI para transcrição e tradução/sugestão.
// Usa fetch/FormData/Blob globais do Node 18+ / Electron 22+ — sem dependências externas.

const fs = require('fs');
const path = require('path');
const configService = require('../configService');
const knowledgeBase = require('../knowledgeBase');
const answerBank = require('../answerBank');
const { supportsReasoningEffort, maxTokensParam, raceWithTimeout, RAG_TIMEOUT_MS } = require('../openAiRealtimeModels');
const { buildTranscriptionPrompt } = require('../techGlossary');

/**
 * Transcreve um arquivo de audio usando gpt-4o-mini-transcribe.
 * Detecção automática de idioma para entrevistas multilíngues.
 */
async function transcribeAudio(audioPath, apiKey, options = {}) {
  // Lê o arquivo em Buffer e cria um Blob (Web API, disponível no Node 18+).
  // Necessário porque global fetch não aceita streams do Node — aceita Blob/Buffer.
  const fileBuffer = fs.readFileSync(audioPath);
  const fileName = path.basename(audioPath);
  const blob = new Blob([fileBuffer]);

  // FormData global (Node 18+): fetch seta o Content-Type multipart/boundary automaticamente
  const form = new FormData();
  form.append('file', blob, fileName);
  form.append('model', 'whisper-1');

  // Suporte total a áudio bilíngue (Português + Inglês / termos de código misturados)
  if (options.language && options.language !== 'auto') {
    form.append('language', options.language);
  }
  form.append('temperature', '0');

  // Vocabulário técnico: enviesa o decoder pros termos do projeto (helper-node, Nexa, SOLID, Spring, Kafka...)
  try {
    const ta = configService.getTranslationAssistantConfig
      ? configService.getTranslationAssistantConfig() : {};
    form.append('prompt', buildTranscriptionPrompt({ background: ta.userBackground || '' }));
  } catch (_) {}

  const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      // Não definir Content-Type aqui — fetch seta o boundary multipart automaticamente
    },
    body: form,
  });

  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message || 'Transcription failed');
  return data.text;
}

/**
 * Envia o texto transcrito para GPT-4o-mini e retorna tradução + sugestão de resposta.
 * Formato esperado na resposta:
 *   TRADUÇÃO: <texto>
 *   RESPOSTA: <sugestão>
 */
// Detecta PEDIDO EXPLÍCITO de código/exemplo na fala do entrevistador.
// "Tell me about yourself, experience with React" → NÃO é pedido de código.
// "Write a function in React that..." / "Show me a code example" → É pedido.
// Mencionar tecnologia (Java, React) sozinho NÃO ativa o modo código.
const CODE_REQUEST_RE = /\b(write (a |an |the )?(function|method|class|snippet|code|example|program|query|component|test|loop|algorithm)|escreva (uma |um |o )?(fun[çc][ãa]o|m[ée]todo|classe|c[oó]digo|exemplo|programa|consulta|componente|teste|loop|algoritmo)|implement (a |an |the )?|implementa (uma |um )?|give (me )?(a |an )?(code|example|snippet|implementation)|me d[êe] (um |o )?(exemplo|c[oó]digo|trecho)|show me (a |an |the |some )?(code|example|snippet|implementation)|me mostre? (um |o |a )?(c[oó]digo|exemplo|trecho)|como (escrever|implementar|fazer) (uma? |um )?(fun[çc][ãa]o|c[oó]digo|m[ée]todo|classe|algoritmo)|how (would|do|to) (you |i )?(write|implement|code|build|create)|c[oó]digo (de|para|que)|exemplo de c[oó]digo|code example|coding (challenge|question|exercise)|leetcode|live coding)\b/i;

async function callGPT(systemPrompt, userContent, model, apiKey, onDelta = null, signal = null) {
  const chatPayload = {
    model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userContent },
    ],
    ...maxTokensParam(model, 600),
    stream: !!onDelta,
  };
  if (supportsReasoningEffort(model)) chatPayload.reasoning_effort = 'low';

  let res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(chatPayload),
    signal,
  });

  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    if (res.status === 400 && chatPayload.reasoning_effort && (data.error?.param === 'reasoning_effort' || String(data.error?.message).toLowerCase().includes('reasoning_effort'))) {
      delete chatPayload.reasoning_effort;
      res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(chatPayload),
        signal,
      });
    }
    if (!res.ok) {
      const finalData = data.error ? data : await res.json().catch(() => ({}));
      throw new Error(finalData.error?.message || 'GPT call failed');
    }
  }

  if (!onDelta) {
    const data = await res.json();
    return data.choices?.[0]?.message?.content || '';
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let content = '';

  while (true) {
    if (signal && signal.aborted) {
      try { reader.cancel(); } catch (_) {}
      break;
    }
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let nl;
    while ((nl = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (!line.startsWith('data:')) continue;
      const payload = line.slice(5).trim();
      if (payload === '[DONE]') continue;
      try {
        const delta = JSON.parse(payload).choices?.[0]?.delta?.content || '';
        if (delta) {
          content += delta;
          onDelta(content);
        }
      } catch (_) {}
    }
  }
  return content;
}

async function getTranslationAndSuggestion(transcript, { userName, userBackground, userBehavioral, targetLanguage }, apiKey, opts = {}) {
  const isCodeRequest = CODE_REQUEST_RE.test(transcript);

  // RAG: base de conhecimento (fatos atuais) + banco de respostas (suas respostas boas).
  let kbBlock = '', bankHint = '';
  try {
    const kbOn = configService.getKnowledgeBaseConfig().enabled;
    const abOn = configService.getAnswerBankConfig().enabled;
    if (kbOn || abOn) {
      const ragWork = (async () => {
        const qEmb = await knowledgeBase.embed(transcript, apiKey);
        const kb = kbOn ? await knowledgeBase.augment(transcript, { token: apiKey, topK: 5, queryEmbedding: qEmb }) : '';
        const bank = abOn ? await answerBank.augment(transcript, { token: apiKey, queryEmbedding: qEmb }) : '';
        return { kb, bank };
      })();
      const result = await raceWithTimeout(ragWork, RAG_TIMEOUT_MS, null);
      if (result) {
        kbBlock = result.kb;
        bankHint = result.bank;
      } else if (kbOn) {
        // Fallback instantâneo (<1ms): se o embedding remoto exceder o timeout, faz busca léxica local em memória
        kbBlock = await knowledgeBase.augment(transcript, { topK: 5 });
      }
    }
  } catch (_) {}
  const ragBlock = [bankHint, kbBlock].filter(Boolean).join('\n\n');
  const userContent = ragBlock ? `${ragBlock}\n\n---\n\n${transcript}` : transcript;
  
  const model = opts.forceModel || (isCodeRequest ? 'gpt-4.1' : 'gpt-4o-mini');

  const defaultBackground = 'Senior Software Engineer com experiência sólida em microsserviços escaláveis, Java (8, 11, 17, 21, 26, Spring Boot, Quarkus), Kotlin, .NET (SDK 5-8), Node.js/NestJS, Python, Go, Angular, React, Vue.js, Apache Kafka, Oracle, MongoDB, AWS, Docker, Kubernetes, CI/CD e observabilidade (Dynatrace, Kibana). Experiência prática em e-commerce e varejo de grande porte (Grupo Casas Bahia).';

  const defaultBehavioral = 'Em problemas de produção ou bugs críticos: mantenho a calma, aviso o time, uso logs e métricas (Dynatrace/Kibana) para isolar a causa-raiz, aplico a correção com segurança e crio testes para evitar regressão. Em conflitos ou divergências técnicas: converso diretamente com o colega, avalio os prós e contras técnicos com foco na simplicidade, entrega e valor para o negócio. Em prazos apertados: priorizo o essencial com o time/PO, quebro entregas em etapas menores e mantenho comunicação transparente sobre impedimentos.';

  const suggestionPrompt = `Você é um COPILOTO DE ENTREVISTAS DE EMPREGO (TÉCNICAS E COMPORTAMENTAIS) PARA ENGENHARIA DE SOFTWARE.
Candidato: ${userName || 'Juliano Soder'}

DADOS DE CONTEXTO DO CANDIDATO (podem estar em português ou inglês):
1. EXPERIÊNCIAS TÉCNICAS E PROJETOS (HARD SKILLS):
${userBackground || defaultBackground}

2. RESPOSTAS E ATITUDES COMPORTAMENTAIS (SOFT SKILLS / SITUAÇÕES / STAR):
${userBehavioral || defaultBehavioral}

SUA MISSÃO:
Sugerir uma resposta curta, direta e pronta para o candidato falar em voz alta em INGLÊS SIMPLES E CONVERSACIONAL (Nível A2/B1).

REGRAS OBRIGATÓRIAS DE ESTILO E INGLÊS (CRÍTICO PARA PRONÚNCIA):
1. INGLÊS SIMPLES, DIRETO E NATURAL (NÍVEL A2/B1):
   - Use vocabulário simples do dia a dia. Prefira verbos universais: "use", "make", "do", "get", "take", "put", "send", "check", "fix", "build", "run", "work", "need", "help", "call", "find", "see", "talk".
   - PROIBIDO usar palavras difíceis, acadêmicas ou pedantes de LLM (NUNCA use: "orchestrate", "encompass", "elucidate", "ubiquitous", "leverage", "paradigm", "furthermore", "hence", "streamline", "bolster", "mitigate", "meticulously", "seamlessly").
   - ZERO NOTAÇÃO MATEMÁTICA OU SÍMBOLOS: NUNCA escreva símbolos como "O(N+1)", "N(0)+1", "Θ(1)", "i++" no texto. Se precisar falar de consultas repetidas ou tempo, escreva como se fala: "the N plus one problem", "very fast", "in a simple loop".
   - O usuário precisa ler a resposta na tela em 1 segundo e conseguir falar em voz alta sem travar na pronúncia e sem gaguejar!

2. CLASSIFICAÇÃO AUTOMÁTICA DE PERGUNTA (TÉCNICA vs COMPORTAMENTAL):
   - Se a pergunta for TÉCNICA (sobre tecnologias, arquitetura, Kafka, Java, Spring, bancos, APIs):
     * Use o contexto 1 (Experiências Técnicas) e cite ferramentas reais (ex: "In my daily work with Spring Boot and Kafka at Casas Bahia, I...").
   - Se a pergunta for COMPORTAMENTAL / SITUACIONAL ("Imagine this...", "Tell me about a time you had a challenge/bug/conflict...", "How do you handle deadlines?"):
     * Use o contexto 2 (Histórias Comportamentais) e responda exatamente com a atitude do candidato, estruturada em STAR simples (Situação -> O que eu faço/fiz -> Resultado seguro).

3. TAMANHO DA RESPOSTA:
   - Resposta falável em 10 a 15 segundos (máximo 2 a 3 frases curtas e conectadas).
   - Formato direto: [Sujeito] + [Verbo] + [Complemento].

4. PRIMEIRA PESSOA:
   - Fale sempre em 1ª pessoa como o candidato ("I usually...", "In my experience at Casas Bahia...", "When a bug happens in production, I first...").

5. TOLERÂNCIA A ERROS DE TRANSCRIÇÃO (STT):
   - Se a pergunta contiver pequenas falhas de áudio, deduza o conceito real e responda sobre ele.

6. PEDIDO DE CÓDIGO:
   - Apenas se expressamente solicitado ("write a function", "show me code"), forneça bloco de código com 1 frase explicativa.

7. DESTAQUE VISUAL:
   - Destaque tecnologias e decisões centrais em **negrito** para leitura visual imediata.

8. FORMATO:
   - Retorne APENAS a resposta a ser falada. NÃO adicione prefixos como "RESPOSTA:", introduções ou saudações.`;

  const translationPrompt = `Você é um tradutor especialista em entrevistas técnicas de TI e engenharia de software.
Sua tarefa é traduzir a fala do entrevistador para o idioma-alvo: ${targetLanguage}.

Regras para a tradução:
- Traduza o texto de forma clara, natural, precisa e direta no jargão técnico de desenvolvimento.
- TOLERÂNCIA A ERROS DE TRANSCRIÇÃO (STT): Se a fala original em áudio tiver pequenas distorções fonéticas de termos técnicos (ex: "a RAIL list" -> "ArrayList", "doctor" -> "Docker", "coube netes" -> "Kubernetes"), deduza o termo técnico real pretendido e traduza corretamente para o conceito pretendido.
- Responda APENAS com o texto traduzido para ${targetLanguage}. NÃO adicione nenhum prefixo como "TRADUÇÃO:", introduções, explicações ou notas de rodapé.`;

  const onDelta = typeof opts.onDelta === 'function' ? opts.onDelta : null;
  const signal = opts.signal || null;

  try {
    if (!onDelta) {
      // Modo não-streaming (Promise.all simples)
      const [suggestionText, translationText] = await Promise.all([
        callGPT(suggestionPrompt, userContent, model, apiKey, null, signal),
        callGPT(translationPrompt, transcript, model, apiKey, null, signal),
      ]);
      console.log(`[TranslationAssistant] modelo usado: ${model} (codeRequest=${isCodeRequest}, stream=off, parallel=on)`);
      return `TRADUÇÃO: ${translationText.trim()}\n\nRESPOSTA: ${suggestionText.trim()}`;
    }

    // Modo streaming (SSE paralelo)
    let currentResponse = '';
    let currentTranslation = '';
    let lastEmit = 0;

    const emit = (force = false) => {
      if (signal && signal.aborted) return;
      const now = Date.now();
      if (force || now - lastEmit > 60) {
        lastEmit = now;
        const combined = `TRADUÇÃO: ${currentTranslation}\n\nRESPOSTA: ${currentResponse}`;
        onDelta(combined);
      }
    };

    await Promise.all([
      callGPT(suggestionPrompt, userContent, model, apiKey, (delta) => {
        currentResponse = delta;
        emit();
      }, signal),
      callGPT(translationPrompt, transcript, model, apiKey, (delta) => {
        currentTranslation = delta;
        emit();
      }, signal),
    ]);

    emit(true); // flush final
    console.log(`[TranslationAssistant] modelo usado: ${model} (codeRequest=${isCodeRequest}, stream=on, parallel=on)`);
    return `TRADUÇÃO: ${currentTranslation}\n\nRESPOSTA: ${currentResponse}`;
  } catch (err) {
    if (signal && signal.aborted) {
      console.log('[TranslationAssistant] request abortado por novo turno.');
      return null;
    }
    if (model !== 'gpt-4o-mini') {
      console.warn(`[TranslationAssistant] ${model} indisponível, fallback para gpt-4o-mini (parallel)`);
      return getTranslationAndSuggestion(transcript, { userName, userBackground, userBehavioral, targetLanguage }, apiKey, { ...opts, forceModel: 'gpt-4o-mini' });
    }
    throw err;
  }
}

/**
 * Avalia a resposta do candidato em PT-BR, com nota de 1-5 estrelas.
 */
async function evaluateUserResponse(question, userAnswer, { userName, userBackground }, apiKey) {
  const systemPrompt = `Você é um coach especialista em entrevistas de emprego técnicas.
Candidato: ${userName || 'candidato'}
Background: ${userBackground || 'não informado'}

Avalie a resposta do candidato à pergunta abaixo.
Responda SEMPRE em português (PT-BR). Seja direto: no máximo 3 frases curtas.
Cite um ponto positivo e um ponto a melhorar, sem rodeios.
Termine com uma nota no formato: ⭐ X/5`;

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `PERGUNTA: ${question}\n\nRESPOSTA DO CANDIDATO: ${userAnswer}` },
      ],
      max_tokens: 200,
    }),
  });

  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message || 'Evaluation failed');
  return data.choices[0].message.content;
}

/**
 * Detecta se quem falou é o entrevistador ou o candidato, usando o idioma como
 * principal sinal: o candidato fala o idioma nativo (targetLanguage), o
 * entrevistador fala um idioma estrangeiro.
 * Retorna 'INTERVIEWER', 'CANDIDATE' ou 'NOISE' (ruído/transcrição inválida).
 * @param {string} transcript
 * @param {string} apiKey
 * @param {string} targetLanguage - idioma nativo do candidato (ex: 'pt-br', 'es', 'en')
 */
async function detectSpeaker(transcript, apiKey, targetLanguage = 'pt-br') {
  const nativeLangMap = {
    'pt-br': 'Portuguese (Brazilian)',
    'pt':    'Portuguese',
    'es':    'Spanish',
    'en':    'English',
    'fr':    'French',
    'de':    'German',
  };
  const nativeLang = nativeLangMap[targetLanguage] || 'Portuguese (Brazilian)';

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: `You are classifying speech from a job interview recording.
Context: The CANDIDATE's native language is ${nativeLang}. The interview is conducted in a foreign language (usually English).

Classification rules — apply in order:
1. Text mainly in ${nativeLang} → CANDIDATE (the candidate is speaking their native language)
2. Text is gibberish, random syllables, a non-interview language (Japanese, Chinese, etc.), or background noise → NOISE
3. Text is in a foreign language AND is a question directed at the interviewee (asks about skills, experience, opinion, background, strengths, weaknesses, past projects) → INTERVIEWER
4. Text is in a foreign language AND is a personal statement or answer (uses "I", "my", "we", "In my experience", describes the speaker's own work or knowledge) → CANDIDATE

Respond with ONLY one word: INTERVIEWER, CANDIDATE, or NOISE.`,
        },
        { role: 'user', content: transcript },
      ],
      max_tokens: 5,
    }),
  });
  const data = await res.json();
  if (!res.ok) return 'INTERVIEWER'; // fallback seguro
  const answer = data.choices[0].message.content.trim().toUpperCase();
  if (answer.includes('NOISE')) return 'NOISE';
  return answer.includes('CANDIDATE') ? 'CANDIDATE' : 'INTERVIEWER';
}

module.exports = { transcribeAudio, getTranslationAndSuggestion, evaluateUserResponse, detectSpeaker };

