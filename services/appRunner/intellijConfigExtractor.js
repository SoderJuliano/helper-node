// services/appRunner/intellijConfigExtractor.js
// Extrai variáveis de ambiente e configurações de execução definidas no IntelliJ IDEA (.idea/workspace.xml e .idea/runConfigurations/*.xml)
// e sincroniza com o diretório de dados do Helper Node (~/.helper-node/projects/<projectName>/runner-config.json).

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
   * Caminho para o arquivo principal de configuração de execução do projeto.
   */
  static getConfigPath(projectDir) {
    return path.join(this.getHelperProjectDir(projectDir), 'runner-config.json');
  }

  /**
   * Caminho para o arquivo legado env.json (para compatibilidade).
   */
  static getLegacyEnvPath(projectDir) {
    return path.join(this.getHelperProjectDir(projectDir), 'env.json');
  }

  /**
   * Extrai variáveis de ambiente, active profiles e VM options do IntelliJ IDEA.
   * @param {string} projectDir Raiz do projeto
   * @returns {Object} { envs: Record<string, string>, vmOptions: string[], activeProfiles: string, programArgs: string, sourceFile: string }
   */
  static extractFromIntelliJ(projectDir) {
    if (!projectDir || !fs.existsSync(projectDir)) {
      return { envs: {}, vmOptions: [], activeProfiles: '', programArgs: '', sourceFile: '' };
    }

    const envs = {};
    const vmOptions = [];
    let activeProfiles = '';
    let programArgs = '';
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

    // Varre os arquivos XML procurando tags <envs>, <env name="..." value="..." />, <option name="VM_PARAMETERS" ... />, <option name="ACTIVE_PROFILES" ... /> etc.
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

        // Extrai <option name="PROGRAM_PARAMETERS" value="..." />
        const progMatch = content.match(/<option\s+name=["']PROGRAM_PARAMETERS["']\s+value=["']([^"']+)["']/i);
        if (progMatch && progMatch[1] && !programArgs) {
          programArgs = progMatch[1].trim();
        }

        // Extrai <option name="ACTIVE_PROFILES" value="..." /> ou <option name="SPRING_BOOT_ACTIVE_PROFILES" ... />
        const profMatch = content.match(/<option\s+name=["'](?:ACTIVE_PROFILES|SPRING_BOOT_ACTIVE_PROFILES|PROFILES)["']\s+value=["']([^"']+)["']/i);
        if (profMatch && profMatch[1] && !activeProfiles) {
          activeProfiles = profMatch[1].trim();
        }

        // Detecta active profiles se estiver dentro das envs (SPRING_PROFILES_ACTIVE)
        if (!activeProfiles && envs.SPRING_PROFILES_ACTIVE) {
          activeProfiles = envs.SPRING_PROFILES_ACTIVE;
        }

        if (foundAny && !sourceFile) {
          sourceFile = xmlFile;
        }
      } catch (_) {}
    }

    return { envs, vmOptions, activeProfiles, programArgs, sourceFile };
  }

  /**
   * Método legado mantido para compatibilidade.
   */
  static extractEnv(projectDir) {
    return this.extractFromIntelliJ(projectDir);
  }

  /**
   * Obtém as configurações completas do projeto (runner-config.json).
   * Se ainda não existirem, extrai do IntelliJ IDEA e salva como baseline inicial.
   * @param {string} projectDir Raiz do projeto
   * @returns {Object} Configuração completa de execução do projeto
   */
  static getProjectConfig(projectDir) {
    if (!projectDir || !fs.existsSync(projectDir)) {
      return {
        projectDir: projectDir || '',
        activeProfiles: '',
        vmOptions: '',
        programArgs: '',
        envVars: {},
        extractedFromIntelliJ: { envs: {}, vmOptions: [], activeProfiles: '', programArgs: '', sourceFile: '' },
        useIntelliJFallback: true,
        hasCustomOverrides: false,
        lastModified: new Date().toISOString(),
      };
    }

    const configPath = this.getConfigPath(projectDir);
    const legacyPath = this.getLegacyEnvPath(projectDir);

    // 1. Se já existe runner-config.json, lê e retorna
    if (fs.existsSync(configPath)) {
      try {
        const raw = fs.readFileSync(configPath, 'utf8');
        const data = JSON.parse(raw);
        return {
          projectDir,
          projectName: path.basename(projectDir),
          activeProfiles: data.activeProfiles || '',
          vmOptions: typeof data.vmOptions === 'string' ? data.vmOptions : (Array.isArray(data.vmOptions) ? data.vmOptions.join(' ') : ''),
          programArgs: data.programArgs || '',
          envVars: data.envVars || data.customEnvs || {},
          extractedFromIntelliJ: data.extractedFromIntelliJ || { envs: {}, vmOptions: [], activeProfiles: '', programArgs: '', sourceFile: '' },
          useIntelliJFallback: data.useIntelliJFallback !== false,
          hasCustomOverrides: !!data.hasCustomOverrides,
          lastModified: data.lastModified || new Date().toISOString(),
        };
      } catch (_) {}
    }

    // 2. Se existe env.json legado, migra para runner-config.json
    let legacyData = null;
    if (fs.existsSync(legacyPath)) {
      try {
        legacyData = JSON.parse(fs.readFileSync(legacyPath, 'utf8'));
      } catch (_) {}
    }

    // 3. Extrai baseline do IntelliJ
    const extracted = this.extractFromIntelliJ(projectDir);
    const customEnvs = (legacyData && legacyData.customEnvs) ? legacyData.customEnvs : {};
    const hasCustom = Object.keys(customEnvs).length > 0;

    // Se o usuário não definiu customEnvs no Helper Node ainda, inicializa com cópia do IntelliJ
    const initialEnvVars = hasCustom ? customEnvs : { ...extracted.envs };
    const initialVmOptions = (legacyData && legacyData.vmOptions && legacyData.vmOptions.length)
      ? legacyData.vmOptions.join(' ')
      : extracted.vmOptions.join(' ');
    const initialActiveProfiles = extracted.activeProfiles || (initialEnvVars.SPRING_PROFILES_ACTIVE || '');

    const newConfig = {
      projectDir,
      projectName: path.basename(projectDir),
      activeProfiles: initialActiveProfiles,
      vmOptions: initialVmOptions,
      programArgs: extracted.programArgs || '',
      envVars: initialEnvVars,
      extractedFromIntelliJ: {
        envs: extracted.envs,
        vmOptions: extracted.vmOptions,
        activeProfiles: extracted.activeProfiles,
        programArgs: extracted.programArgs,
        sourceFile: extracted.sourceFile,
        extractedAt: new Date().toISOString(),
      },
      useIntelliJFallback: true,
      hasCustomOverrides: hasCustom,
      lastModified: new Date().toISOString(),
    };

    try {
      fs.writeFileSync(configPath, JSON.stringify(newConfig, null, 2), 'utf8');
      // Atualiza também env.json para compatibilidade
      this._saveLegacyEnvJson(projectDir, newConfig);
    } catch (e) {
      console.warn('[intellijConfigExtractor] Erro ao salvar runner-config.json inicial:', e.message);
    }

    return newConfig;
  }

  /**
   * Salva configurações atualizadas pelo usuário no Helper Node.
   * @param {string} projectDir Raiz do projeto
   * @param {Object} partialConfig Alterações feitas pelo usuário
   */
  static saveProjectConfig(projectDir, partialConfig = {}) {
    if (!projectDir) throw new Error('Caminho do projeto inválido.');

    const current = this.getProjectConfig(projectDir);
    const updatedEnvVars = partialConfig.envVars !== undefined ? partialConfig.envVars : current.envVars;

    const updatedConfig = {
      ...current,
      activeProfiles: partialConfig.activeProfiles !== undefined ? String(partialConfig.activeProfiles).trim() : current.activeProfiles,
      vmOptions: partialConfig.vmOptions !== undefined ? String(partialConfig.vmOptions).trim() : current.vmOptions,
      programArgs: partialConfig.programArgs !== undefined ? String(partialConfig.programArgs).trim() : current.programArgs,
      envVars: updatedEnvVars,
      useIntelliJFallback: partialConfig.useIntelliJFallback !== undefined ? !!partialConfig.useIntelliJFallback : current.useIntelliJFallback,
      hasCustomOverrides: true,
      lastModified: new Date().toISOString(),
    };

    // Se o usuário especificou activeProfiles mas não em envVars.SPRING_PROFILES_ACTIVE, sincroniza
    if (updatedConfig.activeProfiles && !updatedConfig.envVars.SPRING_PROFILES_ACTIVE) {
      updatedConfig.envVars.SPRING_PROFILES_ACTIVE = updatedConfig.activeProfiles;
    } else if (updatedConfig.activeProfiles && updatedConfig.envVars.SPRING_PROFILES_ACTIVE !== updatedConfig.activeProfiles) {
      updatedConfig.envVars.SPRING_PROFILES_ACTIVE = updatedConfig.activeProfiles;
    }

    const configPath = this.getConfigPath(projectDir);
    fs.writeFileSync(configPath, JSON.stringify(updatedConfig, null, 2), 'utf8');
    this._saveLegacyEnvJson(projectDir, updatedConfig);

    return updatedConfig;
  }

  /**
   * Reimporta dados do IntelliJ (.idea) e atualiza o runner-config.json.
   * Mantém as variáveis customizadas criadas pelo usuário no Helper Node.
   * @param {string} projectDir Raiz do projeto
   */
  static reimportFromIntelliJ(projectDir) {
    if (!projectDir) throw new Error('Caminho do projeto inválido.');

    const current = this.getProjectConfig(projectDir);
    const extracted = this.extractFromIntelliJ(projectDir);

    // Se o usuário não tinha customizado nada, atualiza envVars diretamente
    const isClean = !current.hasCustomOverrides || Object.keys(current.envVars).length === 0;
    const mergedEnvVars = isClean ? { ...extracted.envs } : { ...extracted.envs, ...current.envVars };

    const updatedConfig = {
      ...current,
      activeProfiles: current.activeProfiles || extracted.activeProfiles || (mergedEnvVars.SPRING_PROFILES_ACTIVE || ''),
      vmOptions: current.vmOptions || extracted.vmOptions.join(' '),
      programArgs: current.programArgs || extracted.programArgs || '',
      envVars: mergedEnvVars,
      extractedFromIntelliJ: {
        envs: extracted.envs,
        vmOptions: extracted.vmOptions,
        activeProfiles: extracted.activeProfiles,
        programArgs: extracted.programArgs,
        sourceFile: extracted.sourceFile,
        extractedAt: new Date().toISOString(),
      },
      lastModified: new Date().toISOString(),
    };

    const configPath = this.getConfigPath(projectDir);
    fs.writeFileSync(configPath, JSON.stringify(updatedConfig, null, 2), 'utf8');
    this._saveLegacyEnvJson(projectDir, updatedConfig);

    return updatedConfig;
  }

  /**
   * Obtém a configuração efetiva para execução (incluindo cálculo de envs e parâmetros).
   * @param {string} projectDir Raiz do projeto
   */
  static getEffectiveConfig(projectDir) {
    const config = this.getProjectConfig(projectDir);

    let effectiveEnvs = {};
    if (config.useIntelliJFallback && config.extractedFromIntelliJ && config.extractedFromIntelliJ.envs) {
      effectiveEnvs = { ...config.extractedFromIntelliJ.envs, ...config.envVars };
    } else {
      effectiveEnvs = { ...config.envVars };
    }

    if (config.activeProfiles && !effectiveEnvs.SPRING_PROFILES_ACTIVE) {
      effectiveEnvs.SPRING_PROFILES_ACTIVE = config.activeProfiles;
    }

    return {
      ...config,
      effectiveEnvs,
    };
  }

  /**
   * Obtém as variáveis de ambiente efetivas para o projeto.
   */
  static getEffectiveEnv(projectDir) {
    if (!projectDir) return {};
    return this.getEffectiveConfig(projectDir).effectiveEnvs;
  }

  static _saveLegacyEnvJson(projectDir, config) {
    try {
      const legacyPath = this.getLegacyEnvPath(projectDir);
      const legacyData = {
        projectDir,
        extractedFromIntelliJ: (config.extractedFromIntelliJ && config.extractedFromIntelliJ.envs) || {},
        customEnvs: config.envVars || {},
        effectiveEnvs: { ...((config.extractedFromIntelliJ && config.extractedFromIntelliJ.envs) || {}), ...(config.envVars || {}) },
        vmOptions: config.vmOptions ? config.vmOptions.split(/\s+/).filter(Boolean) : [],
        lastSync: new Date().toISOString(),
      };
      fs.writeFileSync(legacyPath, JSON.stringify(legacyData, null, 2), 'utf8');
    } catch (_) {}
  }
}

module.exports = IntelliJConfigExtractor;
