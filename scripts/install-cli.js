const { installCli, isCliInstalled } = require("../services/systemIntegration/cliInstaller");

async function run() {
  console.log(`Instalando comando 'helper-node' no sistema (${process.platform})...`);
  const res = await installCli();
  if (res.ok) {
    console.log(`Sucesso: Comando CLI instalado em: ${res.path}`);
  } else {
    console.error("Falha ao instalar comando CLI:", res.error);
    process.exit(1);
  }
}

run();
