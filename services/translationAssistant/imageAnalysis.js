const fs = require('fs');
const path = require('path');
const configService = require('../configService');
const { maxTokensParam } = require('../openAiRealtimeModels');

async function analyzeInterviewImage(imageInput, apiKey, context = {}) {
  // imageInput: caminho de arquivo OU data URL (data:image/...;base64,...)
  let base64Image, mimeType;

  if (typeof imageInput === 'string' && imageInput.startsWith('data:')) {
    const match = imageInput.match(/^data:(image\/[^;]+);base64,(.+)$/s);
    if (!match) throw new Error('formato de data URL inválido');
    mimeType = match[1];
    base64Image = match[2];
  } else {
    const buffer = fs.readFileSync(imageInput);
    base64Image = buffer.toString('base64');
    const ext = path.extname(imageInput).toLowerCase();
    mimeType = (ext === '.jpg' || ext === '.jpeg') ? 'image/jpeg' : 'image/png';
  }

  // Contexto do usuário (nome + background das Preferências) — personaliza a sugestão.
  let userCtx = '';
  try {
    userCtx = configService.getUserContextBlock ? configService.getUserContextBlock() : '';
  } catch (_) {}

  const systemPrompt = `Você é um copiloto de entrevista técnica e comportamental por visão computacional. Sua missão é ler a tela do entrevistador/recrutador e fornecer a pergunta identificada e a sugestão de resposta ideal para o candidato.

=== REGRA DE ISOLAMENTO (CRÍTICA) ===
1. IGNORE COMPLETAMENTE qualquer janela, painel flutuante, barra lateral ou balão do próprio copiloto/assistente (janelas com títulos como "ASSISTENTE EM TEMPO REAL", "VOCÊ (MICROFONE)", "INTERLOCUTOR (SISTEMA)", "RESPOSTA IA", "PERGUNTA NA TELA", histórico de transcrição do assistente, etc.).
2. NUNCA responda nem repita perguntas que estão apenas dentro do histórico do assistente.
3. FOQUE EXCLUSIVAMENTE na aplicação do entrevistador: navegador web (página de teste, Digai, Gupy, HackerRank, LeetCode, Codility, TestGorilla, formulários), videochamada (Google Meet, Teams, Zoom), editor de código/IDE, slide ou documento da empresa.

${userCtx ? userCtx + '\n\n' : ''}=== PASSO 1 — IDENTIFICAR E TRANSCREVER O CONTEÚDO ATIVO NA TELA ===
- Localize o enunciado, questão, problema de código ou instrução na tela do recrutador.
- Transcreva o título/enunciado de forma limpa, direta e legível, sem lixo de formatação.
- Se a tela for apenas uma página de orientações/etapas/onboarding/boas-vindas sem uma pergunta ativa a responder, transcreva o tema da página (ex.: "Orientações da etapa: O que acontece depois?").

=== PASSO 2 — DETECTAR O IDIOMA E FORMULAR A RESPOSTA ===
- A sugestão de resposta deve sair NO MESMO IDIOMA da pergunta na tela (se em inglês → resposta em inglês; se em português → resposta em português).
- PROBLEMA DE CÓDIGO (LeetCode, HackerRank, editor de código): detecte a linguagem pelo código/stub na tela. Forneça o código completo da solução e explique a complexidade de tempo/espaço.
- PERGUNTA DE ENTREVISTA / TESTE (técnica, comportamental ou situacional): entregue uma SUGESTÃO DE RESPOSTA pronta em 1ª pessoa ("Eu...", "Na minha experiência...") com um exemplo prático.
- TELA DE ORIENTAÇÃO / INFORMATIVA (sem pergunta ativa): explique resumidamente o que a tela indica e esclareça que é uma tela de orientação/etapa sem necessidade de resposta verbal no momento.

=== FORMATO DE SAÍDA OBRIGATÓRIO ===
Estruture sua resposta EXATAMENTE com os dois marcadores abaixo:

=== PERGUNTA DETECTADA ===
[Enunciado ou título claro da pergunta/conteúdo encontrado na tela do recrutador]

=== RESPOSTA SUGERIDA ===
[Sugestão de resposta pronta, código ou esclarecimento objetivo]`;

  const visionModel = configService.getOpenAiVisionModel() || 'gpt-4o';

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: visionModel,
      ...maxTokensParam(visionModel, 900),
      messages: [
        { role: 'system', content: systemPrompt },
        {
          role: 'user',
          content: [
            {
              type: 'image_url',
              image_url: {
                url: `data:${mimeType};base64,${base64Image}`,
                detail: 'high',
              },
            },
            {
              type: 'text',
              text: 'Analise a tela da entrevista. Identifique a pergunta ou conteúdo exibido pelo recrutador (ignorando janelas do copiloto) e forneça a pergunta detectada e a resposta sugerida nos marcadores especificados.',
            },
          ],
        },
      ],
    }),
  });

  const data = await response.json();
  if (!response.ok) throw new Error(data.error?.message || 'OpenAI vision error');
  const content = data.choices?.[0]?.message?.content || '';

  // Parser dos marcadores
  let detectedQuestion = '';
  let suggestedResponse = '';

  const qMatch = content.match(/=== PERGUNTA DETECTADA ===\s*([\s\S]*?)(?==== RESPOSTA SUGERIDA ===|$)/i);
  const rMatch = content.match(/=== RESPOSTA SUGERIDA ===\s*([\s\S]*)$/i);

  if (qMatch && qMatch[1] && qMatch[1].trim()) {
    detectedQuestion = qMatch[1].trim();
  }
  if (rMatch && rMatch[1] && rMatch[1].trim()) {
    suggestedResponse = rMatch[1].trim();
  }

  if (!suggestedResponse) {
    suggestedResponse = content.trim();
  }

  if (context && context.structured) {
    return {
      question: detectedQuestion || 'Pergunta na tela (captura de visão)',
      response: suggestedResponse,
      fullText: content,
    };
  }

  return suggestedResponse;
}

module.exports = { analyzeInterviewImage };
