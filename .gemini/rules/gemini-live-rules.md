# Regras de Arquitetura — Gemini Live & Nexa Voice

1. **PROIBIDO nomes de usuário hardcoded no código ou prompts**:
   NUNCA coloque 'Juliano' ou qualquer nome fixo no código. O nome do usuário deve vir dinamicamente de `configService.getTranslationAssistantConfig().userName` ou ser tratado genericamente como 'o usuário' / 'o desenvolvedor'.

2. **Gemini Live / Nexa — NUNCA force o modelo a falar antes de executar ferramenta**:
   Na Gemini Live API (WebSocket multimodal), um turno é OU áudio OU chamada de função. Se o prompt mandar "fale avisando antes de disparar", o modelo fala "vou fazer", encerra o turno e a chamada de ferramenta é descartada, deixando o usuário sem ação real.
   Deixe o Function Calling disparar a ferramenta diretamente para execução no workspace.

3. **Evite Over-Prompting e Micromanagement de Ferramentas**:
   Não crie regras imperativas robóticas ("SE disser X DISPARE Y"). A IA decide pelo contexto e pelos schemas das ferramentas. Regras engessadas fazem a IA disparar ferramentas de código quando o usuário só está conversando sobre áudio ou tirando dúvidas.

4. **Isolamento de Microfone durante a fala da Nexa (Prevenção de falso Barge-In)**:
   Durante a reprodução de áudio da Nexa, suspenda o envio de chunks do microfone e aplique cooldown de ~400ms após a fala. Caso contrário, ruído ambiente da sala, eco das caixas ou TV ativam o Barge-In da API Google e cortam a voz da IA no meio.

5. **Deduplicação de Cards de Voz no Chat**:
   Eventos do tipo `nexa-voice:quick-reply` NUNCA devem criar cards duplicados ("Pergunta por voz") se o texto já estiver exibido via stream ao vivo no chat.
