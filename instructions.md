# INSTRUÇÕES PARA O AGENTE — leia este arquivo antes de qualquer ação

## Regras críticas de edição de arquivos

1. NUNCA reescreva arquivos inteiros. Use APENAS edições cirúrgicas (str_replace / append de blocos).
2. NUNCA hardcode apiKey, token, ou qualquer credencial no código. Sempre leia de configService.
3. NUNCA sobrescreva arquivos de configuração do usuário em ~/.config/.
4. Antes de editar qualquer arquivo existente, leia-o completo primeiro.
5. Após cada edição, rode `node --check <arquivo>` para validar sintaxe antes de continuar.
6. Arquivos novos: crie do zero. Arquivos existentes: edite só com str_replace ou append.
7. Antes de editar main.js ou configService.js, faça backup: `cp <arquivo> <arquivo>.bak`
8. Se um node --check falhar, corrija APENAS o arquivo com erro. Não mexa nos outros.
9. Nunca assuma o conteúdo de um arquivo — sempre leia antes de editar.
10. Nunca instale dependências manualmente no package.json — use apenas `npm install <pacote>`.

## Regra de tamanho de arquivo — OBRIGATÓRIA

11. **Nenhum arquivo JS/CSS pode ultrapassar 500 linhas.**
    - Antes de criar ou expandir qualquer arquivo, conte as linhas atuais.
    - Se uma adição faria o arquivo ultrapassar 500 linhas, PARE e extraia a funcionalidade
      nova (ou a mais isolada existente) para um módulo separado antes de continuar.
    - Padrão de modularização:
      - `main/` → módulos do processo principal (Node/Electron)
      - `renderer/` → módulos do processo renderer (browser)
      - `styles/` → folhas de estilo separadas por domínio
    - O novo módulo deve ser importado/requerido de volta no arquivo original.
    - Após extrair, rode `node --check` em AMBOS os arquivos (original + novo módulo).
    - Esta regra se aplica a qualquer IA ou desenvolvedor que altere este projeto.

## Regras de segurança

- Credenciais vivem APENAS em ~/.config/<app>/config.json e são lidas via configService.
- Nunca logue tokens, apiKeys ou dados sensíveis no console.
- Nunca commite arquivos .bak, .env ou config.json.

## Ordem obrigatória de trabalho

1. Leia o(s) arquivo(s) relevante(s) na íntegra.
2. Planeje a edição mínima necessária (str_replace ou append).
3. Execute a edição.
4. Rode `node --check` no arquivo editado.
5. Só avance para o próximo arquivo se o check passar.

## Validação final obrigatória

Ao terminar qualquer implementação, rode `npm run check`.
Se qualquer check falhar, pare e corrija antes de declarar a tarefa concluída.

## Trava mecânica — `npm run check` e o pre-commit

Esta seção não é sugestão: é uma trava que o git executa, não o agente.

`npm run check` (= `node scripts/check.js`, ~0,2s) valida:

| | Check | Bloqueia? |
|---|---|---|
| E1 | sintaxe de todo `.js` (`vm.Script`, sem executar) | sim |
| E2 | balanço de `{}` e `/* */` em todo `.css` | sim |
| E3 | `<script src>` do HTML apontando pra arquivo inexistente | sim |
| E4 | `window.X = Y` com `Y` não declarado no arquivo | sim |
| W1 | bloco de 8+ linhas duplicado dentro do mesmo CSS | avisa |
| W2 | mesma função global definida em dois módulos do renderer | avisa |
| W3 | arquivo passando de 500 linhas, ou crescendo além do baseline | avisa |

O hook fica em `scripts/githooks/pre-commit` (versionado) e é ativado por
`npm run hooks:install`. Ele roda o check na ÁRVORE DE TRABALHO a cada
`git commit` e **aborta o commit** se houver ERRO.

**Se o seu commit for bloqueado: conserte o erro.** Não use `--no-verify` —
essa válvula existe para o dono do projeto salvar trabalho em andamento, não
para agente contornar validação. O erro aponta arquivo e mensagem exata.

**Por que isso existe:** os commits `75dcf3f` e `55c48f4` entraram com uma
chave `}` faltando em `renderer/chatMessages.js`. O Electron não reclama de
SyntaxError em `<script>` do renderer — o app "abre" normal e só o chat morre.
Resultado: não dava pra digitar nada e a tela ficava vazia, e o diagnóstico
levou horas. O E1 pega isso em 0,2s.

**W3 é catraca, não muro:** o repo já tem 11 arquivos acima de 500 linhas,
registrados em `scripts/.size-baseline.json`. O check só reclama de arquivo que
estoura agora ou que cresce além do que já era — a dívida antiga não vira ruído,
mas também não aumenta. Ao extrair um módulo e reduzir um arquivo, rode
`node scripts/check.js --write-baseline` para reapertar a catraca.

## Contrato de UX — não inverter sem pedido explícito

Estes comportamentos são decisões do dono do projeto. Se você acha que algum
está errado, PERGUNTE — não "corrija" por conta própria:

- Caixa de input do chat: **Shift+Enter envia**, **Enter quebra linha**.
  (Já foi invertida por um agente alegando ser "o padrão de chat". Não é o
  padrão deste projeto.)
- O input do chat é um `contenteditable`, não um `<textarea>`. Trocar o
  elemento não é conserto de bug.
- Digitar com o foco fora do input abre o composer e injeta a primeira tecla
  (`isDirectTypingKey` → `openManualInput`).

