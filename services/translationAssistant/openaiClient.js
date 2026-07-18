// openaiClient.js — Chamadas à API OpenAI para transcrição e tradução/sugestão.
// Usa fetch/FormData/Blob globais do Node 18+ / Electron 22+ — sem dependências externas.

const fs = require('fs');
const path = require('path');
const configService = require('../configService');
const knowledgeBase = require('../knowledgeBase');
const answerBank = require('../answerBank');
const { supportsReasoningEffort, maxTokensParam, raceWithTimeout, RAG_TIMEOUT_MS } = require('../openAiRealtimeModels');

/**
 * Transcreve um arquivo de audio usando gpt-4o-mini-transcribe.
 * Detecção automática de idioma para entrevistas multilíngues.
 */
async function transcribeAudio(audioPath, apiKey) {
  // Lê o arquivo em Buffer e cria um Blob (Web API, disponível no Node 18+).
  // Necessário porque global fetch não aceita streams do Node — aceita Blob/Buffer.
  const fileBuffer = fs.readFileSync(audioPath);
  const fileName = path.basename(audioPath);
  const blob = new Blob([fileBuffer]);

  // FormData global (Node 18+): fetch seta o Content-Type multipart/boundary automaticamente
  const form = new FormData();
  form.append('file', blob, fileName);
  form.append('model', 'gpt-4o-mini-transcribe');

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

async function getTranslationAndSuggestion(transcript, { userName, userBackground, targetLanguage }, apiKey, opts = {}) {
  const isCodeRequest = CODE_REQUEST_RE.test(transcript);

  // RAG: base de conhecimento (fatos atuais) + banco de respostas (suas respostas boas).
  // Embeda a query UMA vez e compartilha entre os dois → 0 chamada de rede a mais.
  // Tempo real: isso NUNCA pode segurar a resposta além de RAG_TIMEOUT_MS — se
  // a busca (embeddings, chamada de rede) demorar demais, segue sem esse contexto.
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
      if (result) { kbBlock = result.kb; bankHint = result.bank; }
    }
  } catch (_) {}
  const ragBlock = [bankHint, kbBlock].filter(Boolean).join('\n\n');
  const userContent = ragBlock ? `${ragBlock}\n\n---\n\n${transcript}` : transcript;
  // opts.forceModel é usado pelo fallback — sem ele a recursão re-detectaria
  // codeRequest e voltaria pro mesmo modelo quebrado, criando loop infinito.
  const model = opts.forceModel || (isCodeRequest ? 'gpt-4.1' : 'gpt-4o-mini');

  const systemPrompt = `Você é um ASSISTENTE DE ENTREVISTAS DE EMPREGO.
Usuário: ${userName || 'o candidato'}
Background: ${userBackground || 'não informado'}

Sua tarefa ao receber uma fala transcrita do entrevistador:
1. Traduza para ${targetLanguage}.
2. Sugira uma resposta direta NO IDIOMA ORIGINAL do texto.

Regras para a sugestão de resposta:
- Use inglês simples. Nível B2, palavras comuns do dia a dia.
- Evite: leverage → use, thrive → do well, robust → solid, utilize → use.
- Use as versões MODERNAS das tecnologias (Java 21+, Node.js 22+, React 19, Spring Boot 3, etc.). Nunca mencione versões antigas (Java 8, Node 12, etc.) como se fossem atuais.
- NUNCA inclua bloco de código a menos que o entrevistador PEÇA EXPLICITAMENTE um exemplo, implementação ou trecho de código (palavras como: "show me code", "write a function", "example of", "how would you implement", "give me an example", "código de", "exemplo de", "escreva uma função").
- Mencionar uma tecnologia (Java, React, Spring) NÃO é pedido de código — responda apenas com texto.
- Quando o pedido for de código: 1 bloco curto (2-6 linhas) no formato \`\`\`<linguagem>\n<código>\n\`\`\` e máximo 1 frase de contexto antes.
- Quando NÃO houver pedido de código: 2-3 frases curtas em texto puro, sem código.
- Não comece com "Certainly!" ou "Of course!".
- Destaque em **negrito** os termos técnicos-chave (tecnologias, conceitos) na RESPOSTA — facilita o candidato bater o olho.
- Formato obrigatório:
TRADUÇÃO: <texto traduzido>
RESPOSTA: <resposta em inglês — texto puro, OU texto + código apenas se pedido>`;

  // Marcador do formato válido. Filtro anti-filler: em fragmentos/ruído ([Música],
  // frases cortadas) o modelo às vezes "quebra o personagem" e responde "Por favor,
  // forneça a fala transcrita..." / "Entendido. Posso ajudar com..." em vez do formato
  // TRADUÇÃO/RESPOSTA. Quem decide quando responder é o usuário — descartamos qualquer
  // saída sem o marcador do formato (vale nos dois modos, streaming ou não).
  const FORMAT_RE = /TRADU[ÇC][ÃA]O\s*:/i;
  const onDelta = typeof opts.onDelta === 'function' ? opts.onDelta : null;

  const chatPayload = {
    model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userContent },
    ],
    ...maxTokensParam(model, 400),
    stream: !!onDelta,
  };
  // Tradutor: velocidade é inegociável, sempre esforço de raciocínio mínimo
  // (se o modelo aceitar — gpt-4.1/gpt-4o-mini de hoje não aceitam, é no-op).
  if (supportsReasoningEffort(model)) chatPayload.reasoning_effort = 'low';

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(chatPayload),
  });

  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    // Fallback para gpt-4o-mini se o modelo escolhido não estiver disponível.
    if (model !== 'gpt-4o-mini') {
      console.warn(`[TranslationAssistant] ${model} indisponível (${data.error?.message || 'erro'}), fallback para gpt-4o-mini`);
      return getTranslationAndSuggestion(transcript, { userName, userBackground, targetLanguage }, apiKey, { ...opts, forceModel: 'gpt-4o-mini' });
    }
    throw new Error(data.error?.message || 'GPT failed');
  }

  // --- modo NÃO-streaming (compatível) ---
  if (!onDelta) {
    const data = await res.json();
    const content = data.choices?.[0]?.message?.content || '';
    if (!FORMAT_RE.test(content)) {
      console.log('[TranslationAssistant] resposta fora do formato (filler) — descartada');
      return null;
    }
    console.log(`[TranslationAssistant] modelo usado: ${model} (codeRequest=${isCodeRequest}, stream=off)`);
    return content;
  }

  // --- modo STREAMING (SSE) ---
  // Acumula tokens e só começa a emitir DEPOIS que o marcador TRADUÇÃO: aparece —
  // assim filler nunca chega a renderizar. Emissão throttled (~60ms) pra não floodar IPC.
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let content = '';
  let started = false;
  let lastEmit = 0;
  const emit = (force) => {
    if (!started) {
      if (!FORMAT_RE.test(content)) return;
      started = true;
    }
    const now = Date.now();
    if (force || now - lastEmit > 60) { lastEmit = now; onDelta(content); }
  };
  while (true) {
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
        if (delta) { content += delta; emit(false); }
      } catch (_) {}
    }
  }
  if (!started) {
    console.log('[TranslationAssistant] resposta fora do formato (filler) — descartada (stream)');
    return null;
  }
  emit(true); // flush final
  console.log(`[TranslationAssistant] modelo usado: ${model} (codeRequest=${isCodeRequest}, stream=on)`);
  return content;
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

