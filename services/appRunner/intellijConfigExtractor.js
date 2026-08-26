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
      if (k) envs[k] = unescapeXml(v);
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
        if (k) envs[k] = v;
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
    const xmlFilesToScan = [];

    for (const ideaDir of ideaDirs) {
      const runConfigsDir = path.join(ideaDir, 'runConfigurations');
      if (fs.existsSync(runConfigsDir)) {
        try {
          fs.readdirSync(runConfigsDir).forEach(f => {
            if (f.endsWith('.xml')) {
              const fullP = path.join(runConfigsDir, f);
              if (!xmlFilesToScan.includes(fullP)) xmlFilesToScan.push(fullP);
            }
          });
        } catch (_) {}
      }

      const workspaceXml = path.join(ideaDir, 'workspace.xml');
      if (fs.existsSync(workspaceXml) && !xmlFilesToScan.includes(workspaceXml)) xmlFilesToScan.push(workspaceXml);

      try {
        fs.readdirSync(ideaDir).forEach(f => {
          if (f.endsWith('.xml') && f !== 'workspace.xml') {
            const fullP = path.join(ideaDir, f);
            if (!xmlFilesToScan.includes(fullP)) xmlFilesToScan.push(fullP);
          }
        });
      } catch (_) {}
    }

    for (const xmlFile of xmlFilesToScan) {
      try {
        const content = fs.readFileSync(xmlFile, 'utf8');

        // Extrai <env name="KEY" value="VAL" /> ou <env key="KEY" value="VAL" />
        const envRegex = /<(?:env|entry)\s+(?:name|key)=["']([^"']+)["']\s+value=["']([^"']*)["']\s*\/?>|<(?:env|entry)\s+value=["']([^"']*)["']\s+(?:name|key)=["']([^"']+)["']\s*\/?>/gi;
        let match;
        while ((match = envRegex.exec(content)) !== null) {
          const key = (match[1] || match[4] || '').trim();
          const val = unescapeXml(match[2] !== undefined ? match[2] : match[3]);
          if (key) {
            envs[key] = val;
            envOrigins[key] = 'intellij';
            if (!sourceFile) sourceFile = xmlFile;
          }
        }

        const envVarsMatch = content.match(/<option\s+name=["'](?:ENV_VARIABLES|ENVIRONMENT_VARIABLES|env)["']\s+value=["']([^"']+)["']/i);
        if (envVarsMatch && envVarsMatch[1]) {
          const parsed = parseEnvString(envVarsMatch[1]);
          for (const [k, v] of Object.entries(parsed)) {
            envs[k] = v;
            envOrigins[k] = 'intellij';
            if (!sourceFile) sourceFile = xmlFile;
          }
        }

        const vmMatch = content.match(/<option\s+name=["']VM_PARAMETERS["']\s+value=["']([^"']+)["']/i);
        if (vmMatch && vmMatch[1]) {
          const opts = unescapeXml(vmMatch[1]).trim().split(/\s+/).filter(Boolean);
          opts.forEach(o => { if (!vmOptions.includes(o)) vmOptions.push(o); });
        }

        const progMatch = content.match(/<option\s+name=["']PROGRAM_PARAMETERS["']\s+value=["']([^"']+)["']/i);
        if (progMatch && progMatch[1] && !programArgs) {
          programArgs = unescapeXml(progMatch[1]).trim();
        }

        const profMatch = content.match(/<option\s+name=["'](?:ACTIVE_PROFILES|SPRING_BOOT_ACTIVE_PROFILES|PROFILES|spring\.profiles\.active)["']\s+value=["']([^"']+)["']/i);
        if (profMatch && profMatch[1] && !activeProfiles) {
          activeProfiles = unescapeXml(profMatch[1]).trim();
        }
      } catch (_) {}
    }

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

    for (const envFileName of ['.env', '.env.local', '.env.dev']) {
      const dotEnvPath = path.join(projectDir, envFileName);
      if (fs.existsSync(dotEnvPath)) {
        const dotEnvEnvs = parseDotEnvFile(dotEnvPath);
        for (const [k, v] of Object.entries(dotEnvEnvs)) {
          if (!envs[k]) {
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
        const envVars = data.envVars || data.env || data.customEnvs || {};
        const extracted = data.extractedFromIntelliJ || { envs: {}, vmOptions: [], activeProfiles: '', programArgs: '', sourceFile: '', envOrigins: {} };
        const envOrigins = data.envOrigins || {};

        for (const [k, v] of Object.entries(envVars)) {
          if (!envOrigins[k]) {
            envOrigins[k] = (extracted.envs && extracted.envs[k] === v) ? ((extracted.envOrigins && extracted.envOrigins[k]) || 'intellij') : 'custom';
          }
        }

        const programArgs = data.programArgs || data.programArguments || '';
        const vmOptions = typeof data.vmOptions === 'string' ? data.vmOptions : (Array.isArray(data.vmOptions) ? data.vmOptions.join(' ') : '');

        return {
          projectDir,
          projectName: path.basename(projectDir),
          activeProfiles: data.activeProfiles || '',
          vmOptions,
          programArgs,
          programArguments: programArgs,
          envVars,
          env: envVars,
          envOrigins,
          extractedFromIntelliJ: extracted,
          useIntelliJFallback: data.useIntelliJFallback !== false,
          hasCustomOverrides: !!data.hasCustomOverrides,
          lastSync: data.lastSync || data.lastModified || new Date().toISOString(),
          lastModified: data.lastModified || data.lastSync || new Date().toISOString(),
        };
      } catch (_) {}
    }

    let legacyData = null;
    if (fs.existsSync(legacyPath)) {
      try { legacyData = JSON.parse(fs.readFileSync(legacyPath, 'utf8')); } catch (_) {}
    }

    const extracted = this.extractFromIntelliJ(projectDir);
    const customEnvs = (legacyData && legacyData.customEnvs) ? legacyData.customEnvs : {};
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
    const updatedEnvVars = partialConfig.envVars !== undefined
      ? partialConfig.envVars
      : (partialConfig.env !== undefined ? partialConfig.env : current.envVars);

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

    const updatedConfig = {
      ...current,
      activeProfiles,
      vmOptions,
      programArgs,
      programArguments: programArgs,
      envVars: updatedEnvVars,
      env: updatedEnvVars,
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

    const isClean = !current.hasCustomOverrides || Object.keys(current.envVars).length === 0;
    const mergedEnvVars = isClean ? { ...extracted.envs } : { ...extracted.envs, ...current.envVars };

    const updatedOrigins = {};
    for (const [k, v] of Object.entries(mergedEnvVars)) {
      updatedOrigins[k] = (extracted.envs[k] !== undefined && extracted.envs[k] === v)
        ? ((extracted.envOrigins && extracted.envOrigins[k]) || 'intellij')
        : 'custom';
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
