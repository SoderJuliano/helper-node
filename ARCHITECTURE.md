# Helper Node — Architecture & Knowledge Base

> **Para sessões futuras:** este documento é o ponto de entrada. Leia aqui antes de ler código.
> Última atualização: v0.5.1 (2026-07-01).

---

## Propósito do projeto

Copiloto de IA furtivo para Linux. Fica na tela enquanto o usuário faz entrevistas, reuniões ou estuda. Transcreve áudio em tempo real (mic + sistema), lê tela via OCR/visão, aceita perguntas via texto, e responde de forma discreta. Sem notificações nativas, sem API keys embutidas, sem auto-fallback entre providers.

**Regra fundamental:** cada usuário usa sua própria chave. Jamais embutir credenciais.

---

## Stack

- **Runtime:** Electron 36 + Node.js 18+
- **Processo principal:** `main.js` (IPC, providers, spawn de processos)
- **Renderer:** `index.html` (UI do chat), `config.html` (configurações), `preload.js` (bridge segura)
- **Bridge:** `preload.js` expõe `window.electronAPI` via `contextBridge`

---

## Providers de IA

### Roteamento (`main.js` → `send-to-gemini` handler)

```js
if (provider === 'openIa')       → openAIService.js
if (provider === 'ollamaLocal')  → ollamaLocalService.js
if (provider === 'geminiCli')    → GeminiCliProvider (singleton)
if (provider === 'claudeCli')    → ClaudeCliProvider (singleton)
```

Chave `provider` vem de `configService.getAiProvider()`. Sem fallback automático.

### OpenAI (`services/openAIService.js`)
- Function calling para helperTools
- Streaming token a token via SSE
- Modelos: gpt-4.1-nano (padrão), gpt-4.1, gpt-5.1, gpt-4o, gpt-4o-mini

### Gemini CLI (`services/providers/gemini-cli/`)
- Processo REPL persistente por projeto (`gemini --model X` via stdin/stdout)
- Sessão mantida viva enquanto o projeto não muda
- Auth: `~/.gemini/` do usuário (`HOME` explícito no spawn)
- Modelos: `GeminiCliModels.js`

### Claude Code CLI (`services/providers/claude-cli/`)
- **Um processo por mensagem** (`claude --print --output-format stream-json`)
- Continuidade via `--resume <session_id>` (session_id do evento `system/init`)
- Auth: `~/.claude/` do usuário (`HOME` explícito)
- Flags obrigatórias: `--include-partial-messages --verbose --permission-mode bypassPermissions --no-chrome`
- Modelos: fable-5, opus-4-8, sonnet-4-6 (padrão), haiku-4-5

#### Fluxo de eventos Claude CLI (`ClaudeCliParser.js`)

```
stdout linha a linha (NDJSON):
  system/init        → onSessionId, onConnected
  stream_event       → content_block_delta → onThinking (thinking_delta) / onChunk (text_delta)
  assistant          → tool_use → onToolStart, onFileTool(before)
  user               → tool_result → onToolDone, onFileTool(after)
  result/success     → onDone
  result/error       → onError
```

**Dedup importante:** `assistant` completo chega no fim do bloco, mas os deltas já foram emitidos via `stream_event`. Flags `_sawThinkingDelta` / `_sawTextDelta` previnem dupla emissão.

#### Safeclose pattern (ambos CLI providers)

```js
const safeClose = (isError) => {
  if (this._thinkingEmitted) {
    sender.send('agentic-phase-update', { phase: 'completed', ... });
  }
  sender.send('gemini-stream-complete');  // sempre — libera o loading
};
```
`onDone` e `onError` sempre chamam `safeClose`. Abort (`SIGTERM`) resolve silenciosamente via flag `_aborted`.

---

## IPC — eventos principais (renderer ↔ main)

| Evento | Direção | Uso |
|--------|---------|-----|
| `send-to-gemini` | renderer→main | Envia prompt para o provider ativo |
| `gemini-stream-chunk` | main→renderer | Chunk de texto da resposta (streaming) |
| `gemini-stream-complete` | main→renderer | Resposta concluída → fecha loading |
| `agentic-phase-update` | main→renderer | `{ phase, status }` — spinner/thinking/completed |
| `ai-tool-activity` | main→renderer | `{ id, phase:'start'/'done'/'error', label }` |
| `workspace-file-written` | main→renderer | `{ path, backupPath }` — abre diff viewer |
| `stop-agentic-workflow` | renderer→main | Botão × — aborta processo em curso |
| `transcription-error` | main→renderer | Erro visível no chat |

**Campo é `phase`**, não `state`, nas mensagens de tool activity. UI faz `data.phase || data.state` como fallback.

---

## configService (`services/configService.js`)

Configurações persistidas em `userData/config.json`.

```js
getAiProvider() / setAiProvider(p)       // 'openIa' | 'ollamaLocal' | 'geminiCli' | 'claudeCli'
getClaudeCliModel() / setClaudeCliModel(m)
getGeminiCliModel() / setGeminiCliModel(m)
isHelperToolsEnabled()                    // false quando CLI ativo (mutex)
isWorkspaceAccessEnabled()                // true para openIa, geminiCli, claudeCli
```

**Mutex CLI:** CLIs desabilitam `helperTools` (UI mostra como disabled+opaco), mas NÃO desabilitam `workspaceAccess`. O workspace é independente.

---

## UI (`index.html`)

### Renderização de markdown

```js
renderMarkdown(text, idPrefix)   // função unificada
formatStreamedText(t)            // alias → renderMarkdown(t, 'stream')
formatOpenAIResponse(t)          // alias → renderMarkdown(t, 'openai')
```

- Protege blocos ``` antes de processar inline
- `code.inline-code` → `display:inline` (não block)
- `.streaming-response h1/h2/h3`, `ul/ol/li` têm CSS próprio

**Pergunta do usuário:** `setQuestionText(el, text)` — usa `innerHTML = renderMarkdown(...)` e guarda original em `el.dataset.raw`. `getQuestionText(el)` retorna `el.dataset.raw` (não textContent, que incluiria HTML).

### Token counter

`#composer-token-count` — estima `chars/4`, warn ≥ 2k tokens, danger ≥ 4k. Reset ao enviar.

### Realtime mode

Quando `state:'started'` → oculta composer (`setComposerVisibility(false)`).
`Ctrl+I` (keydown local) → toggle visibility.

### Spinner / thinking ao vivo

`agentic-phase-update { phase:'thinking', status: <snippet 140 chars> }` chega a cada 400ms durante o raciocínio. O snippet é os últimos 140 chars do buffer de thinking acumulado. CSS `.ai-phase-text` tem `text-overflow:ellipsis; white-space:nowrap` — uma linha, se atualiza ao vivo.

---

## Ferramentas avançadas (`services/helperTools/`)

Disponíveis apenas para OpenAI (function calling). Desabilitadas quando provider é CLI.

```
Read:  listDir, readFile, readFileChunk, searchInFiles, findFiles, fileInfo, listPackages, detectShellConfig
Write: writeFile, patchFile, appendToFile, deleteFile  (com backup automático)
Exec:  runCommand (whitelist), runShellAdvanced (bash confirmado), systemPowerAction
```

Sandbox restrito a `$HOME`. Secret redactor remove tokens/chaves antes de enviar à IA. Audit log em `~/.config/helper-node/audit.log`.

---

## Histórico e sessões (`services/historyService.js`)

Sessões em `userData/history/`. A UI carrega e exibe via `load-history-list` / `load-history-session`.

---

## RAG / Knowledge base (`services/knowledgeBase.js`)

Busca híbrida: embeddings cosseno + BM25 keyword. Base do usuário vence o treino do modelo. Configurável via config. Persistência em `userData/knowledge/`.

Answer bank (`services/answerBank.js`): salva boas respostas (nota ≥ 4), injeta como dica quando pergunta similar reaparece (cosseno ≥ 0.85).

---

## Assistente em tempo real

Dois caminhos:

| Modo | Quando | Stack |
|------|--------|-------|
| Online | Provider = OpenAI ou edição Lite | `realtimeOpenAiService.js` + `realtimeAudioCapture.js` (parec) |
| Offline | Provider = Ollama/backend + Full | `realtimeAssistantService.js` (Vosk live + Whisper batch) |

Captura de monitor: **`parec --device=<sink>.monitor`** — nunca `pw-record` (cai no mic no PipeWire).

---

## Editions

`services/edition.js` lê `/opt/helper-node/edition.json`. Em dev = full.

| | Lite | Full |
|---|---|---|
| Transcription | OpenAI cloud | Local Whisper.cpp |
| OCR | gpt-4o vision | Tesseract local |
| Providers | OpenAI only | OpenAI + Ollama + backend |
| Offline | Não | Sim |

Empacotamento: `.deb` por edition via `install.sh` (glob fix nas v0.4.x).

---

## Overlay (OS Integration mode)

Janelas `BrowserWindow` posicionadas na tela: recording, loading, response, capture, integratedInput. Overlay flutuante **só no modo OS Integration** — não no modo chat normal. Auto-close controlado por posição global do cursor (main.js). No COSMIC/Wayland o overlay não some das gravações de forma confiável (Wayland ignora `xprop`).

---

## Bugs conhecidos e decisões importantes

| Situação | Decisão |
|----------|---------|
| Claude CLI travou 7min sem mostrar nada | Era o parser ignorando `stream_event`. Corrigido: deltas em tempo real via `thinking_delta`/`text_delta`. |
| `bypassPermissions` vs `auto` | `auto` ainda trava esperando confirmação. Usar sempre `bypassPermissions`. |
| Abort mostra erro | Flag `_aborted` no ClaudeCliSession resolve silenciosamente. |
| Loading não fecha | `safeClose()` em toda saída (done/error/abort). |
| Thinking duplicado | `_sawThinkingDelta` previne re-emissão quando o bloco completo chega. |
| `workspaceAccess` bloqueado para CLI | Mutex só desabilita `helperTools`, não `workspaceAccess`. Corrigido em `setWorkspaceAccessEnabled`. |
| Scrollbar branco no textarea | `scrollbar-width:none` + `::-webkit-scrollbar { display:none }`. |
| Inline code ocupava linha inteira | `.streaming-response code:not(pre code) { display:inline }`. |
| Texto do usuário sem markdown | `setQuestionText()` com `innerHTML = renderMarkdown()` + `data-raw` para edição. |

---

## Estrutura de arquivos principais

```
main.js                          ← processo principal, IPC, roteamento de providers
preload.js                       ← bridge contextBridge → window.electronAPI
index.html                       ← UI principal (chat, composer, history)
config.html / config.js          ← configurações
services/
  configService.js               ← config persistida, getters/setters
  providers/
    claude-cli/
      ClaudeCliProcess.js        ← spawn do processo claude
      ClaudeCliSession.js        ← gerencia sessão (sessionId, abort)
      ClaudeCliParser.js         ← parser NDJSON do stream do CLI
      ClaudeCliProvider.js       ← fachada para main.js, IPC events
      ClaudeCliModels.js
    gemini-cli/
      GeminiCliProcess.js        ← spawn do processo gemini (REPL)
      GeminiCliSession.js        ← sessão persistente + EventEmitter
      GeminiCliParser.js
      GeminiCliProvider.js       ← fachada para main.js
      GeminiCliEvents.js
  helperTools/                   ← ferramentas read/write/exec para OpenAI
  knowledgeBase.js               ← RAG embeddings + BM25
  answerBank.js                  ← banco de respostas boas
  historyService.js              ← persistência de sessões
  realtimeAssistantService.js    ← realtime offline (Vosk + Whisper)
  realtimeOpenAiService.js       ← realtime online (OpenAI)
  realtimeAudioCapture.js        ← captura parec + VAD
  openAIService.js               ← client OpenAI (streaming, tools, vision)
  ollamaLocalService.js          ← client Ollama local
  edition.js                     ← lite vs full
  ipcService.js                  ← servidor Express interno (hotkeys globais)
```
