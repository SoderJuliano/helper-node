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
  description: 'Tira uma captura de tela (print/screenshot HD) em tempo real da tela do desenvolvedor (desktop, janelas abertas, navegador Brave/Chrome, editores, etc). Suporta capturar uma janela específica (ex: Brave, Chrome) ou telas secundárias em multi-monitor. Use sempre que o usuário pedir para você ver a tela, olhar o navegador/código/layout, inspecionar erros visuais ou tirar print. Retorna o caminho da imagem, metadados da janela/tela e o texto OCR extraído.',
  schema: {
    type: 'object',
    properties: {
      targetApp: {
        type: 'string',
        description: 'Nome opcional do aplicativo ou janela a ser capturada (ex: "brave", "chrome", "edge", "code", "browser"). Se omitido, captura a tela do sistema.',
      },
      displayIndex: {
        type: 'integer',
        description: 'Índice opcional do monitor em setups multi-monitor (0 para principal, 1 para secundário).',
      },
    },
  },
  mutates: false,

  async run(args = {}, ctx = {}) {
    try {
      const dir = imageAttachments.ensureDir();
      const tmpShot = require('path').join(dir, `shot-${Date.now()}.png`);
      const captureInfo = await captureFullScreenToFile(tmpShot, {
        targetApp: args.targetApp,
        displayIndex: args.displayIndex,
      });

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
          sourceName: captureInfo && captureInfo.sourceName ? captureInfo.sourceName : 'Tela Principal',
          sourceType: captureInfo && captureInfo.sourceType ? captureInfo.sourceType : 'screen',
          availableWindows: captureInfo && captureInfo.availableWindows ? captureInfo.availableWindows : [],
          ocrText: ocrText.trim().slice(0, 8000),
          note: 'A imagem capturada foi injetada no seu canal de visão multimodal de alta resolução. `ocrText` é o texto indexado dela.',
        },
      };
    } catch (e) {
      return { ok: false, error: 'Falha ao capturar a tela: ' + e.message };
    }
  },
};
