// services/providers/imageSupport.js
// Como cada provider recebe uma IMAGEM anexada no modo IDE.
//
// Isto existe porque a resposta é diferente pra cada um e a diferença foi
// medida contra os binários reais (2026-08-06), não deduzida da doc:
//
//   claude CLI  -> `--print --permission-mode bypassPermissions` com caminho
//                  absoluto: leu imagem FORA do cwd e descreveu o conteúdo.
//                  Não precisa de --add-dir.
//   agy         -> lê TEXTO fora do cwd numa boa, mas com imagem falha: em
//                  headless a ferramenta de visão pede uma permissão que o
//                  modo -p não consegue perguntar ("auto-denied"), e com
//                  --dangerously-skip-permissions o processo morre. Sem OCR
//                  o usuário cola um print e não recebe nada.
//   copilot CLI -> tem flag própria (`--attachment <path>`), já usada em
//                  CopilotCliProcess.
//   openIa      -> só enxerga pelo canal de visão da API. NÃO adianta deixar
//                  as helperTools lerem o arquivo: TOOL_RESULT é texto, e ler
//                  um PNG devolve bytes. Ver nota sobre base64 abaixo.
//
// Sobre base64: mandar imagem como base64 dentro de texto (prompt ou
// TOOL_RESULT) custa ~1,4 milhão de chars por MB e mesmo assim o modelo não
// enxerga nada — visão só existe no canal de imagem da API, onde o mesmo print
// custa ~1-2 mil tokens. Por isso `inline` significa "vai pelo canal de visão",
// nunca "cola o base64 no prompt".
//
// ── Como adicionar um provider novo (ex.: Kimi Code) ──────────────────────
// Acrescente uma entrada aqui com a chave que o configService usa em
// getAiModel(). Se não souber a capacidade ainda, NÃO adivinhe: deixe de fora
// e o DEFAULT abaixo (caminho + OCR) assume — é o comportamento que degrada
// bem em qualquer CLI que saiba ler arquivo. Depois, teste com um print de
// verdade e ajuste `mode`.

// mode:
//   'path'       caminho absoluto no prompt; o próprio CLI abre a imagem
//   'attachment' flag dedicada do CLI (o provider cuida de passá-la)
//   'inline'     canal de visão da API (base64 no content block, não no texto)
//   'none'       não enxerga imagem de jeito nenhum
// ocr: injetar o texto extraído por OCR no prompt.
//   Sempre true por padrão — mesmo pra quem enxerga, o texto dá ao modelo algo
//   PESQUISÁVEL (nome de classe, nº de linha, mensagem de exceção) pra achar o
//   ponto correspondente no projeto. Pro agy é a única via que sobra.
const PROVIDERS = {
  claudeCli: { mode: 'path',       ocr: true },
  copilotCli: { mode: 'attachment', ocr: true },
  geminiCli: { mode: 'none',       ocr: true, note: 'sem visão em modo -p; OCR é a única via' },
  openIa:    { mode: 'inline',     ocr: true },
  openIaCodex: { mode: 'inline',   ocr: true },
};

// Conservador de propósito: caminho + OCR funciona em qualquer CLI que saiba
// ler arquivo, e o OCR garante que algo chega ao modelo mesmo se não souber.
const DEFAULT = { mode: 'path', ocr: true };

function forProvider(aiModel) {
  return PROVIDERS[aiModel] || DEFAULT;
}

// O provider enxerga a imagem por si só? (usado pra decidir se vale avisar o
// usuário que só o OCR vai chegar)
function seesImages(aiModel) {
  return forProvider(aiModel).mode !== 'none';
}

function wantsOcr(aiModel) {
  return forProvider(aiModel).ocr !== false;
}

module.exports = { forProvider, seesImages, wantsOcr, PROVIDERS, DEFAULT };
