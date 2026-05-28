// services/helperTools/shouldEngage.js
// Decide se uma mensagem do usuário deve ativar o módulo de ferramentas.
// MVP: regex de palavras-chave. Rápido (0ms) e zero custo. Se gerar muitos
// falsos negativos no uso real, depois adicionamos um classifier LLM.

const TRIGGERS = [
  // Edição de arquivos (mais flexível: objeto opcional ou antes da ação)
  /\b(edit(a|ar|e)?|alter(a|ar|e)?|corrig(e|ir)|consert(a|ar|e)|arrum(a|ar|e)|refator(a|ar|e)|melhor(a|ar|e)?|mud(a|ar|e)|troc(a|ar|e))\b.*\b(arquivo|script|config|c[oó]digo|fonte|projeto|pasta|diret[oó]rio|ui|layout|interface|css|html|js|ts|java|python|cpp|c#|php)\b/i,
  /\b(arquivo|script|config|c[oó]digo|fonte|projeto|ui|layout|interface)\b.*\b(edit(a|ar|e)?|alter(a|ar|e)?|corrig(e|ir)|consert(a|ar|e)|arrum(a|ar|e)|refator(a|ar|e)|melhor(a|ar|e)?|mud(a|ar|e)|troc(a|ar|e))\b/i,
  
  // Triggers específicos de correção sem objeto explícito (ex: "tem um bug aqui, corrige")
  /\b(corrig(e|ir)|consert(a|ar|e)|arrum(a|ar|e))\s+(isso|aqui|o bug|o erro|o problema)\b/i,

  // Leitura e Análise
  /\b(analis(a|ar|e)|explor(a|ar|e)|le(ia|r)|abre|abr(a|ir)|mostr(a|ar|e)|v[eê]r?)\b.*\b(arquivo|script|conte[uú]do|c[oó]digo|projeto|pasta|diret[oó]rio|ui|layout|interface|css|html|js|ts|java|python|cpp|c#|php)\b/i,
  /\b(qual|que)\s+(o|é o)?\s*conte[uú]do\s+(do|de)\b/i,
  /\b(o que tem|o que h[aá])\s+(no|em|dentro de)\s+(projeto|diret[oó]rio|pasta|arquivo)\b/i,

  // Busca
  /\b(procur(a|ar|e)|busc(a|ar|e)|encontr(a|ar|e)|ach(a|ar|e))\b.*\b(no|em|nos|nas)\s+(projeto|reposit[oó]rio|arquivos|c[oó]digo|c[oó]digos|pasta|diret[oó]rio)\b/i,
  /\bgrep\b/i,
  
  // Geração de arquivos
  /\b(cri(a|ar|e)|ger(a|ar|e)|fa[çc]a|escrev(a|er))\b.*\b(arquivo|script|yaml|yml|json|dockerfile|docker-compose|compose|makefile|c[oó]digo|html|css|js|ts|readme)\b/i,
  /\b(monta|montar|cri[ae])\s+(um)?\s*(yaml|json|projeto|boilerplate)\b/i,

  // Comandos do sistema e automação
  /\b(roda|rod(a|ar|e)|execut(a|ar|e))\b.*\b(comando|script|teste|build|projeto|depend[êe]ncia)\b/i,
  /\b(instal(a|ar|e))\s+(o\s+)?[a-z0-9\-_]+/i,
  /\b(git|npm|yarn|pnpm|cargo|docker|kubectl|systemctl)\b/i,
  /\b(deslig(a|ar|ue)|reinici(a|ar|e)|reboot|shutdown|suspende(r)?)\b/i,
  /\bsudo\b/i,

  // Arquivos de sistema e conhecidos
  /\b(no|em|dentro\s+do)\s+(meu\s+)?\.?(bashrc|zshrc|profile|gitconfig|npmrc|env(\.example)?|gitignore|package\.json|index\.html|main\.js|config\.js)\b/i,

  // Problemas técnicos
  /\b(meu\s+)?(java|node|python|docker|git|nginx|systemd|service|servidor|backend|frontend)\s+(n[ãa]o\s+)?(funciona|esta\s+rodando|abre|conecta|responde)/i,
  /\b(n[ãa]o\s+)?(consigo|estou\s+conseguindo)\s+(achar|encontrar|rodar|executar|abrir|instalar|fazer)\b/i,
  /\b(como|onde)\s+conserto\s+o\s+bug\b/i,
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

// Mesma regex acima, mas só sinaliza "alta probabilidade de precisar de tools
// pesadas" → caller pode usar pra trocar pro modelHeavy. Quando o módulo está
// ligado, as tools são SEMPRE oferecidas (let the LLM decide), independente
// deste sinal.
function shouldForceHeavyModel(text) {
  return shouldEngage(text);
}

module.exports = { shouldEngage, shouldForceHeavyModel };
