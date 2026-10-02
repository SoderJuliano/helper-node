const { installContextMenu, isContextMenuInstalled } = require("../services/systemIntegration/windowsRegistry");

async function run() {
  console.log("Instalando 'Abrir com Helper Node' no menu de contexto do Windows...");
  const res = await installContextMenu();
  if (res.ok) {
    console.log("Sucesso: Menu de contexto registrado em HKCU (arquivos, pastas e fundo de diretorio).");
  } else {
    console.error("Falha ao registrar menu de contexto:", res.error);
    process.exit(1);
  }
}

run();
