// services/java/javaPropertiesBridge.js
// Bridge de propriedades e credenciais de repositórios (Nexus, Artifactory, Maven, GitHub Packages)
// para builds Gradle e Maven, reproduzindo o comportamento do IntelliJ IDEA.

const fs = require('fs');
const path = require('path');
const os = require('os');
const JdkDetector = require('../appRunner/jdkDetector.js');

/**
 * Lê e faz parse de arquivo .properties (estilo Java).
 */
function parsePropertiesFile(filePath) {
  const result = new Map();
  if (!filePath || !fs.existsSync(filePath)) return result;
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    const lines = raw.split(/\r?\n/);
    for (let line of lines) {
      line = line.trim();
      if (!line || line.startsWith('#') || line.startsWith('!')) continue;
      const eqIdx = line.indexOf('=');
      const colonIdx = line.indexOf(':');
      let sepIdx = -1;
      if (eqIdx !== -1 && colonIdx !== -1) sepIdx = Math.min(eqIdx, colonIdx);
      else sepIdx = eqIdx !== -1 ? eqIdx : colonIdx;

      if (sepIdx !== -1) {
        const key = line.substring(0, sepIdx).trim();
        let val = line.substring(sepIdx + 1).trim();
        if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
          val = val.slice(1, -1);
        }
        if (key) result.set(key, val);
      }
    }
  } catch (_) {}
  return result;
}

/**
 * Extrai credenciais de <server> de um arquivo settings.xml do Maven.
 */
function parseMavenSettings(settingsPath) {
  const servers = [];
  const props = new Map();
  if (!settingsPath || !fs.existsSync(settingsPath)) return { servers, props };
  try {
    const content = fs.readFileSync(settingsPath, 'utf8');
    const serverRegex = /<server>[\s\S]*?<id>([^<]+)<\/id>[\s\S]*?<username>([^<]+)<\/username>[\s\S]*?<password>([^<]+)<\/password>[\s\S]*?<\/server>/gi;
    let m;
    while ((m = serverRegex.exec(content)) !== null) {
      servers.push({
        id: m[1].trim(),
        username: m[2].trim(),
        password: m[3].trim(),
      });
    }

    const propRegex = /<([a-zA-Z0-9_.-]+)>([^<]+)<\/\1>/g;
    const propBlockMatch = content.match(/<properties>([\s\S]*?)<\/properties>/i);
    if (propBlockMatch) {
      let pm;
      while ((pm = propRegex.exec(propBlockMatch[1])) !== null) {
        props.set(pm[1].trim(), pm[2].trim());
      }
    }
  } catch (_) {}
  return { servers, props };
}

/**
 * Coleta todas as propriedades do Gradle e Maven agregadas
 * (projeto, pais, ~/.gradle/gradle.properties, ~/.m2/settings.xml, variáveis de ambiente).
 */
function getAggregatedProperties(projectRootDir) {
  const aggregated = new Map();
  const home = os.homedir();

  // 1. ~/.m2/settings.xml
  const m2Settings = path.join(home, '.m2', 'settings.xml');
  const mavenData = parseMavenSettings(m2Settings);
  for (const [k, v] of mavenData.props.entries()) {
    aggregated.set(k, v);
  }

  // 2. ~/.gradle/gradle.properties (Global)
  const gradleUserHome = process.env.GRADLE_USER_HOME || path.join(home, '.gradle');
  const globalGradleProps = path.join(gradleUserHome, 'gradle.properties');
  const globalProps = parsePropertiesFile(globalGradleProps);
  for (const [k, v] of globalProps.entries()) {
    aggregated.set(k, v);
  }

  // 3. Pastas superiores (para multi-module projects)
  if (projectRootDir && fs.existsSync(projectRootDir)) {
    let curr = path.resolve(projectRootDir);
    const parentPropFiles = [];
    while (curr && curr !== path.dirname(curr)) {
      const parentProp = path.join(curr, 'gradle.properties');
      if (fs.existsSync(parentProp) && parentProp !== globalGradleProps) {
        parentPropFiles.unshift(parentProp);
      }
      curr = path.dirname(curr);
    }
    for (const pf of parentPropFiles) {
      const p = parsePropertiesFile(pf);
      for (const [k, v] of p.entries()) {
        aggregated.set(k, v);
      }
    }
  }

  // 4. Variáveis de ambiente (process.env)
  for (const [k, v] of Object.entries(process.env)) {
    if (v == null) continue;
    if (k.startsWith('ORG_GRADLE_PROJECT_')) {
      const propKey = k.substring('ORG_GRADLE_PROJECT_'.length);
      aggregated.set(propKey, v);
    } else {
      aggregated.set(k, v);
    }
  }

  // 5. Detectar credenciais de Nexus/Artifactory/Repo de servidores Maven settings
  for (const s of mavenData.servers) {
    const idLower = s.id.toLowerCase();
    if (idLower.includes('nexus') || idLower.includes('repo') || idLower.includes('artifactory') || idLower.includes('central') || idLower.includes('release') || idLower.includes('internal')) {
      if (s.username && !aggregated.has('nexusUsername')) aggregated.set('nexusUsername', s.username);
      if (s.password && !aggregated.has('nexusPassword')) aggregated.set('nexusPassword', s.password);
    }
  }

  // 6. Normalização e Cross-Aliasing de Nexus Passwords e Usernames
  const passwordKeys = [
    'nexusPassword',
    'nexUserPassword',
    'nexPassword',
    'nexus_password',
    'nexusPass',
    'nexus.password',
    'nexusUserPassword',
    'repoPassword',
    'repositoryPassword',
    'findPropertyPassword',
    'FindPropertyPassword',
    'NexusPassword',
    'NexUserPassword',
    'NexPassword',
    'nexusSecret',
    'nexusToken',
    'NEXUS_PASSWORD',
    'NEX_USER_PASSWORD',
    'NEX_PASSWORD',
    'NEXUS_PASS',
  ];

  const usernameKeys = [
    'nexusUsername',
    'nexusUser',
    'nexUser',
    'nexUserName',
    'nexus_username',
    'nexus_user',
    'repoUser',
    'repoUsername',
    'repositoryUsername',
    'NexusUsername',
    'NexusUser',
    'NexUser',
    'nexusUserName',
    'NEXUS_USERNAME',
    'NEXUS_USER',
    'NEX_USER',
  ];

  let detectedPassword = null;
  for (const pk of passwordKeys) {
    if (aggregated.has(pk) && aggregated.get(pk)) {
      detectedPassword = aggregated.get(pk);
      break;
    }
  }

  let detectedUsername = null;
  for (const uk of usernameKeys) {
    if (aggregated.has(uk) && aggregated.get(uk)) {
      detectedUsername = aggregated.get(uk);
      break;
    }
  }

  if (detectedPassword) {
    for (const pk of passwordKeys) {
      aggregated.set(pk, detectedPassword);
    }
  }

  if (detectedUsername) {
    for (const uk of usernameKeys) {
      aggregated.set(uk, detectedUsername);
    }
  }

  return aggregated;
}

/**
 * Prepara o environment (env) com JAVA_HOME, PATH e propriedades do Gradle.
 */
function getJavaProcessEnv(projectRootDir, customEnv = {}) {
  const env = { ...process.env, ...customEnv };
  const bestJdk = JdkDetector.getBestJdk();

  if (bestJdk && bestJdk.homePath) {
    env.JAVA_HOME = bestJdk.homePath;
    const binDir = path.join(bestJdk.homePath, 'bin');
    const isWin = process.platform === 'win32';
    const pathKey = isWin ? Object.keys(env).find(k => k.toUpperCase() === 'PATH') || 'Path' : 'PATH';
    env[pathKey] = `${binDir}${path.delimiter}${env[pathKey] || ''}`;
  }

  const props = getAggregatedProperties(projectRootDir);
  for (const [k, v] of props.entries()) {
    if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') {
      env[`ORG_GRADLE_PROJECT_${k}`] = String(v);
      if (!env[k]) env[k] = String(v);
    }
  }

  return { env, properties: props, bestJdk };
}

/**
 * Gera o script init.gradle dinâmico que injeta as credenciais e extrai o classpath
 * com tolerância total a falhas em projetos Gradle.
 */
function generateGradleInitScript(outPrefix, rootDir) {
  const props = getAggregatedProperties(rootDir);
  const propsMapJson = JSON.stringify(Object.fromEntries(props));

  return `
// Helper Node Gradle Resolution Init Script (IntelliJ Style)
def helperProps = ${propsMapJson}

// 1. Injeta propriedades em todos os projetos antes da avaliação
gradle.allprojects { proj ->
  helperProps.each { k, v ->
    try {
      if (!proj.hasProperty(k) || proj.findProperty(k) == null) {
        proj.ext.set(k, v)
      }
    } catch (Throwable ignored) {}
    try {
      System.setProperty(k.toString(), v.toString())
    } catch (Throwable ignored) {}
  }
}

// 2. Registra a task de extração de classpath
allprojects { proj ->
  def registerClasspathTask = {
    if (proj.tasks.findByName('helperIdePrintClasspath') == null) {
      proj.tasks.register('helperIdePrintClasspath') {
        doLast {
          def safeName = (proj.path == ':' ? '_root_' : proj.path.replaceAll('[^a-zA-Z0-9]', '_'))
          def out = new File(${JSON.stringify(outPrefix)} + safeName + '.txt')
          def lines = new LinkedHashSet<String>()

          // Coleta classes e sourceSets
          try {
            if (proj.hasProperty('sourceSets')) {
              proj.sourceSets.each { ss ->
                try { ss.compileClasspath.files.each { if (it.exists()) lines.add(it.absolutePath) } } catch (Throwable ignored) {}
                try { ss.runtimeClasspath.files.each { if (it.exists()) lines.add(it.absolutePath) } } catch (Throwable ignored) {}
                try { ss.output.classesDirs.files.each { if (it.exists()) lines.add(it.absolutePath) } } catch (Throwable ignored) {}
              }
            }
          } catch (Throwable ignored) {}

          // Coleta todas as configurações resolvíveis
          try {
            proj.configurations.each { cfg ->
              try {
                if (cfg.canBeResolved) {
                  cfg.files.each { if (it.exists()) lines.add(it.absolutePath) }
                }
              } catch (Throwable ignored) {}
            }
          } catch (Throwable ignored) {}

          try {
            out.parentFile.mkdirs()
            out.text = lines.join(System.lineSeparator())
          } catch (Throwable ignored) {}
        }
      }
    }
  }

  if (proj.state.executed) {
    registerClasspathTask()
  } else {
    proj.afterEvaluate { registerClasspathTask() }
  }
}
`;
}

function compareVersionsDesc(a, b) {
  if (a === b) return 0;
  const parsePart = (p) => {
    const num = parseInt(p, 10);
    return isNaN(num) ? p : num;
  };
  const pa = String(a).split(/[-._+]/).map(parsePart);
  const pb = String(b).split(/[-._+]/).map(parsePart);
  const maxLen = Math.max(pa.length, pb.length);
  for (let i = 0; i < maxLen; i++) {
    const va = pa[i] !== undefined ? pa[i] : 0;
    const vb = pb[i] !== undefined ? pb[i] : 0;
    if (typeof va === 'number' && typeof vb === 'number') {
      if (va !== vb) return vb - va;
    } else {
      const sa = String(va);
      const sb = String(vb);
      if (sa !== sb) return sb.localeCompare(sa);
    }
  }
  return String(b).localeCompare(String(a));
}

function extractDependenciesFromGradleContent(content) {
  const deps = [];
  const GDEP_RE1 = /(?:implementation|api|compileOnly|runtimeOnly|testImplementation|annotationProcessor)\s*[\('"]+([\w.-]+):([\w.-]+)(?::([\w.-]+))?[\)'"]/g;
  let m;
  while ((m = GDEP_RE1.exec(content)) !== null) {
    deps.push({ groupId: m[1], artifactId: m[2], version: m[3] || null });
  }
  const GDEP_RE2 = /(?:group\s*[:=]\s*['"]([\w.-]+)['"]\s*,\s*name\s*[:=]\s*['"]([\w.-]+)['"](?:\s*,\s*version\s*[:=]\s*['"]([\w.-]+)['"])?)/g;
  while ((m = GDEP_RE2.exec(content)) !== null) {
    deps.push({ groupId: m[1], artifactId: m[2], version: m[3] || null });
  }
  return deps;
}

function extractDependenciesFromToml(tomlContent) {
  const deps = [];
  const MOD_RE = /module\s*=\s*['"]([\w.-]+):([\w.-]+)['"](?:\s*,\s*version(?:\.ref)?\s*=\s*['"]([\w.-]+)['"])?/g;
  let m;
  while ((m = MOD_RE.exec(tomlContent)) !== null) {
    deps.push({ groupId: m[1], artifactId: m[2], version: m[3] || null });
  }
  const GRP_RE = /group\s*=\s*['"]([\w.-]+)['"]\s*,\s*name\s*=\s*['"]([\w.-]+)['"](?:\s*,\s*version(?:\.ref)?\s*=\s*['"]([\w.-]+)['"])?/g;
  while ((m = GRP_RE.exec(tomlContent)) !== null) {
    deps.push({ groupId: m[1], artifactId: m[2], version: m[3] || null });
  }
  return deps;
}

function findJarInCaches(groupId, artifactId, version, home) {
  const candidates = [];
  const gradleCache = path.join(home, '.gradle', 'caches', 'modules-2', 'files-2.1');
  if (fs.existsSync(gradleCache)) {
    const groupPath = path.join(gradleCache, groupId, artifactId);
    if (fs.existsSync(groupPath)) {
      try {
        const versions = (version && fs.existsSync(path.join(groupPath, version)))
          ? [version]
          : fs.readdirSync(groupPath).sort(compareVersionsDesc);
        for (const v of versions) {
          const vDir = path.join(groupPath, v);
          if (fs.existsSync(vDir)) {
            const hashDirs = fs.readdirSync(vDir);
            for (const hd of hashDirs) {
              const candidate = path.join(vDir, hd, `${artifactId}-${v}.jar`);
              if (fs.existsSync(candidate) && !candidate.endsWith('-sources.jar') && !candidate.endsWith('-javadoc.jar')) {
                candidates.push(candidate);
                break;
              }
            }
          }
          if (candidates.length > 0) break;
        }
      } catch (_) {}
    }
  }

  const m2Repo = path.join(home, '.m2', 'repository');
  if (candidates.length === 0 && fs.existsSync(m2Repo)) {
    const groupPath = path.join(m2Repo, ...groupId.split('.'), artifactId);
    if (fs.existsSync(groupPath)) {
      try {
        const versions = (version && fs.existsSync(path.join(groupPath, version)))
          ? [version]
          : fs.readdirSync(groupPath).sort(compareVersionsDesc);
        for (const v of versions) {
          const jarPath = path.join(groupPath, v, `${artifactId}-${v}.jar`);
          if (fs.existsSync(jarPath) && !jarPath.endsWith('-sources.jar') && !jarPath.endsWith('-javadoc.jar')) {
            candidates.push(jarPath);
            break;
          }
        }
      } catch (_) {}
    }
  }

  return candidates;
}

module.exports = {
  parsePropertiesFile,
  parseMavenSettings,
  getAggregatedProperties,
  getJavaProcessEnv,
  generateGradleInitScript,
  compareVersionsDesc,
  extractDependenciesFromGradleContent,
  extractDependenciesFromToml,
  findJarInCaches,
};
