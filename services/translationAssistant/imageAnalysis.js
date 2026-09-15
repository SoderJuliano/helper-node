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
- TESTES COMPORTAMENTAIS / FIT CULTURAL / PSICOTÉCNICOS (Gupy, Mindsight, Kenoby, Big Five/OCEAN, DISC, ordenação 1 a 3, mais/menos):
  * CALIBRAÇÃO CRÍTICA PARA ENGENHEIRO DE SOFTWARE / DESENVOLVEDOR:
    1. AUTODISCIPLINA E FOCO ANALÍTICO (Conscienciosidade Máxima = Prioridade 1): priorize foco sustentado, persistência em tarefas complexas ("não perco o interesse com facilidade"), prudência analítica ("aguardo ter todas as informações antes de tomar uma decisão", "peso prós e contras") e decisões racionais. NUNCA priorize impulsividade ou decisões precipitadas/no calor do momento.
    2. ESTABILIDADE EMOCIONAL ALTA (Baixo Neuroticismo): calma e segurança ("satisfeito comigo mesmo"). Traços de insegurança ou vulnerabilidade ("desconfortável com alguém observando meu trabalho", "decisões no calor do momento") SEMPRE ficam em ÚLTIMO (3 - menos importante / menos me descreve).
    3. ABERTURA TECNOLÓGICA: curiosidade intelectual e gosto por aprender novas tecnologias ("fascinado por novas tecnologias", "descobrir como usar novas tecnologias").
    4. EXTROVERSÃO EQUILIBRADA (NÃO HIPERATIVA/AGITADA): colaboração técnica em equipe sem passar perfil comercial/agitado. Priorize capacidade analítica, persistência e foco técnico em home-office sobre agitação social constante.
  * Se for ORDENAÇÃO DE ITENS (ex: 1 muito importante a 3 menos importante): entregue a lista numerada exata 1, 2, 3 com o texto original de cada item e termine com a instrução: "Ordene os itens conforme acima e clique em 'Próximo passo' (ou 'Finalizar')."
  * Se for MAIS / MENOS: formate como **MAIS:** [Opção X] / **MENOS:** [Opção Y] + 1 linha de justificativa.
- PERGUNTA DE ENTREVISTA (técnica, comportamental ou situacional): entregue uma SUGESTÃO DE RESPOSTA pronta em 1ª pessoa ("Eu...", "Na minha experiência...") com um exemplo prático.
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
