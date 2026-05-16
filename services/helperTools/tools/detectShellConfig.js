// services/helperTools/tools/detectShellConfig.js
// Retorna info do shell padrão do usuário + caminho do rc file + existe?

const fs = require("fs/promises");
const platform = require("../platforms/detect");

module.exports = {
  name: "detectShellConfig",
  description:
    "Retorna o shell padrão do usuário (bash/zsh/fish) e o caminho do arquivo de configuração correspondente (.bashrc, .zshrc, config.fish). Use antes de patchFile em configs de shell.",
  schema: { type: "object", properties: {} },
  mutates: false,

  async run() {
    const p = platform.detect();
    const configPath = p.shellConfig;
    let exists = false;
    try {
      await fs.access(configPath);
      exists = true;
    } catch (_) {}
    return {
      ok: true,
      result: {
        shell: p.shell,
        configPath,
        exists,
        home: p.home,
        platform: p.distro,
        packageManager: p.pkg,
      },
    };
  },
};
