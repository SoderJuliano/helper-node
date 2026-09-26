const { ipcMain } = require("electron");
const systemIntegration = require("../../services/systemIntegration");

module.exports = function registerSystemIntegrationIpc() {
  ipcMain.handle("system:install-context-menu", async () => {
    return await systemIntegration.windowsRegistry.installContextMenu();
  });

  ipcMain.handle("system:uninstall-context-menu", async () => {
    return await systemIntegration.windowsRegistry.uninstallContextMenu();
  });

  ipcMain.handle("system:is-context-menu-installed", async () => {
    return await systemIntegration.windowsRegistry.isContextMenuInstalled();
  });

  ipcMain.handle("system:install-cli", async () => {
    return await systemIntegration.cliInstaller.installCli();
  });

  ipcMain.handle("system:uninstall-cli", async () => {
    return await systemIntegration.cliInstaller.uninstallCli();
  });

  ipcMain.handle("system:is-cli-installed", async () => {
    return await systemIntegration.cliInstaller.isCliInstalled();
  });

  ipcMain.handle("system:get-status", async () => {
    const isWindows = systemIntegration.windowsRegistry.isWindows();
    const contextMenu = isWindows
      ? await systemIntegration.windowsRegistry.isContextMenuInstalled()
      : false;
    const cli = await systemIntegration.cliInstaller.isCliInstalled();

    return {
      platform: process.platform,
      contextMenuInstalled: contextMenu,
      cliInstalled: cli,
    };
  });
};
