// services/helperTools/tools/captureScreenHd.js
const fs = require('fs/promises');
const path = require('path');
const os = require('os');
const { captureFullScreenToFile } = require('../../platform/screenCapture');

module.exports = {
  name: 'captureScreenHd',
  description: 'Tira um print HD da tela atual do desenvolvedor. Use esta ferramenta quando a extração de texto (OCR) inicial da tela for insuficiente ou quando o desenvolvedor pedir para você ver a tela (ex: analisar UI, ícones, ou layout gráfico). Retorna o arquivo de imagem para você anexar ao seu contexto de visão.',
  schema: {
    type: 'object',
    properties: {},
  },
  mutates: false,

  async run(args, ctx) {
    try {
      const tmpShot = path.join(os.tmpdir(), `helpernode-hd-shot-${Date.now()}.png`);
      await captureFullScreenToFile(tmpShot);
      // O modelo usará a resposta textual indicando onde a imagem está, 
      // ou podemos devolver o buffer base64 se o framework suportar.
      // Retornar a string base64 pode sobrecarregar o log da tool se não tratada.
      // O melhor é informar o path para que a infra a carregue como imagem
      // na proxima iteracao, ou a própria tool pode devolver base64 e a UI trata.
      
      const buf = await fs.readFile(tmpShot);
      const base64 = buf.toString('base64');
      
      // Cleanup do temporario (opicional, ja que enviamos o dado em si)
      fs.unlink(tmpShot).catch(() => {});
      
      return {
        ok: true,
        result: {
          note: "A imagem foi capturada. Use o campo base64 para analisá-la.",
          image_base64: base64,
          format: "png"
        }
      };
    } catch (e) {
      return { ok: false, error: "Falha ao capturar a tela: " + e.message };
    }
  },
};
