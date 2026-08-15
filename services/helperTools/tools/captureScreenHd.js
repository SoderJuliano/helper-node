// services/helperTools/tools/captureScreenHd.js
//
// ⚠️ Esta tool devolvia `image_base64` com o PNG inteiro da tela, e NINGUÉM
// consumia esse campo: toolLoop.js serializa todo resultado como TEXTO
// (`TOOL_RESULT: <nome> <json>`) com corte em 32.000 chars. Na prática, um
// print de 1MB virava ~1,4 milhão de chars de base64, era truncado em 32k e o
// modelo recebia um pedaço corrompido de base64 — nenhuma visão, 32k de
// contexto queimado. Base64 dentro de texto NUNCA vira imagem pro modelo;
// visão só existe no canal de imagem da API.
//
// Agora devolve CAMINHO + texto de OCR, igual ao fluxo de imagem colada
// (services/imageAttachments.js): o caminho é lido pelos providers que
// enxergam imagem, e o OCR serve a todos.
const fs = require('fs/promises');
const { captureFullScreenToFile } = require('../../platform/screenCapture');
const imageAttachments = require('../../imageAttachments');
const TesseractService = require('../../tesseractService');

module.exports = {
  name: 'captureScreenHd',
  description: 'Tira um print HD da tela atual do desenvolvedor. Use quando o OCR inicial da tela for insuficiente ou quando pedirem para você ver a tela (UI, ícones, layout). Retorna o CAMINHO do arquivo de imagem (abra-o com sua ferramenta de leitura para enxergá-lo) e o texto extraído por OCR.',
  schema: {
    type: 'object',
    properties: {},
  },
  mutates: false,

  async run(args, ctx) {
    try {
      const dir = imageAttachments.ensureDir();
      const tmpShot = require('path').join(dir, `shot-${Date.now()}.png`);
      await captureFullScreenToFile(tmpShot);

      let ocrText = '';
      try {
        ocrText = (await TesseractService.getTextFromImage(imageAttachments.readAsBase64(tmpShot))) || '';
      } catch (e) {
        console.warn('[captureScreenHd] OCR falhou:', e && e.message);
      }

      // Não apaga o arquivo: o modelo ainda vai abrir esse caminho no passo
      // seguinte. A limpeza é por idade, em imageAttachments.purgeOld.
      const stat = await fs.stat(tmpShot).catch(() => null);

      return {
        ok: true,
        result: {
          path: tmpShot,
          format: 'png',
          bytes: stat ? stat.size : null,
          ocrText: ocrText.trim().slice(0, 8000),
          note: 'Abra o arquivo em `path` com sua ferramenta de leitura para ver a imagem. `ocrText` é o texto extraído dela.',
        },
      };
    } catch (e) {
      return { ok: false, error: 'Falha ao capturar a tela: ' + e.message };
    }
  },
};
