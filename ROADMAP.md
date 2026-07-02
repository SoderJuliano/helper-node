# Roadmap do Aplicativo Helper

> **Arquitetura detalhada em `ARCHITECTURE.md`.**

## ✅ Lançado em v0.5.0 / v0.5.1: Claude Code CLI + Redesign IDE + UX

**Novo provider: Claude Code CLI** — mesmo padrão do Gemini CLI, selecionável em Configurações.
- Processo `claude --print --output-format stream-json --include-partial-messages --verbose --permission-mode bypassPermissions --no-chrome`
- Continuidade de sessão via `--resume <session_id>` (event `system/init`)
- Auth pela máquina (`~/.claude/`), sem API key no app
- Thinking e texto ao vivo via `stream_event` / `thinking_delta` / `text_delta`
- Tool activity (`Lendo arquivo`, `Executando comando`, etc.) com diff ao clicar em edits de arquivo
- Abort limpo via SIGTERM (flag `_aborted` → resolve silencioso, sem erro na UI)
- `safeClose()` garante que o loading sempre fecha mesmo em erros inesperados

**Redesign UI estilo IDE de IA:**
- Layout chat × IDE com painel de atividade de ferramentas
- Markdown completo nas respostas: blocos de código com copy, headings, listas, inline code
- **Markdown na pergunta do usuário:** `setQuestionText()` renderiza com `renderMarkdown()`, guarda original em `data-raw`
- Token counter no composer (warn ≥ 2k, danger ≥ 4k)
- Scrollbar invisível no textarea e terminal-input
- Realtime mode: composer some ao iniciar (`Ctrl+I` para mostrar)
- Thinking ao vivo: status mostra últimos 140 chars do raciocínio (throttle 400ms) em vez de emoji estático

**Fixes de provider:**
- `workspaceAccess` liberado para CLIs independente de helperTools
- helperTools desabilitado (disabled + opaco) quando CLI ativo
- Botão × (interromper) agora aborta Claude CLI e Gemini CLI
- Loading nunca fica preso graças ao padrão `safeClose()`

## ✅ Lançado em v0.4.x: Realtime online (OpenAI) + Tradutor ao vivo robusto

Roteado por `pickRealtimeService()`; `getEffectiveAiModel() = isLite() ? 'openIa' : aiModel`.

**Realtime — dois caminhos, escolhidos pelo provedor de IA:**
- **ChatGPT (e SEMPRE na edição Lite)** → `services/realtimeOpenAiService.js` + motor
  próprio `services/realtimeAudioCapture.js` (**`parec`** + VAD + segue sink ativo).
  Transcrição `gpt-4o-transcribe` + resposta OpenAI. **Sem Vosk/Whisper.** Default
  sobe `gpt-4.1-nano` → `gpt-4.1`. Transcrição própria (NÃO importa nada do tradutor).
- **Full + Backend (LLaMA/Ollama) ou Ollama Local** → `realtimeAssistantService.js`
  (Vosk live + correção Whisper), com a **resposta no provedor selecionado** (via
  `aiResponder` injetado no main.js), nunca OpenAI. Sem fallback entre providers.

**Áudio (causa-raiz de muito bug):** captura de monitor é **`parec --device=<sink>.monitor`**;
`pw-record --target` cai no mic no PipeWire. Resolve o sink REAL (RUNNING → default) e
segue troca de dispositivo (monitor→fone) com o app aberto.

**Assistente de Tradução (ao vivo):** barra de volume mic/sys, **transcrição da fala do
usuário na tela** (sem traduzir — só o entrevistador é traduzido), loading (robot.gif)
enquanto a IA responde, e **seletor de microfone** nas Configurações (áudio do sistema
continua automático: pega Meet/Teams/YouTube no navegador).

Emojis removidos da tela de Configurações. Agora em **modo manutenção/melhorias**.

## ✅ Lançado em v0.4.2: Streaming + Banco de respostas (RAG de conversas)

**Streaming (OpenAI):** tradutor e assistente em tempo real exibem a resposta token a
token (sensação "bate pronto" — latência percebida cai, a real não muda). Mantém o
anti-filler: só renderiza após o marcador `TRADUÇÃO:`. Tradutor atualiza o bloco no
lugar por `id`; realtime reusa `segment_response` com o mesmo `id`.

**Banco de respostas (`services/answerBank.js`):** guarda `{pergunta do entrevistador,
SUA resposta}` quando a resposta pontua bem numa avaliação feita em BACKGROUND
(`evaluateUserResponse`, nota ≥ `minScore`=4) — silenciosa, nada vai pra tela. Quando
uma pergunta quase igual reaparece (cosseno ≥ 0.85), injeta sua resposta anterior como
DICA (adapta, não copia, não menciona). **0-latência:** a query é embedada UMA vez
(`knowledgeBase.embed`) e compartilhada entre base de conhecimento e banco; o save é
async (fire-and-forget). Config `answerBank { enabled, minScore }`. Ligado no tradutor
e no realtime. Persistência em `<userData>/knowledge/answers.json` (teto 200, poda por
nota/recência).

**Copiloto realtime:** explica siglas/jargão de negócios (IPO, M&A, EBITDA…) de forma
discreta (ℹ️ itálico, sem negrito — palavras-chave em negrito seguem o foco); reconhece
uso multifunção (entrevista PT-BR, reuniões, vídeos); e **não responde à própria fala
do usuário (mic) no modo `both`** — evita o loop de ler a sugestão em voz alta e a IA
repetir. Sua fala segue transcrita e alimentando o banco.

### Decisão: o banco salva a resposta CRUA (sem polir)
Polir com IA arrisca "corrigir" o fato com base de treino mais antiga; e o usuário pode
salvar info errada de qualquer jeito. Salvar cru preserva a voz autêntica e evita
contaminação. O ganho real não está no polimento por turno, e sim na **consolidação
periódica** (abaixo).

### Melhorias futuras (banco de respostas)
- **Desativar / apagar a base** pela UI — toggle + botão "limpar banco", como já existe
  pro knowledge base.
- **Consolidar conhecimento de tempos em tempos** — rotina (manual ou agendada) que
  passa o banco ACUMULADO por uma IA pra deduplicar, mesclar respostas parecidas e
  refinar, COM o contexto inteiro à vista (não turno a turno). É a hipótese principal de
  trabalho nesse sentido — diferente de polir cada resposta na hora.
- **Scorer mais barato** — avaliar a nota com modelo mais leve pra reduzir custo do
  processo em background.
- Possível UI pra revisar/editar/remover entradas específicas do banco.

## ✅ Lançado em v0.2.0: Helper Tools — IA com acesso ao sistema

Módulo opcional que dá à IA **ferramentas read-only** pra inspecionar o sistema
de verdade, em vez de chutar. Desligado por padrão; ative em
**Configurações → 🔧 Ferramentas avançadas**.

### Arquitetura

```
services/helperTools/
├── index.js              ← fachada (initialize, executeTool, getOpenAIToolsSchema)
├── config.js             ← defaults + allowed extensions + sandbox roots
├── policy.js             ← checkRead/checkWrite, sandbox, denied paths
├── secretRedactor.js     ← filtra tokens/chaves antes de mandar pra IA
├── audit.js              ← log append-only ~/.config/helper-node/audit.log
├── backup.js             ← (para v0.3 — write tools)
├── shouldEngage.js       ← regex pra decidir trocar pro modelHeavy
├── confirmationDetector.js ← (para v0.3 — write/exec)
├── platforms/
│   ├── detect.js         ← os, distro, pkg manager, shell, DE, Wayland?
│   └── commands.js       ← instala pacote nativo por pkg manager
├── registry.js           ← Map<name, tool> + loadBuiltins()
├── schema.js             ← gera tools[] formato OpenAI + texto pra Ollama
├── executor.js           ← dispatcher único com timing + audit
└── tools/
    ├── listDir.js
    ├── fileInfo.js
    ├── readFile.js
    ├── readFileChunk.js
    ├── searchInFiles.js  (ripgrep → grep fallback)
    ├── findFiles.js      (fd → find fallback)
    ├── detectShellConfig.js
    └── listPackages.js   (apt/pacman/dnf/zypper/apk/brew + flatpak/snap)
```

### Integração com OpenAI

`OpenAIService.makeOpenAIRequest` aceita `opts.tools` + `opts.onToolCall` +
`opts.maxToolCalls`. Quando o módulo está ON, `main.js` injeta as 8 tools via
[function calling do OpenAI](https://platform.openai.com/docs/guides/function-calling)
com `tool_choice:'auto'`. Loop reentrante até a IA dar resposta final ou
hit em `maxToolCallsPerRequest` (default 5).

**Histórico isolado:** o loop trabalha em cópia local do `messages[]`. Só
persiste no histórico da sessão `[userMessage, assistantFinal]` — sem os
`assistant(tool_calls)` + `tool` intermediários, que ficariam órfãos se o loop
abortasse e quebrariam a próxima request com erro 400.

### Segurança

- **Read-only nesta versão** — nenhuma tool escreve arquivos ou executa shell.
- **Sandbox** restrito ao `$HOME` (configurável) com lista de paths bloqueados
  (`.ssh/`, `.gnupg/`, `.git/objects/`, `node_modules/`, etc.).
- **Secret redactor** mascara PEM, Bearer, JWT, AWS AKIA, OpenAI `sk-`, GitHub
  `gh*_`, Google `AIza*`, Slack `xox*`, ENV-style `password=`, URLs com
  credenciais — **antes** do conteúdo chegar à IA.
- **Audit log** append-only em `~/.config/helper-node/audit.log` registra toda
  invocação (kind, tool, args truncados, duração, error).
- **Mutex com OS Integration** — exclusivo por enquanto.

### Multi-distro de verdade

`listPackages` detecta o gerenciador nativo via `platform.detect()` e roda em
paralelo com flatpak/snap quando disponíveis:

| Distro | Gerenciador nativo | Comando |
|---|---|---|
| Ubuntu/Pop/Debian | apt | `dpkg-query -W` |
| Arch/Garuda/Manjaro | pacman | `pacman -Q` |
| Fedora/RHEL | dnf | `rpm -qa` |
| openSUSE | zypper | `rpm -qa` |
| Alpine | apk | `apk info -v` |
| macOS | brew | `brew list --versions` |
| qualquer | flatpak/snap | em paralelo se instalados |

### Roteamento de modelo

- Perguntas simples: usa o modelo escolhido (default `gpt-4.1-nano`).
- Perguntas com gatilhos de tarefa pesada (edição, instalação, comandos):
  faz upgrade pra `gpt-4o-mini` (`shouldForceHeavyModel` regex) **somente se**
  o modelo do usuário for de tier inferior. Escolhas caras (`gpt-4.1`,
  `gpt-5.1`) são respeitadas — sem downgrade silencioso. Tier baseado em
  pricing OpenAI (nano=1, mini=2, 4.1/4o=3, 5.x=4, 5.4/5.5=5).
- Tools são **sempre oferecidas** quando o módulo está ON. A IA decide via
  `tool_choice:'auto'`. Heurística regex só serve pra decisão de modelo.

### Roadmap das próximas versões (helperTools)

- ✅ **v0.3 (CONCLUÍDO)** — Write tools (`writeFile`, `patchFile`, `appendToFile`,
  `deleteFile`) com backup automático em `~/.config/helper-node/backups/` + UI
  de confirmação overlay (`confirm-action.html`).
- ✅ **v0.4 (CONCLUÍDO)** — `runCommand` com whitelist `SAFE_COMMANDS` (git
  read+write básico, npm/yarn/pnpm, mvn/gradle + wrappers, ls/cat/head/tail,
  versões de runtime) + `runShellAdvanced` (bash arbitrário com confirmação
  visual e `HARD_DENY_PATTERNS` pra bloquear `rm -rf /`, `mkfs.*`, fork bomb).
  Anti-duplicação de writeFile/appendToFile/patchFile/deleteFile por hash
  (path+content) no escopo de uma pergunta — previne IA repetir 4x o mesmo
  edit. Tools disponíveis pra OpenAI (function calling) E Ollama (parser
  TOOL_CALL).
- **v0.5** — Adapter Ollama via proxy Java (endpoints `/llamatiny`, `/llama3`,
  `/gemma3`, `/qwen25`) com structured prompt + JSON parser pra tool calls
  [PARCIALMENTE FEITO em backendService.js — falta sudoManager + sudo-prompt].
- **Futuro** — whitelist editável via UI, macOS adapter testado, modo dry-run,

---

## Arquitetura Atual: Atalho Global via Servidor IPC

Para permitir que o atalho de gravação (`Ctrl+D`) funcione globalmente (fora do foco do aplicativo), a seguinte arquitetura foi implementada:

1.  **Servidor IPC Interno:**
    *   Um pequeno servidor web usando `Express.js` é executado dentro do processo principal do Electron (`main.js`).
    *   Este servidor é modularizado em `services/ipcService.js`.
    *   Ele expõe um endpoint local, como `POST http://localhost:3000/toggle-recording`.

2.  **Comunicação:**
    *   Quando o endpoint é acionado, ele chama a função interna `toggleRecording()`, que gerencia o início e o fim da gravação de áudio.

3.  **Configuração Automática (`setup-hotkey.sh`):**
    *   Para configurar o atalho global `Ctrl+D`, utilize o script de configuração automática `setup-hotkey.sh`. Este script detectará seu ambiente de desktop (GNOME ou Hyprland) e aplicará as configurações necessárias.
    *   **Como usar:** Execute o script na raiz do projeto: `./setup-hotkey.sh`

Esta abordagem funciona de forma robusta em Wayland e X11, mas exige configuração manual.

## Arquitetura Atual: Modo Stealth (sem notificações nativas)

Em versões anteriores o app usava notificações nativas do SO (`Notification` do
Electron) para informar "Gravando…", "Ok, aguarde…", "Resposta (1/3)" etc.
Isso foi **removido completamente** porque o caso de uso central do app é ser
um **copiloto discreto durante reuniões, ligações e entrevistas** — qualquer
notificação visível na tela quebra a discrição.

1.  **Implementação:**
    *   No topo de `main.js`, a classe `Notification` importada do Electron é
        substituída por um stub no-op (métodos `show()`, `close()`, `on()` etc.
        existem mas não fazem nada).
    *   Não foi necessário editar as ~21 chamadas espalhadas pelo código —
        todas viraram NOOP automaticamente.

2.  **Comunicação com o usuário acontece exclusivamente via:**
    *   `mainWindow` (janela principal do chat).
    *   Janelas próprias `BrowserWindow` criadas por `createOsNotificationWindow()`
        (`loading.html`, `response.html`, `recording.html`, `recording-live.html`,
        `capture.html`, `integratedInput.html`) — posicionadas e ocultáveis.

3.  **Benefícios:**
    *   **Discrição total** em chamadas Teams/Meet/Zoom/WhatsApp.
    *   **Zero dependência** de daemon de notificação (`mako`, `dunst`, GNOME Shell, KDE).
    *   **Comportamento idêntico** em qualquer DE/WM/Wayland/X11.

## Arquitetura Atual: Realtime Copilot OFFLINE (Vosk-fast + Whisper-slow)

> Este é o caminho **OFFLINE** (Full + backend/Ollama). Para ChatGPT/Lite, o realtime
> é **100% online** (`realtimeOpenAiService` + `realtimeAudioCapture`, parec) — ver a
> seção "Lançado em v0.4.x" no topo. A resposta aqui vai pro provider selecionado.

Pipeline híbrido implementado no `services/realtimeAssistantService.js`:

1.  **Captura simultânea** de microfone (`@DEFAULT_SOURCE@`) + áudio do sistema
    (`<sink>.monitor`) via `parec`, mixado em PCM s16le 16kHz mono.
2.  **Vosk** transcreve em tempo real → atualiza **uma única bolha por segmento**.
3.  Segmento fecha em **5 s de silêncio** (RMS) OU **25 s contínuos** (corte forçado).
4.  Ao fechar:
    *   IA responde com base no Vosk → `segment_response` (rápido).
    *   `whisper-cli` (`ggml-medium`) re-transcreve o WAV em background.
    *   Se diferir, emite `segment_whisper_correction` → reescreve a bolha do
        usuário in-place + re-pergunta à IA → `segment_response_corrected`
        substitui a bolha do assistente.
5.  Histórico é **editado in-place** via `historyService.replaceMessage(...)`.

A IA opera em modo **copiloto**, não resumidor: responde perguntas técnicas,
sugere respostas (`💬 Sugestão:`), aponta trade-offs, define termos obscuros e
ignora ruído/conversa casual com `(trecho sem conteúdo relevante)`.

## ~~Arquitetura Atual: Lógica de Serviço de IA com Fallback~~ (OBSOLETO)

> ⚠️ **OBSOLETO desde v0.4.x.** A regra atual é **SEM fallback automático entre
> providers** (ver `.github/copilot-instructions.md`): o usuário escolhe o provider e
> o agente respeita. OpenAI ↔ Ollama/backend NÃO se substituem sozinhos. O texto
> abaixo descreve o comportamento ANTIGO (backend → Gemini) e é mantido só como
> histórico — não implementar nem reativar.

Para oferecer flexibilidade e robustez na geração de respostas de IA, o aplicativo agora implementa uma lógica de seleção de serviço com fallback automático. O objetivo é priorizar um backend customizado (remoto) quando disponível, e usar um modelo local como alternativa segura.

1.  **Múltiplos Serviços de IA:**
    *   O aplicativo mantém referências a múltiplos serviços de IA, incluindo `services/backendService.js` (para o backend customizado) e `services/geminiService.js` (para o modelo local).

2.  **Verificação de Disponibilidade (Health Check):**
    *   Ao iniciar, e depois periodicamente a cada 60 segundos, o aplicativo realiza uma verificação de status (`ping`) no endpoint `/ping` do backend customizado.
    *   Uma variável de estado global (`backendIsOnline`) armazena o resultado dessa verificação.

3.  **Lógica de Seleção e Fallback:**
    *   Quando uma nova resposta de IA é solicitada, o aplicativo verifica a flag `backendIsOnline`.
    *   **Se o backend estiver online:** O `BackendService` é acionado para processar a requisição. Se, mesmo assim, a chamada falhar (por exemplo, erro de rede ou resposta inválida), o erro é capturado, a flag `backendIsOnline` é temporariamente definida como `false`, e o sistema **automaticamente recorre ao `GeminiService` local** para garantir que o usuário receba uma resposta.
    *   **Se o backend estiver offline:** O aplicativo utiliza diretamente o `GeminiService` local sem tentar contato com o backend.

4.  **URL Dinâmica do Backend:**
    *   O `backendService` obtém a URL do backend de forma dinâmica através de um serviço externo (`https://abra-api.top/notifications/retrieve?key=ngrockurl`), o que permite que o endereço do servidor mude sem necessidade de reconfigurar o aplicativo.

Este sistema híbrido garante que o aplicativo continue funcional mesmo que o backend remoto esteja indisponível, combinando a preferência por um serviço remoto customizado com a confiabilidade de um modelo local.

## Arquitetura Atual: Atalhos Globais para Gerenciamento de Janela

Assim como o atalho de gravação, os atalhos para mover a janela entre monitores (`Ctrl+Shift+1`, `Ctrl+Shift+2`) também foram movidos para a arquitetura de servidor IPC para garantir o funcionamento em diferentes ambientes, especialmente em Wayland (Hyprland, GNOME).

1.  **Endpoints IPC:**
    *   O `ipcService` agora expõe dois novos endpoints:
        *   `POST http://localhost:3000/move-to-display/0` (para o primeiro monitor)
        *   `POST http://localhost:3000/move-to-display/1` (para o segundo monitor)

2.  **Configuração Automática (`setup-hotkey.sh`):**
    *   Para configurar os atalhos globais para gerenciamento de janela, utilize o script de configuração automática `setup-hotkey.sh`. Este script detectará seu ambiente de desktop e aplicará as configurações necessárias para os atalhos de movimentação de janela (`Ctrl+Shift+1`, `Ctrl+Shift+2`) e para focar o aplicativo com input (`Ctrl+I`, `Ctrl+Shift+I`).
    *   **Como usar:** Execute o script na raiz do projeto: `./setup-hotkey.sh`

Esta solução remove a dependência do módulo `globalShortcut` do Electron para essas ações, que é notoriamente instável entre diferentes gerenciadores de janela, e centraliza a lógica de atalhos globais em uma única arquitetura robusta e configurável pelo usuário.



3.  **Comportamento Específico para Hyprland:**
    *   O aplicativo detecta automaticamente se está sendo executado no Hyprland.
    *   Se for o caso, o comportamento dos endpoints muda: em vez de mover a janela para um monitor físico, ele a move para um *workspace* (área de trabalho) do Hyprland.
    *   O endpoint `.../move-to-display/0` moverá a janela para o workspace 1.
    *   O endpoint `.../move-to-display/1` moverá a janela para o workspace 2, e assim por diante.
    *   Isso permite uma integração mais nativa com o fluxo de trabalho do Hyprland, que é centrado em workspaces. A configuração no `hyprland.conf` permanece a mesma.

## Configuração Automática de Atalhos Globais (`setup-hotkey.sh`)

Para configurar todos os atalhos globais do Helper-Node de forma automática, utilize o script `setup-hotkey.sh` localizado na raiz do projeto.

**O que o script faz:**
*   **Verifica dependências:** Garante que o `curl` esteja instalado, pois é essencial para a comunicação com o servidor IPC do aplicativo.
*   **Detecta Ambiente de Desktop (DE):** Identifica automaticamente se você está usando GNOME ou Hyprland.
*   **Configura Atalhos:**
    *   **GNOME:** Utiliza `gsettings` para criar e registrar os atalhos globais, incluindo:
        *   `Ctrl+D` para iniciar/parar a gravação.
        *   `Ctrl+Shift+1` e `Ctrl+Shift+2` para mover a janela entre monitores/workspaces.
        *   `Ctrl+I` e `Ctrl+Shift+I` para trazer o aplicativo para o foco e abrir o input manual.
    *   **Hyprland:** Adiciona as linhas `bind` necessárias diretamente ao seu arquivo `~/.config/hypr/hyprland.conf`, utilizando:
        *   `SUPER, D` para iniciar/parar a gravação.
        *   `SUPER_SHIFT, 1` e `SUPER_SHIFT, 2` para mover a janela entre workspaces.
        *   `SUPER, I` e `SUPER_SHIFT, I` para trazer o aplicativo para o foco e abrir o input manual.
*   **Evita Duplicatas:** O script verifica se os atalhos já existem antes de adicioná-los, prevenindo configurações redundantes.

**Como executar:**
1.  Abra um terminal na raiz do projeto `helper-node`.
2.  Execute o script com permissões de execução:
    ```bash
    ./setup-hotkey.sh
    ```
3.  **Após a execução:**
    *   **GNOME:** Pode ser necessário fazer logout e login novamente para que os novos atalhos sejam reconhecidos pelo sistema.
    *   **Hyprland:** Recarregue sua configuração do Hyprland. Você pode fazer isso geralmente com `hyprctl reload` no terminal, ou usando seu atalho configurado para recarregar o Hyprland (ex: `Super+R`).

**Benefícios:**
Este script automatiza o processo de configuração complexo e garante que o aplicativo funcione "out-of-the-box" com todos os atalhos globais esperados nos ambientes suportados.

