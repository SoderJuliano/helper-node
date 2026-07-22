# Blueprint do Ambiente de Dev — Migração Pop!_OS → Windows 11

> **Para o Claude na sessão futura (Windows virgem):** este arquivo é o plano de
> reconstrução do ambiente do Juliano. Execute as PARTES B→F na ordem, em
> PowerShell **como Administrador**. Confirme cada bloco com ele antes de rodar
> debloat/Defender. NÃO reinstale segredos — eles são migrados à mão (PARTE A).

Gerado em 2026-07-22 a partir do Pop!_OS 24.04 (COSMIC).

---

## Snapshot do ambiente atual (origem)

| Ferramenta | Versão no Linux | Equivalente Windows |
|---|---|---|
| SO | Pop!_OS 24.04 / COSMIC | Windows 11 |
| Node.js | v24.16.0 (nvm, default alias `24`; também v24.13.0) | nvm-windows + Node 24.16.0 |
| npm | 11.13.0 | vem com o Node |
| npm globals | `corepack` (só isso) | `corepack enable` |
| Java (JDK) | OpenJDK **26.0.1** (java+javac), JAVA_HOME vazio | Temurin 21 LTS (ou 26 se precisar) |
| Python | 3.12.3 + pip 24 | Python 3.12 |
| Git | 2.43.0 (`credential.helper=store`) | Git for Windows |
| Docker | 29.5.2 | Docker Desktop (+WSL2) |
| VS Code | 1.122.1 (sem extensões detectadas) | VS Code |
| ripgrep | 14.1.1 | ripgrep |
| jq | 1.7 | jq |
| ffmpeg | 6.1.1 | ffmpeg (Gyan) |
| Rust | rustc/cargo 1.96.0 | rustup |
| Go | instalado | Go |
| gcc/make/cmake | 13.3 / 4.3 / 3.28 | (opcional) VS Build Tools |
| shell | bash (nvm em `.bashrc`, `~/.local/bin` no PATH) | PowerShell 7 + perfil |

Git identity: `user.name=julianosoder`. (Ajuste o email no Windows —
os commits do projeto usam `julianosoder.js@gmail.com`.)

---

## PARTE A — Backup MANUAL antes do wipe (FAÇA PRIMEIRO!)

Copie para um **pendrive/nuvem** — isto NÃO está neste arquivo e some no wipe:

- [ ] `~/.config/meu-electron-app/config.json` → **sua chave OpenAI** do helper-node.
- [ ] `~/.git-credentials` → login do GitHub (ou só relogar no Windows; não é obrigatório).
- [ ] Chaves SSH em `~/.ssh/` (nenhuma `.pub` detectada — você usa HTTPS, então provavelmente nada aqui).
- [ ] (Opcional) `~/.claude/projects/-home-julianosoder-Documentos-helper-node/memory/`
      → minhas memórias das sessões. Se quiser continuidade, guarde; o caminho no
      Windows será diferente, então é só referência.
- [ ] Qualquer projeto local **não commitado**. Rode em cada repo:
      `git status` e `git stash list` — se tiver algo, commite/pushe ou copie.

> O helper-node em si NÃO precisa de backup: está no GitHub
> (`SoderJuliano/helper-node`, branch `feat/windows-port-stealth`).

---

## PARTE B — Instalar ferramentas (winget)

Abra **PowerShell como Administrador** e rode. O winget já vem no Windows 11.

```powershell
# --- Núcleo de dev ---
winget install --id Git.Git -e --source winget
winget install --id CoreyButler.NVMforWindows -e   # gerenciador de Node (igual nvm)
winget install --id Python.Python.3.12 -e
winget install --id Microsoft.VisualStudioCode -e
winget install --id Microsoft.PowerShell -e         # PowerShell 7 (pwsh)

# --- JDK (LTS estável; troque por .26 se precisar do Java 26) ---
winget install --id EclipseAdoptium.Temurin.21.JDK -e

# --- CLIs que você usa ---
winget install --id BurntSushi.ripgrep.MSVC -e
winget install --id jqlang.jq -e
winget install --id Gyan.FFmpeg -e
winget install --id GitHub.cli -e                   # (novo — útil, você não tinha)

# --- Linguagens extra ---
winget install --id Rustlang.Rustup -e
winget install --id GoLang.Go -e

# --- Docker (precisa de WSL2; reinicia) ---
winget install --id Docker.DockerDesktop -e

# --- Qualidade de vida ---
winget install --id Microsoft.WindowsTerminal -e    # (já costuma vir no Win11)
winget install --id 7zip.7zip -e
```

**Depois, FECHE e reabra o PowerShell** (pra pegar o PATH) e configure o Node:

```powershell
nvm install 24.16.0
nvm use 24.16.0
node -v                 # deve mostrar v24.16.0
corepack enable         # replica seu global 'corepack'
```

Git identity + config (espelha seu ambiente):

```powershell
git config --global user.name  "julianosoder"
git config --global user.email "julianosoder.js@gmail.com"
git config --global credential.helper manager   # gerenciador de credenciais do Windows
git config --global init.defaultBranch master
```

> **Build tools nativos (só se precisar):** o helper-node usa `sharp` e
> `tesseract.js`, que têm binários prontos — o `npm i` funciona sem compilar.
> Se algum outro projeto pedir node-gyp:
> `winget install Microsoft.VisualStudio.2022.BuildTools` (workload "Desktop C++").

---

## PARTE C — helper-node (o app)

```powershell
mkdir C:\dev; cd C:\dev
git clone https://github.com/SoderJuliano/helper-node.git
cd helper-node
git checkout feat/windows-port-stealth
npm install
npm start
```

Config do app (restaure o backup da PARTE A):
- Copie seu `config.json` para `%APPDATA%\meu-electron-app\config.json`
  (crie a pasta se não existir). Ou configure a **chave OpenAI** na tela de Ajustes.
- **Importante:** use o **modelo OpenAI (online)** — o pipeline local (Vosk+Whisper)
  é só Linux. Ligue "Assistente em Tempo Real" / "Tradutor".
- Teste `Ctrl+Shift+S` com o OBS aberto → a janela deve **sumir** da gravação.

---

## PARTE D — Debloat & tuning (menos lixo da Microsoft)

Rode como **Administrador**. Cada bloco é independente — pule o que não quiser.

### Opção fácil (GUI, reversível) — recomendada
[ChrisTitusTech/winutil](https://github.com/ChrisTitusTech/winutil): script aberto
e popular que dá uma tela pra desligar bloatware, telemetria, e aplicar tweaks.
```powershell
irm "https://christitus.com/win" | iex
```
> É um script de terceiro rodando como admin — confira o repo antes. Faz o
> trabalho pesado (OneDrive, Copilot, telemetria, apps de fundo) com um clique.

### Ou manual (alvos específicos)

```powershell
# OneDrive — fora
winget uninstall Microsoft.OneDrive

# Copilot — desliga por política + remove o app
reg add "HKCU\Software\Policies\Microsoft\Windows\WindowsCopilot" /v TurnOffWindowsCopilot /t REG_DWORD /d 1 /f
Get-AppxPackage *Copilot* | Remove-AppxPackage -ErrorAction SilentlyContinue

# Widgets e busca web no menu Iniciar — some
reg add "HKCU\Software\Microsoft\Windows\CurrentVersion\Search" /v BingSearchEnabled /t REG_DWORD /d 0 /f
reg add "HKCU\Software\Policies\Microsoft\Windows\Explorer" /v DisableSearchBoxSuggestions /t REG_DWORD /d 1 /f
reg add "HKCU\Software\Microsoft\Windows\CurrentVersion\Explorer\Advanced" /v TaskbarDa /t REG_DWORD /d 0 /f

# Apps rodando em segundo plano — bloqueia global
reg add "HKCU\Software\Microsoft\Windows\CurrentVersion\BackgroundAccessApplications" /v GlobalUserDisabled /t REG_DWORD /d 1 /f

# Telemetria no mínimo (total no Pro/Enterprise; parcial no Home)
reg add "HKLM\SOFTWARE\Policies\Microsoft\Windows\DataCollection" /v AllowTelemetry /t REG_DWORD /d 0 /f

# Dicas/anúncios/sugestões do Windows — desliga
reg add "HKCU\Software\Microsoft\Windows\CurrentVersion\ContentDeliveryManager" /v SubscribedContent-338389Enabled /t REG_DWORD /d 0 /f
```

Depois: **Configurações → Apps → Inicializar** e desligue o que não precisa
(Teams, Edge, etc.). E **Configurações → Bluetooth e dispositivos → não** deixe
o "Phone Link" ligado se não usa.

---

## PARTE E — Exclusões do Windows Defender (dev mais rápido)

O Defender escaneia `node_modules`/`electron` e deixa `npm i` e o app lentos.
Exclua as pastas e processos de dev (**Administrador**):

```powershell
Add-MpPreference -ExclusionPath "C:\dev"
Add-MpPreference -ExclusionPath "$env:APPDATA\npm-cache"
Add-MpPreference -ExclusionPath "$env:APPDATA\nvm"
Add-MpPreference -ExclusionPath "$env:ProgramFiles\nodejs"
Add-MpPreference -ExclusionProcess "node.exe"
Add-MpPreference -ExclusionProcess "electron.exe"
Add-MpPreference -ExclusionProcess "npm.cmd"
Add-MpPreference -ExclusionProcess "git.exe"
```

> Tradeoff: essas pastas/processos deixam de ser escaneados em tempo real.
> Ok pra pasta de dev; não exclua `Downloads` nem o disco todo.

---

## PARTE F — Qualidade de vida no shell (opcional)

Recria seus aliases do bash num perfil do PowerShell. Rode:

```powershell
if (!(Test-Path $PROFILE)) { New-Item -ItemType File -Path $PROFILE -Force }
Add-Content $PROFILE @'
# aliases estilo bash
function ll { Get-ChildItem -Force @args }
function la { Get-ChildItem -Force @args }
Set-Alias grep Select-String
function .. { Set-Location .. }
'@
. $PROFILE
```

**WSL2 (opcional):** se sentir falta do bash/Linux pra alguma coisa:
```powershell
wsl --install
```
Dá um Ubuntu completo dentro do Windows — bom pra scripts shell, sem dual-boot.

---

## Checklist final de validação

- [ ] `node -v` → v24.16.0 | `npm -v` → 11.x
- [ ] `git --version`, `java -version`, `python --version`, `rustc --version`, `go version`
- [ ] `docker run hello-world` (após reiniciar pro WSL2)
- [ ] helper-node: `npm start` sobe, `Ctrl+Shift+S` invisível no OBS, Assistente + Tradutor OK
- [ ] OneDrive/Copilot sumiram, sem spam de sugestões
- [ ] Defender com exclusões aplicadas (`Get-MpPreference | Select ExclusionPath`)
