const assert = require("assert");
const path = require("path");
const { extractTargetPaths } = require("../services/systemIntegration/argumentHandler");
const { getRegistryCommands } = require("../services/systemIntegration/windowsRegistry");
const { isCliInstalled } = require("../services/systemIntegration/cliInstaller");

async function test() {
  console.log("Iniciando testes de systemIntegration...");

  // 1. Teste de extracao de argumentos (CLI / contexto)
  const fakeArgv = [
    "C:\\nvm4w\\nodejs\\node.exe",
    "C:\\Users\\soder\\Documents\\helper-node\\main.js",
    "--ozone-platform=x11",
    "--no-sandbox",
    "teste.txt",
    "src/index.js",
  ];
  const targets = extractTargetPaths(fakeArgv, "C:\\mock\\dir");
  assert.strictEqual(targets.length, 2, "Deveria extrair exatamente 2 arquivos ignorando flags e executaveis");
  assert.strictEqual(targets[0], path.normalize("C:\\mock\\dir\\teste.txt"));
  assert.strictEqual(targets[1], path.normalize("C:\\mock\\dir\\src\\index.js"));
  console.log("Teste 1: Extracao de argumentos validada com sucesso.");

  // 2. Teste de argumentos absolutos e file://
  const fakeArgv2 = [
    "electron.exe",
    "file:///C:/Users/soder/Documents/arquivo.txt",
  ];
  const targets2 = extractTargetPaths(fakeArgv2, "C:\\mock\\dir");
  assert.strictEqual(targets2.length, 1);
  assert.strictEqual(targets2[0], path.normalize("C:/Users/soder/Documents/arquivo.txt"));
  console.log("Teste 2: Parsing de caminho com protocolo file:// validado.");

  // 3. Teste de geracao de comandos de registro
  const regCommands = getRegistryCommands({ appDir: "C:\\app", execPath: "C:\\app\\electron.exe" });
  assert.ok(regCommands.fileCommand.includes("%1"));
  assert.ok(regCommands.dirBackgroundCommand.includes("%V"));
  assert.ok(regCommands.iconPath.endsWith("windows.ico"));
  console.log("Teste 3: Comandos de registro validados com sucesso.");

  // 4. Teste de status de instalacao CLI
  const installed = await isCliInstalled();
  assert.strictEqual(typeof installed, "boolean");
  console.log("Teste 4: Status do CLI detectado como:", installed);

  console.log("Todos os testes de systemIntegration passaram com sucesso!");
}

test().catch((err) => {
  console.error("Falha nos testes de systemIntegration:", err);
  process.exit(1);
});
