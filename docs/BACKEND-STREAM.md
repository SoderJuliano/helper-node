# Fluxo do backend (pikachu + Ollama) — como funciona e o que NÃO pode quebrar

Documento nasceu depois de ~5 dias de "o app não responde nada". A causa nunca foi
uma só: eram vários pontos do caminho, cada um capaz de engolir a resposta em
silêncio. Aqui fica o caminho inteiro e os invariantes que precisam continuar
valendo.

Repositório do backend: `pikachu` (Java/Spring, roda no servidor Linux).

---

## 1. O caminho completo de uma pergunta

```
[UI] renderer/chatMessages.js  sentToAI()
   │  escolhe o canal pelo getAiModel()
   │    llama-stream | qwen-stream | ollamaLocal → send-to-gemini-stream  (COM streaming)
   │    qualquer outro                           → send-to-gemini         (SEM streaming)
   ▼
[main] main/ipc/chat.js
   │  prependWorkspaceContextIfNeeded()  → contexto do workspace (1x por sessão)
   │  knowledgeBlockForOllama()          → trechos da base de conhecimento
   │  buildHelperToolsOpenAIOpts()       → tools + onToolCall (se ferramentas ON)
   ▼
[service] services/backendService.js  responderStream()
   │  monta o prompt (idePrompt.js quando há ferramentas)
   │  POST {apiUrl}/chat?model=<backendModel>
   ▼
[rede] services/backendSseClient.js  streamOnce()
   │  fetch com teto de conexão + leitura do SSE com watchdog de stall
   ▼
[parse] services/backendStreamRouter.js
   │  separa RACIOCÍNIO (thinking) de RESPOSTA (answer)
   ▼
[UI] renderer/ipcStreaming.js  → texto na tela + caixa "Raciocínio"
```

No servidor:

```
ModelController.chat()  →  GenericChatService  →  OllamaClientAdapter.genericStream()
                                                     │  POST localhost:11434/api/generate
                                                     │  stream:true, think:true
                                                     ▼
                                                  SSE de volta pro helper-node
```

---

## 2. O protocolo SSE do `/chat` (contrato entre os dois repos)

```
event: thinking-start
data: start

data: {"thinking":"..."}      ← raciocínio, vai pra caixa "Raciocínio"

event: thinking-end
data: done

event: message
data: start

data: {"response":"..."}      ← RESPOSTA, vai pra tela

event: end
data: done
```

### Invariantes que NÃO podem quebrar

1. **Raciocínio vai em `thinking`; resposta vai em `response`.** Foi exatamente
   isto que quebrou por dias: `genericStream` só fechava a fase de raciocínio ao
   ver a tag `</think>`, mas com `think:true` o Ollama manda o raciocínio no
   campo `thinking` e a resposta no `response` — `</think>` nunca aparece. A
   flag ficava presa e **toda a resposta era reetiquetada como `thinking`**. O
   cliente jogava tudo no buffer de raciocínio, `answer` ficava com 0 chars e a
   tela ficava em branco, sem erro nenhum.

   No código: `thinkingOpen` (fase SSE aberta) e `inlineThinking` (`<think>`
   dentro do `response`) são rastreados **separadamente**. Chegou token de
   `response` e não estamos dentro de um `<think>` inline ⇒ o raciocínio acabou,
   fecha a fase. Nunca voltar a usar uma flag só.

2. **`event: end` sempre é enviado**, e a fase de raciocínio é fechada antes
   dele se ficou aberta. Sem isso a caixa "Raciocínio" fica aberta pra sempre no
   cliente.

3. **O servidor NÃO fecha a conexão sozinha** depois do `event: end`. O cliente
   tem que sair do laço no marcador de fim e cancelar o reader — se ficar
   esperando o close, pendura até o watchdog (4 min).

4. **`currentEvent` do parser SSE vive FORA do laço de leitura.** O nome do
   evento vale para as linhas `data:` seguintes, e esse par pode ser partido
   entre dois pacotes de rede (`event: end` no fim de um, `data: done` no começo
   do outro). Resetando por pacote, o marcador de fim se perde.

---

## 3. Verificação rápida: o servidor está com o build certo?

O código corrigido **sempre** emite `event: thinking-end`. Contar marcadores é o
teste binário — direto no servidor:

```bash
curl -N -s -X POST 'http://localhost:8080/chat?model=qwen3.6:35b' \
  -H 'Content-Type: application/json' \
  -d '{"prompt":"responda apenas: OK","language":"PORTUGUESE"}' \
  | tee /tmp/sse.txt | tail -5
echo "thinking-end: $(grep -c 'thinking-end' /tmp/sse.txt) | response: $(grep -c '\"response\"' /tmp/sse.txt)"
```

- `thinking-end: 0` e `response: 0` → **jar ANTIGO rodando**.
- `thinking-end: 1` e `response: > 0` → build correto.

Pegadinha de deploy: o `pom.xml` foi de `0.0.4-SNAPSHOT` para `0.0.5-SNAPSHOT`.
Script/systemd apontando para o jar `0.0.4` sobe o binário velho mesmo depois de
compilar.

Do lado do cliente, `scripts/probe-chat-live.js` imprime o SSE cru com timings.

---

## 4. Regras de diagnóstico (aprendidas na marra)

- **"Nada aparece na tela" não se diagnostica lendo código.** Capture o SSE real
  e olhe o **fim** do corpo. Três diagnósticos por leitura estática erraram antes
  de a captura mostrar a resposta rotulada como `thinking`.
- **Evidência de runtime do usuário ganha da teoria.** "A GPU vai a 100%" provava
  que a requisição chegava e o modelo gerava — o que derrubava as teorias de fila
  travada e de timeout de conexão. Reancorar na evidência, não defender a teoria.
- **Existem DOIS canais de envio.** `send-to-gemini` (sem streaming: sem
  raciocínio ao vivo, resposta só no fim) e `send-to-gemini-stream`. Sintoma
  "demorou muito e não veio thinking nenhum" = canal sem streaming. Há log em
  `[get-ai-model] -> …` e um aviso no `send-to-gemini` para tornar isso visível.
- **Nunca terminar em silêncio.** Stream que acaba sem uma letra de resposta
  avisa o usuário. Tela em branco sem erro foi o que tornou o bug do servidor
  impossível de enxergar pela UI.
- **Nunca despejar o corpo bruto como resposta.** O fallback "answer vazio ⇒ usa
  o corpo bruto" só vale quando o corpo **não é SSE** (checar `data:`/`event:`).
  Sem essa checagem o usuário recebia centenas de linhas de protocolo na tela.
- **Comando Unix via `execSync` quebra no Windows.** `find`/`grep`/`pactl` não
  existem lá; a árvore do projeto ia vazia (`0 chars`) e o modelo não via o
  projeto anexado. Preferir Node puro (`fs`) para qualquer varredura.
- **Heurística que olha o prompt tem que receber a pergunta CRUA.** O texto que
  chega em `responderStream` já vem com o contexto do workspace colado na
  frente; usar ele para decidir intenção fazia todo "oi" cair no modo de análise
  profunda. Use `opts.userText`.
