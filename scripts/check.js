#!/usr/bin/env node
// scripts/check.js — validação estrutural do projeto (sem dependência externa).
//
// Existe porque a regra "rode node --check" do instructions.md é prosa: depende
// da boa vontade de quem edita, e já foi ignorada (commits 75dcf3f/55c48f4
// entraram com SyntaxError e derrubaram o chat inteiro em silêncio).
// Aqui a validação é mecânica: roda no pre-commit e não pede licença.
//
// Uso:  node scripts/check.js        (ou: npm run check)
// Saída: exit 1 se houver ERRO. WARN nunca bloqueia.

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const SKIP_DIRS = new Set(['node_modules', '.git', 'build', 'dist', '.idea', 'assets', 'eng.traineddata']);
const MAX_LINES = 500;
const BASELINE = path.join(__dirname, '.size-baseline.json');

const errors = [];
const warns = [];
const err = (file, msg) => errors.push({ file, msg });
const warn = (file, msg) => warns.push({ file, msg });
const rel = (p) => path.relative(ROOT, p).replace(/\\/g, '/');

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

const ALL = walk(ROOT);
const byExt = (ext) => ALL.filter((f) => f.endsWith(ext));
const read = (f) => fs.readFileSync(f, 'utf8');

// ── E1: sintaxe JS ────────────────────────────────────────────────────────────
// vm.Script compila sem executar — mesmo parser do node --check, mas tudo num
// processo só (0,2s p/ 130 arquivos vs 10s abrindo um processo por arquivo).
function checkJsSyntax() {
  for (const f of byExt('.js')) {
    try {
      new vm.Script(read(f), { filename: f });
    } catch (e) {
      err(rel(f), `sintaxe inválida — ${e.message}`);
    }
  }
}

// ── E2: balanço de chaves e comentários no CSS ────────────────────────────────
// Não existe `--check` pra CSS, e o parser do browser falha em SILÊNCIO: um
// comentário sem `/*` de abertura faz ele descartar regras sem avisar ninguém.
function checkCssBalance() {
  for (const f of byExt('.css')) {
    const src = read(f);
    const open = (src.match(/\/\*/g) || []).length;
    const close = (src.match(/\*\//g) || []).length;
    if (open !== close) {
      err(rel(f), `comentários desbalanceados — ${open} "/*" para ${close} "*/"`);
      continue; // sem comentário fechado, contar chaves não faz sentido
    }
    const stripped = src.replace(/\/\*[\s\S]*?\*\//g, '');
    const o = (stripped.match(/\{/g) || []).length;
    const c = (stripped.match(/\}/g) || []).length;
    if (o !== c) err(rel(f), `chaves desbalanceadas — ${o} "{" para ${c} "}"`);
  }
}

// ── E3: <script src> apontando pra arquivo que não existe ─────────────────────
// Um src errado é 404 silencioso: o módulo simplesmente não carrega.
function checkScriptSrc() {
  for (const f of byExt('.html')) {
    const src = read(f);
    const re = /<script[^>]+src\s*=\s*["']([^"']+)["']/gi;
    let m;
    while ((m = re.exec(src))) {
      const ref = m[1];
      if (/^(https?:)?\/\//.test(ref) || ref.startsWith('data:')) continue;
      const target = path.resolve(path.dirname(f), ref.split(/[?#]/)[0]);
      if (!fs.existsSync(target)) err(rel(f), `<script src="${ref}"> não existe em disco`);
    }
  }
}

// ── E4: window.X = Y com Y não declarado no próprio arquivo ───────────────────
// Cada módulo do renderer roda na sua IIFE e se comunica por window.X. Exportar
// um nome que não existe ali dá ReferenceError, que ABORTA o resto da IIFE em
// silêncio — todos os listeners abaixo do erro nunca são registrados.
function declaredNames(src) {
  const names = new Set();
  const add = (re, g = 1) => {
    let m;
    while ((m = re.exec(src))) names.add(m[g]);
  };
  add(/\b(?:function|class)\s*\*?\s*([A-Za-z_$][\w$]*)/g);
  add(/\b(?:var|let|const)\s+([A-Za-z_$][\w$]*)/g);
  // parâmetros de função e destructuring: qualquer identificador dentro de
  // ( ... ) ou { ... } de declaração. Grosseiro de propósito — aqui um falso
  // NEGATIVO é barato, um falso POSITIVO bloquearia um commit legítimo.
  let m;
  // sem \b antes do "(": ele não casa em `async ({...}) => {`, que é
  // exatamente a forma dos callbacks de IPC usados no renderer.
  const params = /(?:function\s*\*?\s*[\w$]*\s*)?\(([^()]*)\)\s*(?:=>|\{)/g;
  while ((m = params.exec(src))) {
    for (const t of m[1].match(/[A-Za-z_$][\w$]*/g) || []) names.add(t);
  }
  const destr = /\b(?:var|let|const)\s*[{[]([^}\]]*)[}\]]/g;
  while ((m = destr.exec(src))) {
    for (const t of m[1].match(/[A-Za-z_$][\w$]*/g) || []) names.add(t);
  }
  return names;
}

function checkWindowExports() {
  for (const f of byExt('.js')) {
    if (!rel(f).startsWith('renderer/')) continue;
    const src = read(f);
    const names = declaredNames(src);
    const re = /window\.([A-Za-z_$][\w$]*)\s*=\s*([A-Za-z_$][\w$]*)\s*[;\n]/g;
    let m;
    while ((m = re.exec(src))) {
      const id = m[2];
      if (/^(true|false|null|undefined|window|document|this)$/.test(id)) continue;
      if (!names.has(id)) {
        err(rel(f), `window.${m[1]} = ${id}, mas "${id}" não é declarado neste arquivo (ReferenceError mata a IIFE inteira)`);
      }
    }
  }
}

// ── W1: bloco duplicado colado dentro do mesmo CSS ────────────────────────────
// Foi o que aconteceu no chat.css: 215 linhas coladas em duplicata no meio do
// arquivo. Detecta qualquer run de 8+ linhas idênticas repetido.
const WINDOW = 8;
function checkCssDupBlocks() {
  for (const f of byExt('.css')) {
    const lines = read(f)
      .split(/\r?\n/)
      .map((l, i) => ({ i: i + 1, t: l.trim() }))
      .filter((l) => l.t.length > 0);
    const seen = new Map();
    let hit = null;
    for (let i = 0; i + WINDOW <= lines.length; i++) {
      const key = lines.slice(i, i + WINDOW).map((l) => l.t).join('\n');
      if (seen.has(key)) { hit = { first: seen.get(key), dup: lines[i].i }; break; }
      seen.set(key, lines[i].i);
    }
    if (hit) warn(rel(f), `bloco de ${WINDOW}+ linhas duplicado (linha ${hit.first} repetida na linha ${hit.dup})`);
  }
}

// ── W2: mesma função global definida em dois módulos do renderer ──────────────
// Todos compartilham o escopo global: quem carrega por último vence, e a outra
// cópia vira código morto que engana quem abrir o arquivo errado.
function checkDupGlobals() {
  const map = new Map();
  for (const f of byExt('.js')) {
    if (!rel(f).startsWith('renderer/')) continue;
    const re = /^\s*function\s+([A-Za-z_$][\w$]*)\s*\(/gm;
    let m;
    const src = read(f);
    while ((m = re.exec(src))) {
      if (!map.has(m[1])) map.set(m[1], new Set());
      map.get(m[1]).add(rel(f));
    }
  }
  for (const [name, files] of map) {
    if (files.size > 1) warn('renderer/', `função "${name}" definida em ${[...files].join(' e ')}`);
  }
}

// ── W3: regra 11 (500 linhas), em modo catraca ────────────────────────────────
// O repo já tem violações antigas; avisar sobre elas todo commit vira ruído e
// treina todo mundo a ignorar warning. Então só reclama de arquivo que ESTOURA
// agora ou que CRESCE além do que já era. A dívida não some, mas não aumenta.
function checkFileSize() {
  let baseline = {};
  try { baseline = JSON.parse(fs.readFileSync(BASELINE, 'utf8')); } catch (_) {}
  for (const f of ALL) {
    if (!/\.(js|css|html)$/.test(f)) continue;
    const r = rel(f);
    const n = read(f).split(/\r?\n/).length;
    const base = baseline[r];
    if (base === undefined) {
      if (n > MAX_LINES) warn(r, `${n} linhas — passou do limite de ${MAX_LINES} (regra 11: extraia um módulo)`);
    } else if (n > base) {
      warn(r, `${n} linhas — já estava acima do limite (${base}) e CRESCEU (regra 11: extraia um módulo)`);
    }
  }
}

// ── baseline ──────────────────────────────────────────────────────────────────
function writeBaseline() {
  const out = {};
  for (const f of ALL) {
    if (!/\.(js|css|html)$/.test(f)) continue;
    const n = read(f).split(/\r?\n/).length;
    if (n > MAX_LINES) out[rel(f)] = n;
  }
  fs.writeFileSync(BASELINE, JSON.stringify(out, null, 2) + '\n');
  console.log(`baseline gravado: ${Object.keys(out).length} arquivos acima de ${MAX_LINES} linhas.`);
}

// ── main ──────────────────────────────────────────────────────────────────────
if (process.argv.includes('--write-baseline')) { writeBaseline(); process.exit(0); }

checkJsSyntax();
checkCssBalance();
checkScriptSrc();
checkWindowExports();
checkCssDupBlocks();
checkDupGlobals();
checkFileSize();

for (const w of warns) console.log(`  aviso  ${w.file}: ${w.msg}`);
for (const e of errors) console.log(`  ERRO   ${e.file}: ${e.msg}`);

if (errors.length) {
  console.log(`\n${errors.length} erro(s). Corrija antes de commitar (ou use --no-verify se for proposital).`);
  process.exit(1);
}
console.log(`ok — ${byExt('.js').length} js, ${byExt('.css').length} css${warns.length ? `, ${warns.length} aviso(s)` : ''}.`);
