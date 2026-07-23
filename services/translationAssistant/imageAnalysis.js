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

  const systemPrompt = `Você AJUDA O USUÁRIO A RESPONDER o que aparece na captura de tela. NUNCA se limite a descrever a imagem — a sua função é dizer AO USUÁRIO como ele deve responder aquilo.

${userCtx ? userCtx + '\n\n' : ''}=== PASSO 1 — DETECTAR IDIOMA DO CONTEÚDO (OBRIGATÓRIO) ===
Detecte o idioma da pergunta/mensagem/enunciado na imagem (inglês, português, espanhol...).
A sua resposta e QUALQUER sugestão de resposta devem sair NO MESMO IDIOMA da pergunta.
Ex.: pergunta em inglês → sugestão de resposta em inglês. Você pode adicionar uma tradução/explicação curta em PT-BR entre parênteses, mas a resposta sugerida em si fica no idioma da pergunta.

=== PASSO 2 — IDENTIFICAR O TIPO DE CONTEÚDO E RESPONDER ===
• PROBLEMA DE CÓDIGO (LeetCode/HackerRank, stub de método, editor de código): detecte a linguagem PELO CÓDIGO DO STUB (não pelo seletor da UI): "public int[] twoSum"/"class Solution {" → JAVA; "def twoSum(self"/"List[int]" → PYTHON; "#include"/"std::"/"vector<int>" → C++; "function twoSum"/"const " → JAVASCRIPT; "func twoSum" → GO. COMPLETE o stub exato (mesma assinatura) na MESMA linguagem detectada. Nunca troque de linguagem.
• PERGUNTA DE ENTREVISTA / MENSAGEM / PEDIDO DIRIGIDO AO USUÁRIO (pergunta comportamental, "tell me about...", mensagem de chat, e-mail, formulário): entregue uma SUGESTÃO DE RESPOSTA pronta, em primeira pessoa, que o usuário possa falar/enviar, com pelo menos UM exemplo concreto. Personalize com o background do usuário quando houver.
• CONTA / PERGUNTA OBJETIVA / CONCEITO TÉCNICO: resolva/responda direto e dê a resposta final em destaque.

=== FORMATO ===
Comece direto pela AJUDA (sugestão de resposta ou solução), NÃO por uma descrição da tela.
Se for código, entregue em bloco \`\`\`<linguagem>\ncódigo\n\`\`\` na linguagem detectada.
Direto, sem floreio. Sem LaTeX — use símbolos UNICODE (× ÷ ² ³ √ ≈ ≤ ≥ →).`;

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: configService.getOpenAiVisionModel(),
      ...maxTokensParam(configService.getOpenAiVisionModel(), 900),
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
              text: 'Isto apareceu na minha tela. Me diga COMO EU DEVO RESPONDER isto, com um exemplo de resposta pronto, no mesmo idioma da pergunta.',
            },
          ],
        },
      ],
    }),
  });

  const data = await response.json();
  if (!response.ok) throw new Error(data.error?.message || 'OpenAI vision error');
  return data.choices[0].message.content;
}

module.exports = { analyzeInterviewImage };
