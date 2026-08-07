// services/javaLibs/index.js
// Descobre as bibliotecas Java do projeto e o código-fonte delas.
//
// Tudo em Node puro, com path.join e os.homedir() — nada de comando de shell.
// Caminho de repositório e separador mudam entre Windows e Linux, e chamar
// `mvn`/`unzip` amarraria a feature a ferramenta instalada (o helper-node já
// quebrou assim antes, com comando POSIX rodando no Windows).
//
// Funciona igual em Windows, Debian e Arch: o que muda é só a raiz do
// repositório local, resolvida abaixo. Wayland não influi — não há UI aqui.

const fs = require('fs');
const os = require('os');
const path = require('path');
const zip = require('./zipReader');

// ── Repositórios locais ────────────────────────────────────────────────────

// `<localRepository>` do settings.xml tem precedência sobre o padrão.
function repoDoSettings() {
  const settings = path.join(os.homedir(), '.m2', 'settings.xml');
  try {
    if (!fs.existsSync(settings)) return null;
    const xml = fs.readFileSync(settings, 'utf8');
    const m = xml.match(/<localRepository>\s*([^<]+?)\s*<\/localRepository>/i);
    if (!m) return null;
    let p = m[1].trim();
    // settings.xml aceita ${user.home}
    p = p.replace(/\$\{user\.home\}/g, os.homedir());
    return fs.existsSync(p) ? p : null;
  } catch (_) { return null; }
}

function repositoriosLocais() {
  const repos = [];
  const push = (p) => { if (p && fs.existsSync(p) && !repos.includes(p)) repos.push(p); };

  if (process.env.M2_REPO) push(process.env.M2_REPO);
  push(repoDoSettings());
  push(path.join(os.homedir(), '.m2', 'repository'));

  const gradleHome = process.env.GRADLE_USER_HOME || path.join(os.homedir(), '.gradle');
  push(path.join(gradleHome, 'caches', 'modules-2', 'files-2.1'));

  return repos;
}

// ── Leitura das dependências declaradas ────────────────────────────────────

function propriedadesDoPom(xml) {
  const props = {};
  const bloco = xml.match(/<properties>([\s\S]*?)<\/properties>/i);
  if (bloco) {
    const re = /<([A-Za-z0-9_.-]+)>\s*([^<]*?)\s*<\/\1>/g;
    let m;
    while ((m = re.exec(bloco[1])) !== null) props[m[1]] = m[2];
  }
  // versão do próprio projeto, usada por ${project.version}
  const v = xml.match(/<version>\s*([^<$]+?)\s*<\/version>/i);
  if (v) { props['project.version'] = v[1]; props['version'] = v[1]; }
  return props;
}

function resolverProps(valor, props, profundidade = 0) {
  if (!valor || profundidade > 5) return valor;
  const subst = valor.replace(/\$\{([^}]+)\}/g, (todo, chave) =>
    props[chave] !== undefined ? props[chave] : todo);
  return subst === valor ? valor : resolverProps(subst, props, profundidade + 1);
}

function depsDoPom(pomPath) {
  let xml = '';
  try { xml = fs.readFileSync(pomPath, 'utf8'); } catch (_) { return []; }
  const props = propriedadesDoPom(xml);

  const deps = [];
  const re = /<dependency>([\s\S]*?)<\/dependency>/gi;
  let m;
  while ((m = re.exec(xml)) !== null) {
    const bloco = m[1];
    const g = bloco.match(/<groupId>\s*([^<]+?)\s*<\/groupId>/i);
    const a = bloco.match(/<artifactId>\s*([^<]+?)\s*<\/artifactId>/i);
    const v = bloco.match(/<version>\s*([^<]+?)\s*<\/version>/i);
    if (!g || !a) continue;
    deps.push({
      groupId: resolverProps(g[1], props),
      artifactId: resolverProps(a[1], props),
      // Sem <version> a versão vem do dependencyManagement/parent (BOM do
      // Spring, por exemplo). Não resolvemos POM pai: nesse caso procuramos
      // qualquer versão presente no repositório local.
      version: v ? resolverProps(v[1], props) : null,
      origem: 'maven',
    });
  }
  return deps;
}

function depsDoGradle(gradlePath) {
  let txt = '';
  try { txt = fs.readFileSync(gradlePath, 'utf8'); } catch (_) { return []; }
  const deps = [];
  // implementation 'g:a:v' / api("g:a:v") / compileOnly 'g:a'
  const re = /\b(?:implementation|api|compileOnly|runtimeOnly|testImplementation|annotationProcessor)\s*\(?\s*['"]([^'"\s:]+):([^'"\s:]+)(?::([^'"\s]+))?['"]/g;
  let m;
  while ((m = re.exec(txt)) !== null) {
    deps.push({ groupId: m[1], artifactId: m[2], version: m[3] || null, origem: 'gradle' });
  }
  return deps;
}

// Varre o projeto atrás de pom.xml / build.gradle (inclusive multi-módulo),
// sem descer em pastas de build.
const IGNORAR = new Set(['node_modules', '.git', 'target', 'build', 'out', 'bin', '.idea', '.gradle']);
function acharArquivosDeBuild(raiz, profundidade = 0, achados = []) {
  if (profundidade > 3) return achados;
  let entradas = [];
  try { entradas = fs.readdirSync(raiz, { withFileTypes: true }); } catch (_) { return achados; }
  for (const e of entradas) {
    if (e.isDirectory()) {
      if (IGNORAR.has(e.name)) continue;
      acharArquivosDeBuild(path.join(raiz, e.name), profundidade + 1, achados);
    } else if (e.name === 'pom.xml' || e.name === 'build.gradle' || e.name === 'build.gradle.kts') {
      achados.push(path.join(raiz, e.name));
    }
  }
  return achados;
}

// ── Resolução do artefato no repositório local ─────────────────────────────

function candidatosMaven(repo, dep) {
  const dir = path.join(repo, ...dep.groupId.split('.'), dep.artifactId);
  if (!fs.existsSync(dir)) return [];
  let versoes = [];
  if (dep.version) {
    versoes = [dep.version];
  } else {
    try {
      versoes = fs.readdirSync(dir, { withFileTypes: true })
        .filter(d => d.isDirectory()).map(d => d.name).sort().reverse();
    } catch (_) { return []; }
  }
  const saida = [];
  for (const v of versoes) {
    const base = path.join(dir, v, `${dep.artifactId}-${v}`);
    const jar = base + '.jar';
    const fontes = base + '-sources.jar';
    if (fs.existsSync(jar) || fs.existsSync(fontes)) {
      saida.push({
        version: v,
        jar: fs.existsSync(jar) ? jar : null,
        sources: fs.existsSync(fontes) ? fontes : null,
      });
      break; // primeira versão que existe basta
    }
  }
  return saida;
}

// O cache do Gradle guarda cada arquivo sob um diretório de hash.
function candidatosGradle(repo, dep) {
  const dir = path.join(repo, dep.groupId, dep.artifactId);
  if (!fs.existsSync(dir)) return [];
  let versoes = [];
  try {
    versoes = fs.readdirSync(dir, { withFileTypes: true })
      .filter(d => d.isDirectory()).map(d => d.name);
  } catch (_) { return []; }
  if (dep.version && versoes.includes(dep.version)) versoes = [dep.version];
  else versoes = versoes.sort().reverse();

  for (const v of versoes) {
    const versaoDir = path.join(dir, v);
    let jar = null, fontes = null;
    let hashes = [];
    try { hashes = fs.readdirSync(versaoDir, { withFileTypes: true }).filter(d => d.isDirectory()); } catch (_) { continue; }
    for (const h of hashes) {
      let arquivos = [];
      try { arquivos = fs.readdirSync(path.join(versaoDir, h.name)); } catch (_) { continue; }
      for (const f of arquivos) {
        const completo = path.join(versaoDir, h.name, f);
        if (/-sources\.jar$/.test(f)) fontes = completo;
        else if (/\.jar$/.test(f)) jar = completo;
      }
    }
    if (jar || fontes) return [{ version: v, jar, sources: fontes }];
  }
  return [];
}

function resolverArtefato(dep, repos) {
  for (const repo of repos) {
    const ehGradle = repo.includes(`${path.sep}caches${path.sep}modules-2`);
    const achados = ehGradle ? candidatosGradle(repo, dep) : candidatosMaven(repo, dep);
    if (achados.length) return { ...achados[0], repo };
  }
  return null;
}

// ── API pública ────────────────────────────────────────────────────────────

// Lista as bibliotecas do projeto, com o que foi possível localizar em disco.
function listarBibliotecas(projectPath) {
  if (!projectPath || !fs.existsSync(projectPath)) return { ok: false, libs: [], erro: 'projeto inválido' };

  const arquivos = acharArquivosDeBuild(projectPath);
  if (!arquivos.length) return { ok: true, libs: [], nota: 'nenhum pom.xml ou build.gradle encontrado' };

  const repos = repositoriosLocais();
  const vistos = new Set();
  const libs = [];

  for (const arq of arquivos) {
    const deps = path.basename(arq) === 'pom.xml' ? depsDoPom(arq) : depsDoGradle(arq);
    for (const dep of deps) {
      const chave = `${dep.groupId}:${dep.artifactId}`;
      if (vistos.has(chave)) continue;
      vistos.add(chave);
      const art = resolverArtefato(dep, repos);
      libs.push({
        groupId: dep.groupId,
        artifactId: dep.artifactId,
        version: (art && art.version) || dep.version || null,
        jar: art ? art.jar : null,
        sources: art ? art.sources : null,
        temFonte: !!(art && art.sources),
        baixada: !!art,
        origem: dep.origem,
      });
    }
  }

  libs.sort((a, b) => (a.artifactId || '').localeCompare(b.artifactId || ''));
  return { ok: true, libs, repos };
}

module.exports = {
  listarBibliotecas,
  repositoriosLocais,
  depsDoPom,
  depsDoGradle,
  resolverArtefato,
  acharArquivosDeBuild,
  zip,
};
