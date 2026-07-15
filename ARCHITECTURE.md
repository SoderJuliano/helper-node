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

### Ctrl+D — modo IDE × modo janela (push-to-talk)

`Ctrl+D` (fora do Assistente em Tempo Real) tem DOIS comportamentos, decididos por `workspace.list().length > 0` (há pasta ou arquivo anexado no sidebar, independente de "Ferramentas avançadas" estar ligado):

- **Modo janela** (nenhum anexo no workspace): comportamento antigo — grava, transcreve (Whisper local na Full / `gpt-4o-mini-transcribe` na Lite) e **envia direto pra IA** (`getIaResponse` / `processOsQuestion` em OS Integration).
- **Modo IDE** (pasta/arquivo anexado): grava e transcreve igual, mas **NÃO envia sozinho** — o texto vai pro composer (`ide-audio-transcribed` → `openManualInput(text)`) pra o usuário revisar/editar e mandar com Shift+Enter ou o botão Enviar. Enquanto grava, mostra `#composer-listening` (bolinha em pulso + "Ouvindo áudio… Ctrl+D para transcrever") em vez do robot/loading padrão.
- **Providers CLI (`geminiCli` / `claudeCli`) + modo IDE**: bloqueados — esses CLIs não expõem erro tratável quando recebem áudio fora do fluxo esperado (ficavam travando com "Failed to process IA response"). Ao apertar Ctrl+D nesse combo, `toggleRecording()` recusa a gravação e manda `transcription-error` avisando pra trocar de modelo. Aviso também aparece discreto em Configurações (`#gemini-cli-info` / `#claude-cli-info`).

Motivo: CLI providers gerenciam o próprio contexto/sessão de forma nativa e não têm um canal de erro amigável pra áudio mal formatado — silenciosamente travavam. Full com OpenAI/Ollama usa Whisper local normalmente nesse fluxo.

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

Busca híbrida: embeddings cosseno + BM25 keyword. Base do usuário vence o treino do modelo. Configurável via config. Persistência em `userData/knowledge/` (`source.md` consolidado + `index.json` com chunks/embeddings).

**Fluxo de edição em Configurações (v0.5.2+):** o campo de texto é só para ADICIONAR — não carrega o arquivo consolidado ao abrir (`kb-get` não manda mais `source`, só `sourcePath` + `chunks`). Ao "Salvar e Fechar", `appendSource()` (não `save()`) processa SÓ o trecho novo (reescreve com IA se a base estiver habilitada, chunka, embeda) e empilha no índice existente + anexa ao final do `source.md`. Texto vazio → no-op instantâneo, sem chamada de rede. Link "Ver base completa" abre `sourcePath` no visualizador de arquivos da janela principal via IPC (`kb-open-source-file` → main → `open-file-in-viewer` → `openFileViewer()`), já que Configurações é uma `BrowserWindow` separada. `save()` (full replace) continua existindo mas não é mais chamado pela UI.

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
| 2º envio no Claude CLI travava/atrasava | stdin ficava aberto → CLI espera dados (3s+ ou hang). Corrigido: `stdin.end()` logo após o spawn em `ClaudeCliProcess`. |
| Reenvio com processo anterior ainda vivo | `ClaudeCliSession.send()` agora aborta o processo anterior antes de iniciar o novo (nunca dois disputando a sessão). |
| API 529/retry silencioso → tela estática por minutos | Watchdog em `ClaudeCliSession`: stderr com retry vira status na UI (`onStatus` → `agentic-phase-update`), aviso após 45s mudo, kill+erro após 10min. |
| Clique na pergunta abria edição sem querer | Edição só abre pelo lápis (`wireQuestionEdit` checa `.edit-icon`). Editor tem botão "Cancelar (Esc)"; Esc funciona via handler capture global; Enter envia, Shift+Enter quebra linha. Abrir o editor NÃO cancela mais a request em curso (só o envio cancela). |
| Botões de copiar "não faziam nada" | `navigator.clipboard` rejeita sem foco na janela (overlay). Tudo copia via `copyTextReliable()` → `electronAPI.copyToClipboard` (IPC/Electron). "Copiar tudo" agora inclui `.streaming-response` (respostas CLI). |
| Tela "morre" sem erro (créditos/rate limit) | CLI emite `rate_limit_event` top-level (`{status, rateLimitType, ...}`). `status !== 'allowed'` = causa real do travamento silencioso — a API pausa sem imprimir nada. Parser emite `onRateLimit`; provider mostra na hora, sem esperar o watchdog de 45s. |
| Sem prova de que o Claude CLI está trabalhando | CLI já manda `system/thinking_tokens` (contagem real cumulativa, frequente durante raciocínio) + `usage` real no evento `result`. Parser emite `onTokenUpdate({thinking, outputChars})` a cada delta; Provider unifica com o snippet de thinking num único `emitProgress()` throttled (400ms) → status mostra `~N tokens` mesmo sem thinking visível (fase de geração pura de texto). |
| Custo sempre `$0.000000` no log | Bug antigo: parser lia `ev.cost_usd`, mas o campo real do evento `result` é `total_cost_usd`. Corrigido — custo real aparece no log e no status final ("Concluído · N tokens gerados · $X"). |
| Diff da IA mostrava tudo como "adicionado" (nada vermelho/branco) | `ClaudeCliProvider` mandava o campo `backupPath` no `workspace-file-written`, mas o handler `get-file-diff` (main.js) e todo o resto do código (writeFile.js/patchFile.js) usa `backupAt`. Sem bater o nome, `backupAt` chegava `undefined` → diff comparava contra `""` → tudo virava "add". O algoritmo de diff (`computeLineDiff`, LCS linha a linha) sempre esteve correto; só faltava o campo certo chegar até ele. |
| Dropdown da árvore de arquivos (sidebar) curto | `.ws-tree` tinha `max-height: 34vh` fixo. Trocado para `calc(100vh - 260px)` — estica quase até o rodapé da sidebar. |
| Scrollbar branco aparecendo na sidebar | `.sb-scroll` (container pai da árvore) nunca precisou rolar antes; ao esticar `.ws-tree`, o pai passou a rolar também e usava o scrollbar nativo (branco). Adicionado `scrollbar-width:none` + `::-webkit-scrollbar{width:0}`, igual padrão já usado em `.ws-tree`/`#history-content`. |
| "Salvar e Fechar" (Configurações) demorava às vezes | Causa: `kb-save` sempre re-embedava a base de conhecimento INTEIRA via API a cada fechamento — mesmo sem o usuário ter mexido nela — porque o campo vinha pré-carregado com o `source.md` completo. Corrigido: campo começa vazio, `kb-append`/`appendSource()` processa só o texto novo (ou não faz nenhuma chamada se vazio) e empilha no índice existente em vez de recomputar tudo. |
| Botão "Interromper" não fazia nada (CLI continuava rodando/gastando tokens) | O clique só chama `stopAgenticWorkflow` se `activeAgenticSession` (setado a partir do campo `sessionId` de `agentic-phase-update`) for truthy. `ClaudeCliProvider`/`GeminiCliProvider` nunca mandavam esse campo → sempre `undefined` → o handler no `index.html` nem chegava a disparar o abort. Corrigido: todas as emissões de `agentic-phase-update` desses dois providers agora incluem `sessionId: cwd`. |
| Sinal de abort (SIGTERM) causava "erro" na tela mesmo quando o usuário pediu pra parar | Trocado SIGTERM→SIGINT (mesmo sinal do Ctrl+C no terminal) em `ClaudeCliProcess.kill()`/`GeminiCliProcess.kill()` — SIGKILL continua como fallback se não morrer em ~800ms/2s. Efeito colateral: com SIGINT, o Claude CLI responde de forma graciosa via `result/error` do próprio protocolo (não só fecha o processo) — ANTES isso caía no `onError` normal e mostrava mensagem de erro pro usuário mesmo em abort pedido por ele. Corrigido: `ClaudeCliSession`'s parser `onError` agora também checa `this._aborted` (igual o `onClose` já fazia) e resolve silenciosamente via `onDone({text:''})`. |

---

## Editor de código (`#file-viewer`)

Editor de verdade (CodeMirror 5), não só visualizador. **Contextual, não é modo permanente**: cobre `#main` (chat+composer), sidebar fica visível, fecha e volta pro chat instantaneamente — igual o overlay antigo de leitura, só que agora editável. Fechar com o chat coberto é aceitável (decisão do usuário): thinking/tool activity continuam atualizando por baixo, só não ficam visíveis até fechar o editor.

**Um arquivo por vez, mas modelado pra abas no futuro sem refactor:** `editorController.js` guarda `Map<path, doc>` mesmo mostrando só 1 na tela — trocar por abas é mudar a UI que lê esse Map, não o modelo de dados.

### Pontos de entrada (todos chamam `openFileViewer(path)` → `EditorController.openFile`)
- Árvore do projeto na sidebar (`ws-tree-node.file` click)
- Chip de arquivo alterado pela IA no chat (`.tool-file-chip` click) — **antes** abria `#diff-viewer` (só leitura); agora abre o editor. `#diff-viewer`/`openFileDiff()` continuam existindo e funcionais, só não são mais o destino deste clique.
- Link "Ver base completa" da Base de Conhecimento (Configurações → `kb-open-source-file` → `open-file-in-viewer`)

### Arquivos
```
editorController.js                        ← renderer: estado do editor (CodeMirror, Map de docs, dirty, save)
services/fileEditService.js                ← main: único gateway de ESCRITA do editor humano (backup + conflito)
```

### Fluxo de salvar
`Ctrl+S` (ou botão "Salvar" no header) → `EditorController.saveActive()` → IPC `editor-save-file` → `workspace.isPathAllowed()` (mesmo sandbox do resto) → `fileEditService.writeFile()` (backup em `~/.config/helper-node/backups/`, mesma convenção de `writeFile.js`/`patchFile.js`) → emite `file-mutated` (`origin:'user'`).

Fechar o editor **não descarta** o buffer — fica vivo em `openFiles` (memória, na sessão) até salvar ou fechar o app; reabrir o mesmo arquivo restaura a edição não salva.

### `file-mutated` — bus genérico de mutação (base pra "fonte única")

Hoje só o editor humano ESCREVE por um gateway central (`fileEditService`). OpenAI (helperTools), Claude Code CLI e Gemini CLI ainda escrevem por conta própria (Claude/Gemini são processos externos — não dá pra interceptar antes da escrita sem hooks tipo `PreToolUse`, não confirmado se funcionam no modo `--print`). O que já existe: todo mundo que MUTA um arquivo emite `file-mutated { path, origin }` pra `mainWindow` — `origin: 'user'` (save do editor), `'openai'` (helperTools `_writeNotifier`), `'claude-cli'` (`ClaudeCliProvider.onFileTool` fase `after`). Gemini CLI ainda não emite (não notifica hoje, fora de escopo por ora).

`EditorController` escuta esse bus: se o arquivo mutado é o que está aberto agora E a origem não é `'user'`, mostra um aviso não-bloqueante no header ("⚠ Claude Code está mexendo neste arquivo agora"). É só sinalização — nunca recarrega nem bloqueia sozinho.

### Conflito ao salvar (detecção, não resolução)
`editorController` guarda o `mtimeMs` do momento em que abriu/salvou o arquivo. `fileEditService.writeFile()` compara esse valor contra o mtime real em disco no momento do save; se divergir, `conflict:true` no retorno — hoje só mostra aviso ("arquivo foi alterado por fora — salvo mesmo assim") e salva por cima. Ponto de extensão pronto pra virar prompt/merge de verdade depois, sem mexer em quem chama.

### Deliberadamente NÃO implementado nesta etapa (ver conversa de arquitetura)
- Múltiplas abas (Map já suporta, falta UI)
- Ctrl+P (quick open), busca no arquivo, goto line
- Diff-per-file dentro do editor / comparação "minha versão vs. proposta da IA" (reaproveitaria `computeLineDiff`, já existente)
- OpenAI/Claude Code CLI/Gemini CLI escrevendo através do `fileEditService` (hoje só observados via `file-mutated`, não gateados)
- Resolução de conflito de verdade (merge, escolher versão) — hoje só detecta e avisa

---

## Estrutura de arquivos principais

```
main.js                          ← processo principal, IPC, roteamento de providers
preload.js                       ← bridge contextBridge → window.electronAPI
index.html                       ← UI principal (chat, composer, history)
editorController.js              ← estado do editor de código (#file-viewer)
config.html / config.js          ← configurações
services/
  configService.js               ← config persistida, getters/setters
  fileEditService.js              ← gateway de escrita do editor humano (backup + conflito)
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
