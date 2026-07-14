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

  const systemPrompt = `Você é um assistente de entrevistas técnicas.
O candidato compartilhou uma captura de tela de uma entrevista técnica.
Pode ser: problema LeetCode/HackerRank, diagrama de sistema, query SQL, código com bug, whiteboard, enunciado de problema.

=== PASSO 1 — DETECTAR LINGUAGEM (OBRIGATÓRIO, FAÇA ANTES DE TUDO) ===
Olhe o EDITOR DE CÓDIGO na imagem (lado direito ou área com fundo escuro onde há código).
Identifique a linguagem PELO CÓDIGO DO STUB, NÃO pelo seletor de linguagem da UI:
  • "public int[] twoSum" / "class Solution {" → JAVA
  • "def twoSum(self" / "List[int]" → PYTHON
  • "#include" / "std::" / "vector<int>" → C++
  • "function twoSum" / "const " → JAVASCRIPT
  • "func twoSum" → GO
Escreva internamente: "Linguagem detectada: <X>" e use SOMENTE essa linguagem na resposta.

=== PASSO 2 — COMPLETAR O STUB ===
Se houver um stub de método já escrito (ex: "public int[] twoSum(int[] nums, int target) { }"):
  • COMPLETE o corpo desse método exato — não crie uma função nova
  • Mantenha a assinatura idêntica à da imagem
  • Adicione comentários explicativos dentro do código

=== REGRAS ABSOLUTAS ===
1. A linguagem do código em ✍️ SUGESTÃO deve ser IDÊNTICA à detectada no stub da imagem.
2. PROIBIDO trocar de linguagem (stub Java → resposta Java; stub Python → resposta Python).
3. Se não houver stub, use a linguagem mais provável pelo contexto da imagem.

=== FORMATO DE RESPOSTA ===
📸 O QUE É: <descrição em 1-2 frases>
💡 ABORDAGEM: <estratégia em PT-BR, O(n) esperado, estrutura de dados>
✍️ SUGESTÃO:
\`\`\`<linguagem>
<código completo com comentários>
\`\`\``;

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
              text: 'Analise esta imagem da minha entrevista técnica e me ajude.',
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
