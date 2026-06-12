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

Ao terminar qualquer implementação, rode node --check em todos os arquivos tocados.
Se qualquer check falhar, pare e corrija antes de declarar a tarefa concluída.

