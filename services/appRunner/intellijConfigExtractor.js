// services/appRunner/intellijConfigExtractor.js
// Extrai variáveis de ambiente e configurações de execução definidas no IntelliJ IDEA (.idea/workspace.xml e .idea/runConfigurations/*.xml)
// e sincroniza com o diretório de dados do Helper Node (~/.helper-node/projects/<projectName>/env.json).

const fs = require('fs');
const path = require('path');
const os = require('os');

class IntelliJConfigExtractor {
  /**
   * Obtém o diretório de armazenamento de configurações do projeto no Helper Node.
   * Ex: ~/.helper-node/projects/meu-projeto/
   */
  static getHelperProjectDir(projectDir) {
    const home = os.homedir();
    const helperRoot = path.join(home, '.helper-node', 'projects');
    const safeName = path.basename(projectDir).replace(/[^a-zA-Z0-9._-]/g, '_');
    const targetDir = path.join(helperRoot, safeName);
    if (!fs.existsSync(targetDir)) {
      try {
        fs.mkdirSync(targetDir, { recursive: true });
      } catch (_) {}
    }
    return targetDir;
  }

  /**
   * Extrai variáveis de ambiente do IntelliJ IDEA para o projeto informado.
   * @param {string} projectDir Raiz do projeto
   * @returns {Object} { envs: Record<string, string>, vmOptions: string[], sourceFile: string }
   */
  static extractEnv(projectDir) {
    if (!projectDir || !fs.existsSync(projectDir)) {
      return { envs: {}, vmOptions: [], sourceFile: '' };
    }

    const envs = {};
    const vmOptions = [];
    let sourceFile = '';

    const ideaDir = path.join(projectDir, '.idea');
    const xmlFilesToScan = [];

    // 1. Procura .idea/runConfigurations/*.xml
    const runConfigsDir = path.join(ideaDir, 'runConfigurations');
    if (fs.existsSync(runConfigsDir)) {
      try {
        fs.readdirSync(runConfigsDir).forEach(file => {
          if (file.endsWith('.xml')) {
            xmlFilesToScan.push(path.join(runConfigsDir, file));
          }
        });
      } catch (_) {}
    }

    // 2. Procura .idea/workspace.xml
    const workspaceXml = path.join(ideaDir, 'workspace.xml');
    if (fs.existsSync(workspaceXml)) {
      xmlFilesToScan.push(workspaceXml);
    }

    // Varre os arquivos XML procurando tags <envs>, <env name="..." value="..." /> e <option name="VM_PARAMETERS" ... />
    for (const xmlFile of xmlFilesToScan) {
      try {
        const content = fs.readFileSync(xmlFile, 'utf8');

        // Extrai <env name="KEY" value="VAL" />
        const envRegex = /<env\s+name=["']([^"']+)["']\s+value=["']([^"']*)["']\s*\/>/gi;
        let match;
        let foundAny = false;
        while ((match = envRegex.exec(content)) !== null) {
          const key = match[1].trim();
          const val = match[2];
          if (key) {
            envs[key] = val;
            foundAny = true;
          }
        }

        // Extrai <option name="VM_PARAMETERS" value="..." />
        const vmMatch = content.match(/<option\s+name=["']VM_PARAMETERS["']\s+value=["']([^"']+)["']/i);
        if (vmMatch && vmMatch[1]) {
          const opts = vmMatch[1].trim().split(/\s+/).filter(Boolean);
          opts.forEach(o => {
            if (!vmOptions.includes(o)) vmOptions.push(o);
          });
        }

        if (foundAny && !sourceFile) {
          sourceFile = xmlFile;
        }
      } catch (_) {}
    }

    // 3. Salva cópia sincronizada na pasta do Helper Node (~/.helper-node/projects/<projectName>/env.json)
    try {
      const helperDir = this.getHelperProjectDir(projectDir);
      const envJsonPath = path.join(helperDir, 'env.json');

      let existing = {};
      if (fs.existsSync(envJsonPath)) {
        try {
          existing = JSON.parse(fs.readFileSync(envJsonPath, 'utf8'));
        } catch (_) {}
      }

      // Mescla com existing (mantendo customizações salvas pelo usuário no Helper Node)
      const mergedEnvs = { ...envs, ...(existing.customEnvs || {}) };
      const dataToSave = {
        projectDir,
        extractedFromIntelliJ: envs,
        customEnvs: existing.customEnvs || {},
        effectiveEnvs: mergedEnvs,
        vmOptions: vmOptions.length ? vmOptions : (existing.vmOptions || []),
        lastSync: new Date().toISOString(),
      };

      fs.writeFileSync(envJsonPath, JSON.stringify(dataToSave, null, 2), 'utf8');
    } catch (e) {
      console.warn('[intellijConfigExtractor] Erro ao sincronizar env.json:', e.message);
    }

    return { envs, vmOptions, sourceFile };
  }

  /**
   * Obtém as variáveis de ambiente efetivas para o projeto (IntelliJ + Helper Node overrides).
   */
  static getEffectiveEnv(projectDir) {
    if (!projectDir) return {};
    const helperDir = this.getHelperProjectDir(projectDir);
    const envJsonPath = path.join(helperDir, 'env.json');

    // Se ainda não extraiu ou não existe, executa extração
    if (!fs.existsSync(envJsonPath)) {
      this.extractEnv(projectDir);
    }

    if (fs.existsSync(envJsonPath)) {
      try {
        const data = JSON.parse(fs.readFileSync(envJsonPath, 'utf8'));
        return data.effectiveEnvs || data.extractedFromIntelliJ || {};
      } catch (_) {}
    }

    return {};
  }
}

module.exports = IntelliJConfigExtractor;
