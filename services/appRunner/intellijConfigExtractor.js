// services/appRunner/intellijConfigExtractor.js
// Extrai variáveis de ambiente e configurações de execução definidas no IntelliJ IDEA (.idea) e sincroniza com o Helper Node.

const fs = require('fs');
const path = require('path');
const os = require('os');

function unescapeXml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(parseInt(d, 10)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
}

/**
 * Valida se uma chave é um identificador legítimo de variável de ambiente / propriedade Spring / runtime.
 * Descarta configurações internas da IDE (PropertiesComponent, paths de arquivos, histórico de chat de IA, VCS, etc.).
 */
function isValidEnvKey(key) {
  if (!key || typeof key !== 'string') return false;
  const trimmed = key.trim();
  if (!trimmed || trimmed.length > 128) return false;

  // Não pode conter espaços, barras, aspas, tags XML, chaves, colchetes, ponto-e-vírgula ou igual
  if (/[\s\/\\]/.test(trimmed)) return false;
  if (/["'<>{}()[\],;=]/.test(trimmed)) return false;

  const lower = trimmed.toLowerCase();

  // Blacklist de propriedades internas de IDE, plugins, chats de IA e estado de UI do IntelliJ
  if (
    lower.startsWith('project.structure') ||
    lower.startsWith('project_structure') ||
    lower.startsWith('last_opened') ||
    lower.startsWith('lastopened') ||
    lower.startsWith('file.type') ||
    lower.startsWith('file.temp') ||
    lower.startsWith('file.color') ||
    lower.startsWith('file.template') ||
    lower.startsWith('nodejs_package') ||
    lower.startsWith('nodejs_') ||
    lower.startsWith('vue.') ||
    lower.startsWith('git4idea') ||
    lower.startsWith('vcs.') ||
    lower.startsWith('vcs_') ||
    lower.startsWith('selected.tabs') ||
    lower.startsWith('runonceactivity') ||
    lower.startsWith('webservertoolwindow') ||
    lower.startsWith('settings.editor') ||
    lower.startsWith('documentation.') ||
    lower.startsWith('ide.') ||
    lower.startsWith('idea.') ||
    lower.startsWith('editor.') ||
    lower.startsWith('com.intellij.') ||
    lower.startsWith('org.jetbrains.') ||
    lower.startsWith('com.github.') ||
    lower.startsWith('copilot.') ||
    lower.startsWith('kito.') ||
    lower.startsWith('sonarlint') ||
    lower.startsWith('xdebugger') ||
    lower.startsWith('recentprojects') ||
    lower.startsWith('projectview') ||
    lower.startsWith('tasks.xml') ||
    lower.startsWith('changelist') ||
    lower.startsWith('shelf') ||
    lower.includes('chat_') ||
    lower.includes('chat.') ||
    lower.includes('ai_chat') ||
    lower.includes('aichat') ||
    lower.includes('copilot') ||
    lower === 'last_opened_file_path' ||
    lower === 'project_path' ||
    lower === 'key_project_dir'
  ) {
    return false;
  }

  // Identificador padrão de env var (ex: SPRING_PROFILES_ACTIVE, SERVER_PORT, spring.profiles.active, server.port)
  return /^[a-zA-Z_][a-zA-Z0-9_.-]*$/.test(trimmed);
}

function parseEnvString(str) {
  const envs = {};
  if (!str) return envs;
  const parts = str.split(str.includes('\n') ? '\n' : ';');
  for (const part of parts) {
    const trimmed = part.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx !== -1) {
      const k = trimmed.substring(0, eqIdx).trim();
      let v = trimmed.substring(eqIdx + 1).trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
      if (isValidEnvKey(k)) envs[k] = unescapeXml(v);
    }
  }
  return envs;
}

function parseDotEnvFile(filePath) {
  const envs = {};
  if (!filePath || !fs.existsSync(filePath)) return envs;
  try {
    const lines = fs.readFileSync(filePath, 'utf8').split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx !== -1) {
        const k = trimmed.substring(0, eqIdx).trim();
        let v = trimmed.substring(eqIdx + 1).trim();
        if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
        if (isValidEnvKey(k)) envs[k] = v;
      }
    }
  } catch (_) {}
  return envs;
}

class IntelliJConfigExtractor {
  static getHelperProjectDir(projectDir) {
    const targetDir = path.join(os.homedir(), '.helper-node', 'projects', path.basename(projectDir).replace(/[^a-zA-Z0-9._-]/g, '_'));
    if (!fs.existsSync(targetDir)) {
      try { fs.mkdirSync(targetDir, { recursive: true }); } catch (_) {}
    }
    return targetDir;
  }

  static getConfigPath(projectDir) {
    return path.join(this.getHelperProjectDir(projectDir), 'runner-config.json');
  }

  static getLegacyEnvPath(projectDir) {
    return path.join(this.getHelperProjectDir(projectDir), 'env.json');
  }

  static findIdeaDirectories(projectDir) {
    const foundDirs = [];
    if (!projectDir || !fs.existsSync(projectDir)) return foundDirs;

    const directIdea = path.join(projectDir, '.idea');
    if (fs.existsSync(directIdea)) foundDirs.push(directIdea);

    let currentDir = projectDir;
    for (let i = 0; i < 4; i++) {
      const parentDir = path.dirname(currentDir);
      if (!parentDir || parentDir === currentDir) break;
      const parentIdea = path.join(parentDir, '.idea');
      if (fs.existsSync(parentIdea) && !foundDirs.includes(parentIdea)) foundDirs.push(parentIdea);
      currentDir = parentDir;
    }

    try {
      const subEntries = fs.readdirSync(projectDir, { withFileTypes: true });
      for (const entry of subEntries) {
        if (entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'node_modules' && entry.name !== 'build' && entry.name !== 'target') {
          const subIdea = path.join(projectDir, entry.name, '.idea');
          if (fs.existsSync(subIdea) && !foundDirs.includes(subIdea)) foundDirs.push(subIdea);
        }
      }
    } catch (_) {}

    return foundDirs;
  }

  /**
   * Extrai blocos <configuration> válidos a partir de arquivos do IntelliJ.
   * Apenas examina .idea/runConfigurations/*.xml e <component name="RunManager"> no workspace.xml.
   */
  static _extractConfigurationsFromXml(xmlFilePath) {
    const configs = [];
    if (!fs.existsSync(xmlFilePath)) return configs;

    try {
      const content = fs.readFileSync(xmlFilePath, 'utf8');
      const isWorkspaceXml = path.basename(xmlFilePath).toLowerCase() === 'workspace.xml';

      if (isWorkspaceXml) {
        // No workspace.xml, APENAS extrai configurações dentro de RunManager ou ProjectRunConfigurationManager
        const runManagerRegex = /<component\s+name=["'](?:RunManager|ProjectRunConfigurationManager|RunDashboard)["'][\s\S]*?<\/component>/gi;
        let rmMatch;
        while ((rmMatch = runManagerRegex.exec(content)) !== null) {
          const rmBlock = rmMatch[0];
          const cfgRegex = /<configuration\b[\s\S]*?<\/configuration>/gi;
          let cMatch;
          while ((cMatch = cfgRegex.exec(rmBlock)) !== null) {
            configs.push(cMatch[0]);
          }
        }
      } else {
        // Em arquivos dedicados em runConfigurations/*.xml
        const cfgRegex = /<configuration\b[\s\S]*?<\/configuration>/gi;
        let cMatch;
        let foundAny = false;
        while ((cMatch = cfgRegex.exec(content)) !== null) {
          configs.push(cMatch[0]);
          foundAny = true;
        }
        if (!foundAny && content.includes('<envs>') || content.includes('VM_PARAMETERS') || content.includes('ENV_VARIABLES')) {
          configs.push(content);
        }
      }
    } catch (_) {}

    return configs;
  }

  /**
   * Analisa um bloco <configuration> individual do IntelliJ e extrai envs, VM options, program args e active profiles.
   */
  static _parseConfigurationBlock(configBlock, projectDir, xmlFile) {
    const extractedEnvs = {};
    const extractedVmOptions = [];
    let extractedActiveProfiles = '';
    let extractedProgramArgs = '';
    const envFilePaths = [];

    // 1. Extrai tags <envs> ... <env name="K" value="V"/> ou <entry key="K" value="V"/> </envs>
    const envsBlockRegex = /<envs>([\s\S]*?)<\/envs>/gi;
    let envsBlockMatch;
    while ((envsBlockMatch = envsBlockRegex.exec(configBlock)) !== null) {
      const innerEnvs = envsBlockMatch[1];
      const itemRegex = /<(?:env|entry)\s+([^>]+?)\/?>/gi;
      let itemMatch;
      while ((itemMatch = itemRegex.exec(innerEnvs)) !== null) {
        const attrStr = itemMatch[1];
        const keyMatch = attrStr.match(/(?:name|key)=["']([^"']+)["']/i);
        const valMatch = attrStr.match(/value=["']([^"']*)["']/i);
        if (keyMatch) {
          const key = keyMatch[1].trim();
          const val = unescapeXml(valMatch ? valMatch[1] : '');
          if (isValidEnvKey(key)) {
            extractedEnvs[key] = val;
          }
        }
      }
    }

    // 2. Extrai <option name="ENV_VARIABLES|ENVIRONMENT_VARIABLES|envs|env"> com value="..." ou <map><entry key="K" value="V"/></map>
    const optionEnvRegex = /<option\s+name=["'](?:ENV_VARIABLES|ENVIRONMENT_VARIABLES|envs|env|environmentVariables)["']([^>]*?)>([\s\S]*?)<\/option>|<option\s+name=["'](?:ENV_VARIABLES|ENVIRONMENT_VARIABLES|envs|env|environmentVariables)["']\s+value=["']([^"']+)["']\s*\/?>/gi;
    let optMatch;
    while ((optMatch = optionEnvRegex.exec(configBlock)) !== null) {
      const openingAttrs = optMatch[1] || '';
      const innerContent = optMatch[2] || '';
      const directValue = optMatch[3] || '';

      if (directValue) {
        const parsed = parseEnvString(unescapeXml(directValue));
        for (const [k, v] of Object.entries(parsed)) {
          if (isValidEnvKey(k)) extractedEnvs[k] = v;
        }
      } else {
        const valueInAttrs = openingAttrs.match(/value=["']([^"']+)["']/i);
        if (valueInAttrs && valueInAttrs[1]) {
          const parsed = parseEnvString(unescapeXml(valueInAttrs[1]));
          for (const [k, v] of Object.entries(parsed)) {
            if (isValidEnvKey(k)) extractedEnvs[k] = v;
          }
        }

        if (innerContent && innerContent.includes('<entry')) {
          const entryRegex = /<entry\s+([^>]+?)\/?>/gi;
          let entryMatch;
          while ((entryMatch = entryRegex.exec(innerContent)) !== null) {
            const attrStr = entryMatch[1];
            const keyMatch = attrStr.match(/(?:key|name)=["']([^"']+)["']/i);
            const valMatch = attrStr.match(/value=["']([^"']*)["']/i);
            if (keyMatch) {
              const key = keyMatch[1].trim();
              const val = unescapeXml(valMatch ? valMatch[1] : '');
              if (isValidEnvKey(key)) {
                extractedEnvs[key] = val;
              }
            }
          }
        }
      }
    }

    // 3. Suporte ao plugin EnvFile do IntelliJ (<ENTRIES><ENTRY PATH="..."/></ENTRIES> ou <option name="envFile" value="..." />)
    const envFileEntryRegex = /<ENTRY\s+([^>]+?)\/?>/gi;
    let efMatch;
    while ((efMatch = envFileEntryRegex.exec(configBlock)) !== null) {
      const attrStr = efMatch[1];
      if (/IS_ENABLED=["']false["']/i.test(attrStr) || /isEnabled=["']false["']/i.test(attrStr)) continue;
      const pathMatch = attrStr.match(/PATH=["']([^"']+)["']/i);
      if (pathMatch && pathMatch[1]) {
        envFilePaths.push(pathMatch[1]);
      }
    }
    const envFileOptMatch = configBlock.match(/<option\s+name=["'](?:envFile|envFiles|env_file)["']\s+value=["']([^"']+)["']/i);
    if (envFileOptMatch && envFileOptMatch[1]) {
      envFilePaths.push(envFileOptMatch[1]);
    }

    // 4. VM_PARAMETERS
    const vmMatch = configBlock.match(/<option\s+name=["'](?:VM_PARAMETERS|vmParameters)["']\s+value=["']([^"']+)["']/i);
    if (vmMatch && vmMatch[1]) {
      const opts = unescapeXml(vmMatch[1]).trim().split(/\s+/).filter(Boolean);
      opts.forEach(o => { if (!extractedVmOptions.includes(o)) extractedVmOptions.push(o); });
    }

    // 5. PROGRAM_PARAMETERS
    const progMatch = configBlock.match(/<option\s+name=["'](?:PROGRAM_PARAMETERS|programParameters)["']\s+value=["']([^"']+)["']/i);
    if (progMatch && progMatch[1]) {
      extractedProgramArgs = unescapeXml(progMatch[1]).trim();
    }

    // 6. SPRING_BOOT_ACTIVE_PROFILES / ACTIVE_PROFILES
    const profMatch = configBlock.match(/<option\s+name=["'](?:ACTIVE_PROFILES|SPRING_BOOT_ACTIVE_PROFILES|PROFILES|spring\.profiles\.active)["']\s+value=["']([^"']+)["']/i);
    if (profMatch && profMatch[1]) {
      extractedActiveProfiles = unescapeXml(profMatch[1]).trim();
    }

    return {
      envs: extractedEnvs,
      vmOptions: extractedVmOptions,
      activeProfiles: extractedActiveProfiles,
      programArgs: extractedProgramArgs,
      envFilePaths,
      isDefault: /default=["']true["']/i.test(configBlock),
      isSpringBoot: /SpringBootApplicationConfigurationType/i.test(configBlock),
      isApp: /type=["']Application["']/i.test(configBlock) || /type=["']GradleRunConfiguration["']/i.test(configBlock),
    };
  }

  static extractFromIntelliJ(projectDir) {
    if (!projectDir || !fs.existsSync(projectDir)) {
      return { envs: {}, vmOptions: [], activeProfiles: '', programArgs: '', sourceFile: '', envOrigins: {} };
    }

    const envs = {};
    const envOrigins = {};
    const vmOptions = [];
    let activeProfiles = '';
    let programArgs = '';
    let sourceFile = '';

    const ideaDirs = this.findIdeaDirectories(projectDir);
    const runConfigXmlFiles = [];

    for (const ideaDir of ideaDirs) {
      // 1. Arquivos dedicados em .idea/runConfigurations/*.xml
      const runConfigsDir = path.join(ideaDir, 'runConfigurations');
      if (fs.existsSync(runConfigsDir)) {
        try {
          fs.readdirSync(runConfigsDir).forEach(f => {
            if (f.endsWith('.xml')) {
              const fullP = path.join(runConfigsDir, f);
              if (!runConfigXmlFiles.includes(fullP)) runConfigXmlFiles.push(fullP);
            }
          });
        } catch (_) {}
      }

      // 2. .idea/workspace.xml (somente bloco RunManager)
      const workspaceXml = path.join(ideaDir, 'workspace.xml');
      if (fs.existsSync(workspaceXml) && !runConfigXmlFiles.includes(workspaceXml)) {
        runConfigXmlFiles.push(workspaceXml);
      }
    }

    const parsedConfigurations = [];

    for (const xmlFile of runConfigXmlFiles) {
      const configBlocks = this._extractConfigurationsFromXml(xmlFile);
      for (const block of configBlocks) {
        const parsed = this._parseConfigurationBlock(block, projectDir, xmlFile);
        parsed.sourceFile = xmlFile;
        parsedConfigurations.push(parsed);
      }
    }

    // Ordena configurações: Spring Boot / App reais primeiro, templates default por último
    parsedConfigurations.sort((a, b) => {
      if (a.isSpringBoot && !b.isSpringBoot) return -1;
      if (!a.isSpringBoot && b.isSpringBoot) return 1;
      if (a.isApp && !b.isApp) return -1;
      if (!a.isApp && b.isApp) return 1;
      if (!a.isDefault && b.isDefault) return -1;
      if (a.isDefault && !b.isDefault) return 1;
      return 0;
    });

    for (const cfg of parsedConfigurations) {
      for (const [k, v] of Object.entries(cfg.envs)) {
        if (!envs[k] && isValidEnvKey(k)) {
          envs[k] = v;
          envOrigins[k] = 'intellij';
          if (!sourceFile) sourceFile = cfg.sourceFile;
        }
      }

      cfg.vmOptions.forEach(o => {
        if (!vmOptions.includes(o)) vmOptions.push(o);
      });

      if (!programArgs && cfg.programArgs) {
        programArgs = cfg.programArgs;
      }

      if (!activeProfiles && cfg.activeProfiles) {
        activeProfiles = cfg.activeProfiles;
      }

      // Processa arquivos .env do plugin EnvFile referenciados na configuração
      for (const relPath of cfg.envFilePaths) {
        const fullEnvPath = path.isAbsolute(relPath) ? relPath : path.join(projectDir, relPath);
        if (fs.existsSync(fullEnvPath)) {
          const dotEnvs = parseDotEnvFile(fullEnvPath);
          for (const [k, v] of Object.entries(dotEnvs)) {
            if (!envs[k] && isValidEnvKey(k)) {
              envs[k] = v;
              envOrigins[k] = 'env-file';
              if (!sourceFile) sourceFile = fullEnvPath;
            }
          }
        }
      }
    }

    // Tenta derivar activeProfiles de programArgs, vmOptions ou envs
    if (!activeProfiles && programArgs) {
      const m = programArgs.match(/--spring\.profiles\.active=([^\s"']+)/i);
      if (m) activeProfiles = m[1];
    }
    if (!activeProfiles && vmOptions.length > 0) {
      const m = vmOptions.join(' ').match(/-Dspring\.profiles\.active=([^\s"']+)/i);
      if (m) activeProfiles = m[1];
    }
    if (!activeProfiles && envs.SPRING_PROFILES_ACTIVE) {
      activeProfiles = envs.SPRING_PROFILES_ACTIVE;
    }

    // Lê arquivos .env padrão na raiz do projeto (apenas variáveis com chave válida)
    for (const envFileName of ['.env', '.env.local', '.env.dev', '.env.development']) {
      const dotEnvPath = path.join(projectDir, envFileName);
      if (fs.existsSync(dotEnvPath)) {
        const dotEnvEnvs = parseDotEnvFile(dotEnvPath);
        for (const [k, v] of Object.entries(dotEnvEnvs)) {
          if (!envs[k] && isValidEnvKey(k)) {
            envs[k] = v;
            envOrigins[k] = 'env-file';
            if (!sourceFile) sourceFile = dotEnvPath;
          }
        }
        if (!activeProfiles && dotEnvEnvs.SPRING_PROFILES_ACTIVE) {
          activeProfiles = dotEnvEnvs.SPRING_PROFILES_ACTIVE;
        }
      }
    }

    return { envs, vmOptions, activeProfiles, programArgs, sourceFile, envOrigins };
  }

  static extractEnv(projectDir) {
    return this.extractFromIntelliJ(projectDir);
  }

  static getProjectConfig(projectDir) {
    if (!projectDir || !fs.existsSync(projectDir)) {
      return {
        projectDir: projectDir || '',
        projectName: projectDir ? path.basename(projectDir) : '',
        activeProfiles: '',
        vmOptions: '',
        programArgs: '',
        programArguments: '',
        envVars: {},
        env: {},
        envOrigins: {},
        extractedFromIntelliJ: { envs: {}, vmOptions: [], activeProfiles: '', programArgs: '', sourceFile: '', envOrigins: {} },
        useIntelliJFallback: true,
        hasCustomOverrides: false,
        lastSync: new Date().toISOString(),
        lastModified: new Date().toISOString(),
      };
    }

    const configPath = this.getConfigPath(projectDir);
    const legacyPath = this.getLegacyEnvPath(projectDir);

    if (fs.existsSync(configPath)) {
      try {
        const data = JSON.parse(fs.readFileSync(configPath, 'utf8'));
        const rawEnvVars = data.envVars || data.env || data.customEnvs || {};
        const envVars = {};
        let hadDirtyKeys = false;

        // Limpa e sanitiza chaves que possam ter vindo de extração antiga corrompida
        for (const [k, v] of Object.entries(rawEnvVars)) {
          if (isValidEnvKey(k)) {
            envVars[k] = typeof v === 'string' ? v : String(v);
          } else {
            hadDirtyKeys = true;
          }
        }

        const extracted = data.extractedFromIntelliJ || { envs: {}, vmOptions: [], activeProfiles: '', programArgs: '', sourceFile: '', envOrigins: {} };
        if (extracted.envs) {
          const cleanExtracted = {};
          const cleanExtractedOrigins = {};
          for (const [k, v] of Object.entries(extracted.envs)) {
            if (isValidEnvKey(k)) {
              cleanExtracted[k] = typeof v === 'string' ? v : String(v);
              if (extracted.envOrigins && extracted.envOrigins[k]) {
                cleanExtractedOrigins[k] = extracted.envOrigins[k];
              }
            } else {
              hadDirtyKeys = true;
            }
          }
          extracted.envs = cleanExtracted;
          extracted.envOrigins = cleanExtractedOrigins;
        }

        const envOrigins = {};
        for (const [k, v] of Object.entries(envVars)) {
          if (data.envOrigins && data.envOrigins[k]) {
            envOrigins[k] = data.envOrigins[k];
          } else {
            envOrigins[k] = (extracted.envs && extracted.envs[k] === v) ? ((extracted.envOrigins && extracted.envOrigins[k]) || 'intellij') : 'custom';
          }
        }

        const programArgs = data.programArgs || data.programArguments || '';
        const vmOptions = typeof data.vmOptions === 'string' ? data.vmOptions : (Array.isArray(data.vmOptions) ? data.vmOptions.join(' ') : '');

        const disabledEnvs = Array.isArray(data.disabledEnvs)
          ? data.disabledEnvs.filter(k => typeof k === 'string')
          : (Array.isArray(data.disabledKeys) ? data.disabledKeys.filter(k => typeof k === 'string') : []);

        const cleanedConfig = {
          projectDir,
          projectName: path.basename(projectDir),
          activeProfiles: data.activeProfiles || '',
          vmOptions,
          programArgs,
          programArguments: programArgs,
          envVars,
          env: envVars,
          disabledEnvs,
          envOrigins,
          extractedFromIntelliJ: extracted,
          useIntelliJFallback: data.useIntelliJFallback !== false,
          hasCustomOverrides: !!data.hasCustomOverrides,
          lastSync: data.lastSync || data.lastModified || new Date().toISOString(),
          lastModified: data.lastModified || data.lastSync || new Date().toISOString(),
        };

        // Se haviam chaves sujas gravadas anteriormente no disco, regrava o arquivo limpo
        if (hadDirtyKeys) {
          try {
            fs.writeFileSync(configPath, JSON.stringify(cleanedConfig, null, 2), 'utf8');
            this._saveLegacyEnvJson(projectDir, cleanedConfig);
          } catch (_) {}
        }

        return cleanedConfig;
      } catch (_) {}
    }

    let legacyData = null;
    if (fs.existsSync(legacyPath)) {
      try { legacyData = JSON.parse(fs.readFileSync(legacyPath, 'utf8')); } catch (_) {}
    }

    const extracted = this.extractFromIntelliJ(projectDir);
    const customEnvsRaw = (legacyData && legacyData.customEnvs) ? legacyData.customEnvs : {};
    const customEnvs = {};
    for (const [k, v] of Object.entries(customEnvsRaw)) {
      if (isValidEnvKey(k)) customEnvs[k] = v;
    }

    const hasCustom = Object.keys(customEnvs).length > 0;
    const initialEnvVars = hasCustom ? customEnvs : { ...extracted.envs };
    const initialVmOptions = (legacyData && legacyData.vmOptions && legacyData.vmOptions.length)
      ? legacyData.vmOptions.join(' ')
      : extracted.vmOptions.join(' ');
    const initialActiveProfiles = extracted.activeProfiles || (initialEnvVars.SPRING_PROFILES_ACTIVE || '');

    const initialOrigins = {};
    for (const [k, v] of Object.entries(initialEnvVars)) {
      initialOrigins[k] = (extracted.envs && extracted.envs[k] === v) ? ((extracted.envOrigins && extracted.envOrigins[k]) || 'intellij') : 'custom';
    }

    const newConfig = {
      projectDir,
      projectName: path.basename(projectDir),
      activeProfiles: initialActiveProfiles,
      vmOptions: initialVmOptions,
      programArgs: extracted.programArgs || '',
      programArguments: extracted.programArgs || '',
      envVars: initialEnvVars,
      env: initialEnvVars,
      disabledEnvs: [],
      envOrigins: initialOrigins,
      extractedFromIntelliJ: {
        envs: extracted.envs,
        vmOptions: extracted.vmOptions,
        activeProfiles: extracted.activeProfiles,
        programArgs: extracted.programArgs,
        sourceFile: extracted.sourceFile,
        envOrigins: extracted.envOrigins || {},
        extractedAt: new Date().toISOString(),
      },
      useIntelliJFallback: true,
      hasCustomOverrides: hasCustom,
      lastSync: new Date().toISOString(),
      lastModified: new Date().toISOString(),
    };

    try {
      fs.writeFileSync(configPath, JSON.stringify(newConfig, null, 2), 'utf8');
      this._saveLegacyEnvJson(projectDir, newConfig);
    } catch (e) {
      console.warn('[intellijConfigExtractor] Erro ao salvar baseline:', e.message);
    }

    return newConfig;
  }

  static saveProjectConfig(projectDir, partialConfig = {}) {
    if (!projectDir) throw new Error('Caminho do projeto inválido.');

    const current = this.getProjectConfig(projectDir);
    const rawEnvVars = partialConfig.envVars !== undefined
      ? partialConfig.envVars
      : (partialConfig.env !== undefined ? partialConfig.env : current.envVars);

    const updatedEnvVars = {};
    for (const [k, v] of Object.entries(rawEnvVars || {})) {
      if (isValidEnvKey(k)) {
        updatedEnvVars[k] = typeof v === 'string' ? v : String(v);
      }
    }

    const activeProfiles = partialConfig.activeProfiles !== undefined ? String(partialConfig.activeProfiles).trim() : current.activeProfiles;
    const vmOptions = partialConfig.vmOptions !== undefined ? String(partialConfig.vmOptions).trim() : current.vmOptions;
    const programArgs = partialConfig.programArgs !== undefined
      ? String(partialConfig.programArgs).trim()
      : (partialConfig.programArguments !== undefined ? String(partialConfig.programArguments).trim() : current.programArgs);

    const extractedEnvs = (current.extractedFromIntelliJ && current.extractedFromIntelliJ.envs) || {};
    const updatedOrigins = {};
    for (const [k, v] of Object.entries(updatedEnvVars)) {
      updatedOrigins[k] = (extractedEnvs[k] !== undefined && extractedEnvs[k] === v)
        ? ((current.extractedFromIntelliJ.envOrigins && current.extractedFromIntelliJ.envOrigins[k]) || 'intellij')
        : 'custom';
    }

    const disabledEnvs = Array.isArray(partialConfig.disabledEnvs)
      ? partialConfig.disabledEnvs.filter(k => typeof k === 'string')
      : (Array.isArray(current.disabledEnvs) ? current.disabledEnvs : []);

    const updatedConfig = {
      ...current,
      activeProfiles,
      vmOptions,
      programArgs,
      programArguments: programArgs,
      envVars: updatedEnvVars,
      env: updatedEnvVars,
      disabledEnvs,
      envOrigins: updatedOrigins,
      useIntelliJFallback: partialConfig.useIntelliJFallback !== undefined ? !!partialConfig.useIntelliJFallback : current.useIntelliJFallback,
      hasCustomOverrides: true,
      lastSync: new Date().toISOString(),
      lastModified: new Date().toISOString(),
    };

    if (updatedConfig.activeProfiles && !updatedConfig.envVars.SPRING_PROFILES_ACTIVE) {
      updatedConfig.envVars.SPRING_PROFILES_ACTIVE = updatedConfig.activeProfiles;
      updatedConfig.env.SPRING_PROFILES_ACTIVE = updatedConfig.activeProfiles;
    } else if (updatedConfig.activeProfiles && updatedConfig.envVars.SPRING_PROFILES_ACTIVE !== updatedConfig.activeProfiles) {
      updatedConfig.envVars.SPRING_PROFILES_ACTIVE = updatedConfig.activeProfiles;
      updatedConfig.env.SPRING_PROFILES_ACTIVE = updatedConfig.activeProfiles;
    }

    const configPath = this.getConfigPath(projectDir);
    fs.writeFileSync(configPath, JSON.stringify(updatedConfig, null, 2), 'utf8');
    this._saveLegacyEnvJson(projectDir, updatedConfig);

    return updatedConfig;
  }

  static reimportFromIntelliJ(projectDir) {
    if (!projectDir) throw new Error('Caminho do projeto inválido.');

    const current = this.getProjectConfig(projectDir);
    const extracted = this.extractFromIntelliJ(projectDir);

    // Mantém APENAS variáveis que o usuário customizou manualmente e que sejam válidas
    const customEnvs = {};
    if (current.envVars) {
      for (const [k, v] of Object.entries(current.envVars)) {
        if (isValidEnvKey(k) && current.envOrigins && current.envOrigins[k] === 'custom') {
          customEnvs[k] = v;
        }
      }
    }

    // Mescla: variáveis recém-extraídas do IntelliJ + customizações manuais do usuário
    const mergedEnvVars = { ...extracted.envs, ...customEnvs };

    const updatedOrigins = {};
    for (const [k, v] of Object.entries(mergedEnvVars)) {
      if (customEnvs[k] !== undefined) {
        updatedOrigins[k] = 'custom';
      } else {
        updatedOrigins[k] = (extracted.envOrigins && extracted.envOrigins[k]) || 'intellij';
      }
    }

    const programArgs = current.programArgs || extracted.programArgs || '';
    const updatedConfig = {
      ...current,
      activeProfiles: current.activeProfiles || extracted.activeProfiles || (mergedEnvVars.SPRING_PROFILES_ACTIVE || ''),
      vmOptions: current.vmOptions || extracted.vmOptions.join(' '),
      programArgs,
      programArguments: programArgs,
      envVars: mergedEnvVars,
      env: mergedEnvVars,
      disabledEnvs: current.disabledEnvs || [],
      envOrigins: updatedOrigins,
      extractedFromIntelliJ: {
        envs: extracted.envs,
        vmOptions: extracted.vmOptions,
        activeProfiles: extracted.activeProfiles,
        programArgs: extracted.programArgs,
        sourceFile: extracted.sourceFile,
        envOrigins: extracted.envOrigins || {},
        extractedAt: new Date().toISOString(),
      },
      lastSync: new Date().toISOString(),
      lastModified: new Date().toISOString(),
    };

    const configPath = this.getConfigPath(projectDir);
    fs.writeFileSync(configPath, JSON.stringify(updatedConfig, null, 2), 'utf8');
    this._saveLegacyEnvJson(projectDir, updatedConfig);

    return updatedConfig;
  }

  static getEffectiveConfig(projectDir) {
    const config = this.getProjectConfig(projectDir);
    const disabledSet = new Set(Array.isArray(config.disabledEnvs) ? config.disabledEnvs : []);

    let effectiveEnvs = {};
    if (config.useIntelliJFallback && config.extractedFromIntelliJ && config.extractedFromIntelliJ.envs) {
      effectiveEnvs = { ...config.extractedFromIntelliJ.envs, ...config.envVars };
    } else {
      effectiveEnvs = { ...config.envVars };
    }

    if (config.activeProfiles && !effectiveEnvs.SPRING_PROFILES_ACTIVE) {
      effectiveEnvs.SPRING_PROFILES_ACTIVE = config.activeProfiles;
    }

    // Remove variáveis que foram desmarcadas / desativadas pelo usuário
    if (disabledSet.size > 0) {
      for (const key of disabledSet) {
        delete effectiveEnvs[key];
      }
    }

    return {
      ...config,
      effectiveEnvs,
    };
  }

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
