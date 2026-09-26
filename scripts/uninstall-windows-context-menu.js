const { uninstallContextMenu } = require("../services/systemIntegration/windowsRegistry");

async function run() {
  console.log("Removendo 'Abrir com Helper Node' do menu de contexto do Windows...");
  const res = await uninstallContextMenu();
  if (res.ok) {
    console.log("Sucesso: Chaves de menu de contexto removidas de HKCU.");
  } else {
    console.error("Falha ao remover menu de contexto:", res.error);
    process.exit(1);
  }
}

run();
