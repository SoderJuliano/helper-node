// services/helperTools/shouldEngage.js
// Decide se uma mensagem do usuário deve ativar o módulo de ferramentas.
// MVP: regex de palavras-chave. Rápido (0ms) e zero custo. Se gerar muitos
// falsos negativos no uso real, depois adicionamos um classifier LLM.

const TRIGGERS = [
  // Edição de arquivos
  /\b(edit(a|ar|e)?|alter(a|ar|e)?|corrig(e|ir)|conserta|arruma|refator(a|ar))\s+(o|meu|este|esse|essa)?\s*(arquivo|script|config|c[oó]digo|fonte|projeto)\b/i,
  /\b(adicion(a|ar|e)|insir(a|e)|coloc(a|ar)|p[õo]e)\s+.{0,40}\s+(no|em|dentro)\s+(o\s+)?(arquivo|script)\b/i,
  /\b(no|em|dentro\s+do)\s+(meu\s+)?\.?(bashrc|zshrc|profile|gitconfig|npmrc|env(\.example)?|gitignore)\b/i,
  /\bedit(a|ar|e)\s+meu\s+\.?(bashrc|zshrc|profile|gitconfig|npmrc|env|gitignore|config|fish)\b/i,

  // Leitura
  /\b(le(ia|r)|abre|abr(a|ir)|mostr(a|ar|e)|v[eê]r?)\s+(o|esse|este|meu)?\s*(arquivo|script|conte[uú]do|c[oó]digo)\b/i,
  /\b(qual|que)\s+(o|é o)?\s*conte[uú]do\s+(do|de)\b/i,
  /\b(o que tem|o que h[aá])\s+(no|em|dentro de)\b/i,

  // Busca
  /\bprocur(a|ar|e)\s+(por\s+)?["'].+["']\s+(no|em|nos|nas)\b/i,
  /\bgrep\b/i,
  /\bbusc(a|ar|e)\s+.{0,40}\s+(no|em|nos|nas)\s+(projeto|reposit[oó]rio|arquivos|c[oó]digo|c[oó]digos)\b/i,
  /\bfind\s+.+\s+in\b/i,

  // Geração de arquivos
  /\b(cri(a|ar|e)|ger(a|ar|e)|fa[çc]a|escrev(a|er))\s+(um|o|esse)\s+(arquivo|script|yaml|yml|json|dockerfile|docker-compose|compose|makefile|c[oó]digo)\b/i,
  /\b(monta|montar|cri[ae])\s+(um)?\s*yaml\b/i,

  // Comandos do sistema
  /\b(roda|rod(a|ar|e)|execut(a|ar|e))\s+(esse\s+)?(comando|script|teste)\b/i,
  /\b(instal(a|ar|e))\s+(o\s+)?[a-z0-9\-_]+/i,
  /\b(deslig(a|ar|ue)|reinici(a|ar|e)|reboot|shutdown)\b/i,
  /\bsudo\b/i,

  // Ajuda sobre o sistema
  /\b(meu\s+)?(java|node|python|docker|git|nginx|systemd|service)\s+(n[ãa]o\s+)?(funciona|esta\s+rodando|abre|conecta)/i,
  /\b(n[ãa]o\s+)?(consigo|estou\s+conseguindo)\s+(achar|encontrar|rodar|executar|abrir|instalar)\b/i,
];

function shouldEngage(text) {
  if (!text || typeof text !== "string") return false;
  const t = text.trim();
  if (t.length < 3) return false;
  for (const re of TRIGGERS) {
    if (re.test(t)) return true;
  }
  return false;
}

module.exports = { shouldEngage };
