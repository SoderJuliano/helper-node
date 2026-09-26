const { uninstallCli } = require("../services/systemIntegration/cliInstaller");

async function run() {
  console.log(`Removendo comando 'helper-node' do sistema (${process.platform})...`);
  const res = await uninstallCli();
  if (res.ok) {
    console.log("Sucesso: Comando CLI removido.");
  } else {
    console.error("Falha ao remover comando CLI:", res.error);
    process.exit(1);
  }
}

run();
