# Helper Node — Instruções para Agentes de IA

> Aplicativo Electron de assistente AI stealth (overlay) com captura de tela, gravação contínua, OCR, transcrição via Whisper/Vosk e tool calling. Roda em Linux (foco Pop!_OS COSMIC + Wayland).

---

## 🚨 Convenções obrigatórias

1. **Idioma:** todo código, commit, comentário e resposta em **português brasileiro**. Logs prefixados com tags tipo `[realtime]`, `[helperTools]`, `[audio]`.
2. **Commits SEMPRE de 1 linha só** — ninguém merece ler bíblia por commit. Prefixos permitidos:
   - `fix:` — bugfix (ex: `fix: arruma captura de tela no COSMIC`)
   - `feat:` — feature nova (ex: `feat: tooltip dinâmico de atalhos por SO`)
   - `release:` — bump de versão
   - `chore:` — refactor interno, ajuste de build, limpeza
   - `ui:` — ajuste visual sem mudar lógica
   - `build:` — script de pacote, deb, arch
3. **Não criar arquivos `.md` novos** sem pedido explícito. Atualizar [README.markdown](../README.markdown) e [ROADMAP.md](../ROADMAP.md) quando feature relevante.
4. **Não tocar em `whisper/` (submódulo)** — é repo clonado, intocável.
5. **Sem fallback automático entre providers** (OpenAI ↔ Ollama). Usuário escolhe, agente respeita.
   - Ollama selecionado → SÓ usa endpoints Ollama (`/llama3`, `/qwen25`, `/gemma3`, `/llamatiny`). Tool calling DEVE funcionar via structured prompt + parser, mesmo que o modelo seja teimoso. **NÃO** redirecionar pra OpenAI "porque OpenAI tem tool calling nativo melhor". O fix é no prompt/parser, não no provider.
   - OpenAI selecionado → SÓ usa `openAIService` com `tools[]` nativo.
   - Mesma regra pra streaming, visão, etc.

---

## 🏗️ Arquitetura

### Ambiente de Produção (Servidor do Usuário)
- **Hardware:** Xeon E5 2690 (12 cores/24 threads), 32GB RAM DDR3 1600MHz.
- **GPU:** AMD Radeon RX 9060 8GB GDDR6.
- **Modelos (Ollama/MCP):** Llama 3 (8B) e Qwen 2.5 (14B/7B). GPU foca até 8GB.

### Ambiente de dev
- **VS Code roda dentro de sandbox Flatpak** → sem `npm`, `dpkg-deb`, `git push` nativo.
- Para executar qualquer coisa no host: `flatpak-spawn --host bash -lc '...'`.
- nvm no host: `export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; nvm use --silent default`.
- npm está em `~/.nvm/versions/node/v24.13.0/bin/npm`.

### Estrutura
```
main.js                    # Electron main process + IPC handlers + windows
preload.js                 # contextBridge p/ renderer
index.html / config.html   # UIs (config.html é janela de Configurações)
config.js                  # script da config window
services/
  openAIService.js         # GPT chat + visão + tool calling LOOP
  geminiService.js         # Google Gemini (alternativa)
  llamaService.js          # Ollama local
  realtimeAssistantService.js  # Vosk live + Whisper async correction
  voskStreamService.js     # mic → PCM → vosk-stream.py
  tesseractService.js      # OCR de screenshots
  historyService.js        # sessões persistidas em ~/.config/helper-node/history.json
  configService.js         # leitura/escrita config (modelos, ativações)
  backendService.js        # HTTP server pra hotkeys globais (porta 3000)
  ipcService.js            # registro central de IPC handlers
  helperTools/             # MÓDULO TOOL CALLING (ver seção)
os-integration/
  notifications/           # janelas overlay (HTML) — recording, loading, response, capture, integratedInput
whisper/                   # whisper.cpp clonado (NÃO MEXER)
vosk-model/                # modelo PT-BR vosk
vosk-stream.py             # streaming PCM → JSON via stdout
helper-node.sh             # launcher do .deb
package.sh                 # build .deb e .pkg.tar.zst
```

### Fluxos críticos

**Áudio (não quebrar!):**
- Captura: `pw-record` (PipeWire, SEM flags `--raw`/`--format`) → PCM s16le 16kHz mono.
- ffmpeg precisa `-f s16le -ar 16000 -ac 1` (input format raw EXPLÍCITO).
- ❌ NÃO usar `parec --raw` — perde áudio na conversão s32le→s16le.

**Realtime assistant:**
- Vosk transcreve em tempo real (rápido, impreciso).
- Whisper roda assíncrono em background pra corrigir.
- Resultado: `segment_whisper_correction` IPC event atualiza UI.

**Agentic Workflow (Multi-fase):**
- Implementado para **OpenAI** e **Ollama (Backend MCP)**.
- Ativado quando: "Ferramentas Avançadas" ON + "Acesso ao Workspace" ON + "Intento de escrita/pesquisa complexa".
- **Fases:** Discovery (leitura), Planning (plano), Implementation (escrita/comandos), Review (conclusão).
- **Sessões:** IDs únicos por run (ex: `agentic-ollama-123`) p/ evitar contaminação.
- **Tool Calling Ollama:** Via structured prompt (`TOOL_CALL: {json}`). Loop até 30 iterações.

**Tool calling (helperTools):**

---

## 🔧 Módulo helperTools

**Estado:** desligado por padrão. Toggle em Configurações → "🔧 Ferramentas avançadas".

### Tools disponíveis (read-only, v0.2.0)
| Tool | Função |
|------|--------|
| `listDir` | conteúdo de pasta |
| `readFile` / `readFileChunk` | ler arquivo com **redator de segredos** |
| `searchInFiles` | ripgrep/grep |
| `findFiles` | glob |
| `fileInfo` | metadados |
| `listPackages` | apt/pacman/dnf/brew/flatpak/snap |
| `listDesktopApps` | `.desktop` XDG (com Categories) |
| `detectShellConfig` | bash/zsh/fish |

### Segurança (NÃO COMPROMETER)
- **Sandbox de caminhos:** apenas `$HOME` + `/tmp/helper-node`.
- **Path traversal bloqueado** (`..` resolvido antes de checar).
- **Secret redactor** scaneia conteúdo (SSH keys, JWT, AWS creds, passwords, tokens) — substitui por `[REDACTED:TIPO]`.
- **Audit log:** `~/.config/helper-node/audit.log` (toda chamada).
- **Anti-loop:** máx 5 tool calls / pergunta.
- **System prompt addon** ensina IA a normalizar nomes vindos de voz ("Helper Traço Node" → `helper-node`).

### Adicionar nova tool
1. Criar `services/helperTools/tools/minhaTool.js` com `{name, description, schema, mutates, async run(args)}`.
2. Registrar em [services/helperTools/registry.js](../services/helperTools/registry.js).
3. `mutates: true` → vai precisar de confirmação (v0.3+).

### Próximas fases (NÃO IMPLEMENTAR sem aprovação)
- v0.3: write tools (`writeFile`, `patchFile`, `appendToFile`) — exigem **confirmação por clique/voz** + backup automático em `~/.config/helper-node/backups/`.
- v0.4: execução de comandos com whitelist + `sudo`.

---

## 📦 Build .deb

```bash
flatpak-spawn --host bash -lc '
  export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; nvm use --silent default
  cd /home/julianosoder/Documentos/helper-node
  rm -rf build/deb-root dist
  ./package.sh deb
'
```

### Particularidades
- **Tamanho atual:** 627 MB (Electron 200M + modelos Whisper 540M + Vosk 52M).
- **Cópia seletiva do whisper** em [package.sh](../package.sh): só `build/bin/`, libs `.so*`, e `models/ggml-*.bin` (NÃO `for-tests-*`). Sem `.git`/`src`/`examples`/`tests`/`bindings`/`samples`.
- **LD_LIBRARY_PATH** exportado em [helper-node.sh](../helper-node.sh) — necessário porque `whisper-cli` tem RUNPATH absoluto da máquina de build (`/home/julianosoder/...`). SEM isso, whisper falha silenciosamente em `/opt/helper-node`.
- Versão atual: **0.2.0** (bumpar em [package.json](../package.json), [package.sh](../package.sh), [build/deb/DEBIAN/control](../build/deb/DEBIAN/control), [build/arch/PKGBUILD](../build/arch/PKGBUILD) juntos).

### Validação pós-build
```bash
flatpak-spawn --host dpkg-deb --contents dist/helper-node_*.deb | grep -E "whisper-cli$|libwhisper|ggml-.*bin|helperTools/index"
```

---

## 🐛 Pegadinhas conhecidas

1. **historyService usa `Number` para session id** — quando vem de `dataset.sessionId` (string), converter antes de comparar.
2. **Wayland (COSMIC)** quebra atalhos globais — não dá pra resolver via Electron, é limitação do compositor. Já existe fallback HTTP em `backendService.js`.
3. **Notificações nativas desabilitadas** (app é stealth) — usar **toast in-app** ou janela overlay.
4. **Recording loading 60x60 top-right** (igual ao loading "processando") — manter consistente.
5. **Header de painéis colapsáveis** inteiro é clicável, não só o chevron.

---

## 🚀 Release process

1. Bump versão nos 4 arquivos (acima).
2. Atualizar [README.markdown](../README.markdown) + [ROADMAP.md](../ROADMAP.md).
3. Commits temáticos.
4. `git push origin master`.
5. Build .deb (acima).
6. Validar `dpkg-deb --contents`.
7. Release no GitHub com título/descrição em PT-BR (não criar `RELEASE_NOTES.md`).

---

## 📝 Estilo de código

- ES6+, CommonJS (`require`/`module.exports`).
- Async/await, evitar promise chains.
- Sem TypeScript. Sem Prettier config — manter estilo do arquivo vizinho.
- Logs com prefixo de módulo: `console.log("[helperTools]", ...)`.
- Comentários explicam **por quê**, não **o quê**.

---

## ❓ Quando perguntar ao usuário

- Antes de adicionar nova dependência npm.
- Antes de mexer em fluxo de áudio (já quebrou várias vezes).
- Antes de implementar write tools / sudo.
- Antes de mudar layout/UX visível.

## ✅ Quando NÃO perguntar

- Bugfixes óbvios.
- Refactor interno que não muda comportamento.
- Adicionar logs/audit.
- Atualizar README/ROADMAP quando feature já aprovada.
