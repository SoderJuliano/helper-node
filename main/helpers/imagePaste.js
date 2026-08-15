// main/helpers/imagePaste.js
// Decide o que fazer com uma imagem colada (Ctrl+V) ou capturada.
//
// Modo IDE (projeto aberto)  → grava em disco e anexa o CAMINHO ao contexto.
//   É o cenário "print do console / erro do Dynatrace: ache isso no projeto".
//   Transcrever pra texto perde gráfico, layout e fórmula.
// Fora do modo IDE           → NADA muda: segue o OCR pro input, que é o certo
//   pra "qual dessas alternativas é a correta".
//
// A decisão mora aqui, no main, de propósito. A tentativa anterior desta
// feature morava no renderer e quebrou duas vezes: o evento `paste` do
// Chromium só dispara com campo editável em foco (na tela hero não há), e
// manipular data-URL no renderer antes de um `await` congelava o event loop e
// matava o envio. O renderer agora só repassa bytes e desenha o chip.
const {
  configService, workspace, TesseractService,
  state, helpers,
} = require('../globals.js');

const imageAttachments = require('../../services/imageAttachments.js');
const imageSupport = require('../../services/providers/imageSupport.js');

// Modo IDE = acesso a arquivos ligado E uma pasta de projeto aberta.
//
// ⚠️ NÃO usar workspace.getProjectPath() aqui: ele tem fallback pra
// process.cwd()/homedir e NUNCA devolve vazio, então daria "modo IDE" sempre.
helpers.isIdeProjectMode = function() {
  try {
    if (!configService.getWorkspaceAccessEnabled()) return false;
    return workspace.list().some(a => a.type === 'dir');
  } catch (_) {
    return false;
  }
}

// OCR sem deixar o fluxo cair se falhar: o texto é um bônus (pesquisável pelo
// modelo), menos pro agy, onde é a única coisa que chega.
async function ocrSafe(base64Image) {
  try {
    const text = await TesseractService.getTextFromImage(base64Image);
    return (text || '').trim();
  } catch (e) {
    console.warn('[imagePaste] OCR falhou:', e && e.message);
    return '';
  }
}

// Grava a imagem, registra como anexo do workspace e avisa o renderer.
// Devolve o anexo criado, ou null se não deu.
helpers.attachImageToWorkspace = async function(base64Image, { prefix = 'paste', sender } = {}) {
  let saved;
  try {
    saved = imageAttachments.saveBase64(base64Image, prefix);
  } catch (e) {
    console.warn('[imagePaste] não consegui gravar a imagem:', e && e.message);
    return null;
  }

  const aiModel = helpers.getEffectiveAiModel();
  const ocrText = imageSupport.wantsOcr(aiModel) ? await ocrSafe(base64Image) : '';

  try {
    await workspace.addPath(saved.path, 'file', {
      trustAgy: false,
      meta: { origin: 'paste', ocrText },
    });
  } catch (e) {
    console.warn('[imagePaste] falha ao anexar no workspace:', e && e.message);
    return null;
  }

  // Limpeza oportunista: só apaga o que não está anexado agora.
  try {
    imageAttachments.purgeOld(workspace.list().map(a => a.path));
  } catch (_) {}

  const attachments = workspace.list();
  const created = attachments.find(a => a.path === saved.path) || null;

  const target = sender || (state.mainWindow && !state.mainWindow.isDestroyed()
    ? state.mainWindow.webContents : null);
  if (target) {
    try {
      target.send('image-attached', {
        path: saved.path,
        bytes: saved.bytes,
        ocrChars: ocrText.length,
        // Avisa a UI quando o provider atual NÃO enxerga imagem (agy), pra
        // poder dizer ao usuário que só o texto extraído vai chegar.
        providerSeesImage: imageSupport.seesImages(aiModel),
        attachments,
      });
    } catch (_) {}
  }

  console.log(`[imagePaste] imagem anexada: ${saved.path} (${saved.bytes}B, OCR ${ocrText.length} chars, provider ${aiModel})`);
  return created;
}

// Imagem colada mais recente em base64, para providers de modo 'inline'
// (ChatGPT/Codex), que só enxergam pelo canal de visão da API — caminho no
// prompt não adianta pra eles, e ferramenta também não: TOOL_RESULT é texto.
// Devolve null para todo o resto, que recebe o caminho.
helpers.inlineImageForProvider = function(aiModel) {
  try {
    if (imageSupport.forProvider(aiModel).mode !== 'inline') return null;
    const pasted = workspace.list().filter(a => a.origin === 'paste' && a.path);
    if (!pasted.length) return null;
    const alvo = pasted[pasted.length - 1];
    const fs = require('fs');
    if (!fs.existsSync(alvo.path)) return null;
    return imageAttachments.readAsBase64(alvo.path);
  } catch (e) {
    console.warn('[imagePaste] falha ao carregar imagem inline:', e && e.message);
    return null;
  }
}

// Texto de contexto das imagens coladas, usado por appendAttachmentsContext.
// Separado pra manter a formatação do prompt num lugar só.
helpers.pastedImageContextFor = function(att) {
  if (!att || att.origin !== 'paste') return null;
  let block = `- IMAGEM colada pelo usuário: ${att.path}\n`;
  if (att.ocrText) {
    block += `  Texto extraído por OCR desta imagem (use pra localizar o trecho correspondente no projeto):\n`;
    block += `  """\n${att.ocrText.split('\n').map(l => '  ' + l).join('\n')}\n  """\n`;
  }
  return block;
}
