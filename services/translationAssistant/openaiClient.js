// openaiClient.js — Chamadas à API OpenAI para transcrição e tradução/sugestão.
// Usa fetch/FormData/Blob globais do Node 18+ / Electron 22+ — sem dependências externas.

const fs = require('fs');
const path = require('path');

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
const CODE_TOPICS_RE = /\b(java|spring|node\.?js|react|angular|vue|typescript|javascript|python|c\+\+|c#|\.net|golang|rust|kotlin|swift|php|ruby|sql|postgres|mysql|mongodb|redis|docker|kubernetes|git|ci\/cd|rest.?api|graphql|microservice|garbage.collec|thread|async|promise|closure|design.pattern|solid|algorithm|data.struct|hash.?map|array|linked.list|tree|heap|stack|queue|recursion|big.?o|time.complex|memory.manag|jvm|bytecode|compiler|interpreter|llm|machine.learning|ml|neural|tensorflow|pytorch)\b/i;

async function getTranslationAndSuggestion(transcript, { userName, userBackground, targetLanguage }, apiKey) {
  const isCodeTopic = CODE_TOPICS_RE.test(transcript);
  const model = isCodeTopic ? 'gpt-5.1-codex-mini' : 'gpt-4o-mini';

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
- Se a pergunta envolve código: dê 1 exemplo de código curto (2-5 linhas) que ilustre a resposta, no bloco:\n\`\`\`<linguagem>\n<código>\n\`\`\`
- Máximo 3 frases de texto + 1 bloco de código (se aplicável). Sem parágrafos longos.
- Não comece com "Certainly!" ou "Of course!".
- Formato obrigatório:
TRADUÇÃO: <texto traduzido>
RESPOSTA: <resposta em inglês com código se necessário>`;

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: transcript },
      ],
      max_tokens: 400,
    }),
  });

  const data = await res.json();
  if (!res.ok) {
    // Fallback para gpt-4o-mini se o modelo codex não estiver disponível
    if (model !== 'gpt-4o-mini') {
      console.warn(`[TranslationAssistant] ${model} indisponível, usando gpt-4o-mini`);
      return getTranslationAndSuggestion(transcript, { userName, userBackground, targetLanguage }, apiKey);
    }
    throw new Error(data.error?.message || 'GPT failed');
  }
  console.log(`[TranslationAssistant] modelo usado: ${model} (codeTopic=${isCodeTopic})`);
  return data.choices[0].message.content;
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

