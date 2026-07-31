// Lista de modelos da GitHub Copilot CLI.
//
// Diferente do ClaudeCliModels.js, aqui NÃO existe (até onde a documentação
// oficial mostra) um jeito não-interativo de perguntar pro binário quais
// modelos estão disponíveis — o único seletor é o `/model` dentro da sessão
// interativa (TUI, provavelmente com pty), sem equivalente a
// `claude --print "/model"`. Ver a saga de bugs do ClaudeCliModels.js antes
// de "resolver" isso inventando um parser sem confirmar contra o binário real.
//
// Por isso esta lista NÃO é dinâmica — são os exemplos citados na doc oficial
// (docs.github.com/en/copilot/reference/copilot-cli-reference/
// cli-programmatic-reference), explicitamente marcados como não verificados
// ao vivo. Numa conta corporativa a org pode liberar um subconjunto diferente
// (ver `services/providers/copilot-cli/README` se/quando for escrito).
//
// TODO assim que houver uma máquina com `copilot` instalado à mão:
//   1. Rodar `copilot --help` e `copilot -p "/model" --allow-all-tools` (ou o
//      que o --help indicar) pra ver se existe forma de listar sem TUI.
//   2. Se não existir, pelo menos confirmar que os IDs abaixo ainda resolvem
//      com `copilot -p "oi" --model <id>` sem erro de "model not found".
const DEFAULT_MODEL = 'claude-sonnet-4.5'; // default documentado do próprio CLI

// ⚠️ Não verificado ao vivo — só o que a doc oficial cita como exemplo.
const DOCUMENTED_EXAMPLES = [
  { id: 'claude-sonnet-4.5', label: 'Claude Sonnet 4.5 (default)' },
  { id: 'claude-sonnet-4.6', label: 'Claude Sonnet 4.6' },
  { id: 'claude-fable-5',    label: 'Claude Fable 5' },
  { id: 'gpt-5.2',           label: 'GPT-5.2' },
];

async function getModels() {
  return DOCUMENTED_EXAMPLES;
}

function getDefaultModel() {
  return DEFAULT_MODEL;
}

// Sem descoberta dinâmica real ainda — mantido pra manter a mesma interface
// pública do ClaudeCliModels.js (chamado pelo botão de refresh, se existir).
async function refresh() {
  return DOCUMENTED_EXAMPLES;
}

module.exports = { DEFAULT_MODEL, getModels, getDefaultModel, refresh };
