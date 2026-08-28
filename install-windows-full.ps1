#Requires -Version 5.1
# Helper Node — instalador Windows (edição: full)
#
# Uso (PowerShell, sem precisar clonar nada antes):
#   irm https://raw.githubusercontent.com/SoderJuliano/helper-node/master/install-windows-full.ps1 | iex
#
# NÃO gera um .exe empacotado. Clona/atualiza o código-fonte, roda `npm install`
# (baixa o electron.exe OFICIAL do projeto Electron — o mesmo binário usado por
# milhares de apps, sem hash novo e sem reputação zerada) e registra um atalho
# + o comando `helper-node` no PATH do usuário atual (sem precisar de admin).
#
# Por quê: um .exe compilado via Electron Forge/Squirrel é um binário NOVO a
# cada build — hash nunca visto, prevalência zero — e o Windows Defender (cloud
# ML) marcou como "Trojan:Win32/Cinjo.O!cl" (falso positivo comportamental: o
# app usa hook de atalho global + evasão de captura de tela por design). Ver
# WINDOWS-PORT.md (Etapa 5) para o histórico completo e o que fazer se um dia
# valer a pena comprar um certificado de assinatura de código de verdade.
#
# Edição FULL: habilita na UI as opções de provedor local (Ollama / Claude CLI /
# Gemini CLI) e transcrição offline local via Whisper.cpp (binários Windows x64 +
# modelos GGML baixados automaticamente uma única vez e cacheados localmente).
# Ollama/Claude CLI/Gemini CLI funcionam normalmente se você já tiver essas
# ferramentas instaladas e no PATH.

$ErrorActionPreference = 'Stop'

# Libera a execucao de scripts SO para este processo (nao mexe na maquina, nao
# precisa de admin). Sem isso, chamar `npm` no Windows quebra quando a
# ExecutionPolicy esta Restricted/AllSigned, porque o npm e um script .ps1.
try { Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass -Force } catch {}

$Edition = 'full'
$RepoUrl = 'https://github.com/SoderJuliano/helper-node.git'
$ZipUrl = 'https://github.com/SoderJuliano/helper-node/archive/refs/heads/master.zip'
$InstallDir = Join-Path $env:LOCALAPPDATA 'helper-node'
$BinDir = Join-Path $InstallDir 'bin'

function Write-Step($msg) { Write-Host "-> $msg" -ForegroundColor Cyan }
function Write-Ok($msg) { Write-Host "OK: $msg" -ForegroundColor Green }
function Write-Fatal($msg) { Write-Host "ERRO: $msg" -ForegroundColor Red; exit 1 }

Write-Host "=== Helper Node - instalador Windows (edicao: $Edition) ===" -ForegroundColor Magenta

# 1) Node.js (minimo 18)
$nodeCmd = Get-Command node -ErrorAction SilentlyContinue
if (-not $nodeCmd) {
    Write-Fatal "Node.js nao encontrado. Instale a versao 18 ou mais nova em https://nodejs.org e rode este comando de novo."
}
$nodeVersion = [Version]((node -v) -replace '^v', '')
if ($nodeVersion.Major -lt 18) {
    Write-Fatal "Node.js v$nodeVersion e antigo demais (minimo: 18). Atualize em https://nodejs.org."
}
Write-Ok "Node.js v$nodeVersion"

# 2) Codigo-fonte: git clone/pull (preferido) ou fallback via .zip sem git
$gitCmd = Get-Command git -ErrorAction SilentlyContinue
if (Test-Path $InstallDir) {
    if ($gitCmd -and (Test-Path (Join-Path $InstallDir '.git'))) {
        Write-Step "Instalacao existente encontrada em $InstallDir - atualizando..."

        # O app rodando MANTEM arquivos abertos (electron.exe, .node, asar), e no
        # Windows o git nao consegue sobrescrever arquivo em uso: o pull falha, o
        # reset falha, os dois calados por causa do --quiet, e o instalador
        # seguia dizendo "Instalado!" com o codigo ANTIGO no disco. Foi
        # exatamente isso que fez um fix ja publicado parecer nao ter efeito.
        Get-Process -Name electron -ErrorAction SilentlyContinue |
            Where-Object { $_.Path -and $_.Path.StartsWith($InstallDir, [StringComparison]::OrdinalIgnoreCase) } |
            ForEach-Object {
                Write-Step "Fechando instancia em execucao (PID $($_.Id)) pra liberar os arquivos..."
                try { Stop-Process -Id $_.Id -Force -ErrorAction Stop; Start-Sleep -Milliseconds 800 } catch {}
            }

        Push-Location $InstallDir
        $antes = (git rev-parse HEAD 2>$null)
        git fetch origin master
        if ($LASTEXITCODE -ne 0) { Pop-Location; Write-Fatal "nao consegui buscar as atualizacoes do GitHub (rede/credenciais?)." }

        $alvo = (git rev-parse 'origin/master' 2>$null)
        git pull --ff-only origin master
        if ($LASTEXITCODE -ne 0) {
            Write-Step "pull --ff-only falhou (alteracao local?) - forcando pra origin/master..."
            git reset --hard 'origin/master'
        }
        $depois = (git rev-parse HEAD 2>$null)
        Pop-Location

        # Verificacao explicita: sem isto a atualizacao pode nao ter acontecido e
        # ninguem fica sabendo.
        if ($depois -ne $alvo) {
            Write-Fatal ("a atualizacao NAO foi aplicada (esta em $($depois.Substring(0,7)), " +
                "deveria estar em $($alvo.Substring(0,7))). Feche o Helper Node e rode de novo; " +
                "se persistir, apague $InstallDir e reinstale.")
        }
        if ($antes -eq $depois) {
            Write-Ok "ja estava na versao mais recente ($($depois.Substring(0,7)))"
        } else {
            Write-Ok "atualizado: $($antes.Substring(0,7)) -> $($depois.Substring(0,7))"
        }
    } else {
        Write-Step "Copia anterior sem git encontrada - reinstalando do zero..."
        Remove-Item -Recurse -Force $InstallDir
    }
}
if (-not (Test-Path $InstallDir)) {
    if ($gitCmd) {
        Write-Step "Clonando o repositorio em $InstallDir..."
        git clone --quiet $RepoUrl $InstallDir
    } else {
        Write-Step "git nao encontrado - baixando o codigo via .zip..."
        $zipPath = Join-Path $env:TEMP 'helper-node-src.zip'
        $extractDir = Join-Path $env:TEMP 'helper-node-src-extract'
        Invoke-WebRequest -Uri $ZipUrl -OutFile $zipPath
        if (Test-Path $extractDir) { Remove-Item -Recurse -Force $extractDir }
        Expand-Archive -Path $zipPath -DestinationPath $extractDir -Force
        $inner = Get-ChildItem $extractDir | Select-Object -First 1
        Move-Item $inner.FullName $InstallDir
        Remove-Item -Force $zipPath
        Remove-Item -Recurse -Force $extractDir -ErrorAction SilentlyContinue
    }
}
Write-Ok "Codigo-fonte em $InstallDir"

# 3) edition.json - mesma logica que o build Linux grava (ver services/edition.js)
Set-Content -Path (Join-Path $InstallDir 'edition.json') -Value "{`"edition`":`"$Edition`"}" -Encoding UTF8

# 4) npm install (traz o electron.exe oficial junto)
Write-Step "Instalando dependencias (npm install) - baixa o Electron oficial, pode levar alguns minutos..."
Push-Location $InstallDir
npm install --no-fund --no-audit
$npmExit = $LASTEXITCODE
Pop-Location
if ($npmExit -ne 0) { Write-Fatal "npm install falhou (codigo $npmExit)." }
Write-Ok "Dependencias instaladas"

$electronDir = Join-Path $InstallDir 'node_modules\electron'
$electronExe = Join-Path $electronDir 'dist\electron.exe'

# O postinstall do Electron extrai o .zip usando a lib 'extract-zip'. Em algumas
# versoes recentes do Node no Windows (visto no Node 24) ela morre em silencio
# depois do 1o arquivo do zip: o download funciona, mas o dist fica so com a
# pasta 'locales' e sem o electron.exe - e como o pacote ja esta em node_modules,
# rodar 'npm install' de novo NAO re-executa o postinstall, entao o estado quebrado
# gruda. Fallback confiavel: extrair o zip na mao com o Expand-Archive nativo.
if (-not (Test-Path $electronExe)) {
    Write-Step "electron.exe ausente - extraindo o Electron na mao (fallback do Expand-Archive)..."
    $ver = (Get-Content (Join-Path $electronDir 'package.json') -Raw | ConvertFrom-Json).version
    $arch = (& node -p 'process.arch').Trim()
    $zipName = "electron-v$ver-win32-$arch.zip"
    $cacheRoot = Join-Path $env:LOCALAPPDATA 'electron\Cache'
    $zip = $null
    if (Test-Path $cacheRoot) {
        $zip = Get-ChildItem $cacheRoot -Recurse -Filter $zipName -ErrorAction SilentlyContinue | Select-Object -First 1
    }
    if (-not $zip) {
        Write-Step "Zip nao estava no cache - baixando $zipName do release oficial do Electron..."
        $tmpZip = Join-Path $env:TEMP $zipName
        Invoke-WebRequest -Uri "https://github.com/electron/electron/releases/download/v$ver/$zipName" -OutFile $tmpZip
        $zip = Get-Item $tmpZip
    }
    $distDir = Join-Path $electronDir 'dist'
    if (Test-Path $distDir) { Remove-Item -Recurse -Force $distDir }
    Expand-Archive -Path $zip.FullName -DestinationPath $distDir -Force
    Set-Content -Path (Join-Path $electronDir 'path.txt') -Value 'electron.exe' -NoNewline -Encoding ASCII
}
if (-not (Test-Path $electronExe)) {
    Write-Fatal "electron.exe ainda ausente apos o fallback. Rode 'npm install' manualmente em $InstallDir pra ver o erro completo."
}
Write-Ok "Electron pronto"

# 5) Whisper.cpp & Modelos GGML (transcricao offline local — baixados uma unica vez)
$WhisperDir = Join-Path $InstallDir 'whisper'
$WhisperBinDir = Join-Path $WhisperDir 'build\bin'
$WhisperModelsDir = Join-Path $WhisperDir 'models'
$WhisperCliExe = Join-Path $WhisperBinDir 'whisper-cli.exe'

$CacheDir = Join-Path $env:LOCALAPPDATA 'helper-node-whisper-cache'
$CacheBinDir = Join-Path $CacheDir 'bin'
$CacheModelsDir = Join-Path $CacheDir 'models'

New-Item -ItemType Directory -Path $WhisperBinDir -Force | Out-Null
New-Item -ItemType Directory -Path $WhisperModelsDir -Force | Out-Null
New-Item -ItemType Directory -Path $CacheBinDir -Force | Out-Null
New-Item -ItemType Directory -Path $CacheModelsDir -Force | Out-Null

function Download-FileWithCache([string]$url, [string]$targetPath, [string]$cachedPath, [string]$label, [long]$minBytes = 1048576) {
    if ((Test-Path $targetPath) -and ((Get-Item $targetPath).Length -ge $minBytes)) {
        Write-Ok "$label ja presente"
        return
    }
    if ((Test-Path $cachedPath) -and ((Get-Item $cachedPath).Length -ge $minBytes)) {
        Write-Step "Restaurando $label do cache local..."
        Copy-Item -Path $cachedPath -Destination $targetPath -Force
        Write-Ok "$label restaurado do cache"
        return
    }
    # Limpa arquivos corrompidos ou incompletos de tentativas anteriores
    if (Test-Path $targetPath) { Remove-Item -Force $targetPath -ErrorAction SilentlyContinue }
    if (Test-Path $cachedPath) { Remove-Item -Force $cachedPath -ErrorAction SilentlyContinue }

    Write-Step "Baixando $label (uma unica vez)..."
    $origProgress = $ProgressPreference
    $ProgressPreference = 'SilentlyContinue'
    try { [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12 -bor [Net.SecurityProtocolType]::Tls13 } catch {}
    
    $downloadOk = $false
    for ($attempt = 1; $attempt -le 3; $attempt++) {
        try {
            Invoke-WebRequest -Uri $url -OutFile $targetPath -UseBasicParsing -TimeoutSec 180
            if ((Test-Path $targetPath) -and ((Get-Item $targetPath).Length -ge $minBytes)) {
                Copy-Item -Path $targetPath -Destination $cachedPath -Force
                Write-Ok "$label pronto e salvo no cache"
                $downloadOk = $true
                break
            } else {
                throw "Arquivo baixado incompleto (tamanho menor que $minBytes bytes)."
            }
        } catch {
            Write-Host "AVISO (tentativa $attempt de 3): Falha ao baixar $label ($($_.Exception.Message))" -ForegroundColor Yellow
            if (Test-Path $targetPath) { Remove-Item -Force $targetPath -ErrorAction SilentlyContinue }
            Start-Sleep -Seconds 2
        }
    }
    $ProgressPreference = $origProgress
    if (-not $downloadOk) {
        Write-Host "AVISO: Nao foi possivel baixar $label apos 3 tentativas. A transcricao offline utilizara fallback ou download posterior." -ForegroundColor Yellow
    }
}

$hasBin = (Test-Path $WhisperCliExe) -and ((Get-Item $WhisperCliExe).Length -ge 102400)

if (-not $hasBin) {
    $cachedExe = Join-Path $CacheBinDir 'whisper-cli.exe'
    if ((Test-Path $cachedExe) -and ((Get-Item $cachedExe).Length -ge 102400)) {
        Write-Step "Restaurando Whisper.cpp do cache local..."
        Copy-Item -Path "$CacheBinDir\*" -Destination $WhisperBinDir -Recurse -Force
        $hasBin = $true
        Write-Ok "Whisper.cpp restaurado do cache"
    }
}

if (-not $hasBin) {
    Write-Step "Baixando Whisper.cpp pre-compilado para Windows x64 (uma unica vez)..."
    try { [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12 -bor [Net.SecurityProtocolType]::Tls13 } catch {}
    $whisperZipUrl = 'https://github.com/ggml-org/whisper.cpp/releases/download/v1.9.2/whisper-bin-x64.zip'
    $tmpZip = Join-Path $env:TEMP 'whisper-bin-x64.zip'
    $tmpExtract = Join-Path $env:TEMP 'whisper-bin-x64-extract'
    $origProgress = $ProgressPreference
    $ProgressPreference = 'SilentlyContinue'
    try {
        if (Test-Path $tmpZip) { Remove-Item -Force $tmpZip -ErrorAction SilentlyContinue }
        Invoke-WebRequest -Uri $whisperZipUrl -OutFile $tmpZip -UseBasicParsing -TimeoutSec 180
        if (Test-Path $tmpExtract) { Remove-Item -Recurse -Force $tmpExtract -ErrorAction SilentlyContinue }
        Expand-Archive -Path $tmpZip -DestinationPath $tmpExtract -Force
        
        $cliFound = Get-ChildItem -Path $tmpExtract -Filter 'whisper-cli.exe' -Recurse -ErrorAction SilentlyContinue | Select-Object -First 1
        if (-not $cliFound) {
            $cliFound = Get-ChildItem -Path $tmpExtract -Filter 'main.exe' -Recurse -ErrorAction SilentlyContinue | Select-Object -First 1
        }
        if ($cliFound) {
            $srcDir = $cliFound.DirectoryName
            Copy-Item -Path "$srcDir\*" -Destination $WhisperBinDir -Recurse -Force
            Copy-Item -Path "$srcDir\*" -Destination $CacheBinDir -Recurse -Force
            $installedMain = Join-Path $WhisperBinDir 'main.exe'
            if ((Test-Path $installedMain) -and (-not (Test-Path $WhisperCliExe))) {
                Copy-Item -Path $installedMain -Destination $WhisperCliExe -Force
            }
            Write-Ok "Whisper.cpp binarios instalados e cacheados"
        } else {
            Write-Host "AVISO: Executavel whisper-cli.exe nao localizado no zip extraido." -ForegroundColor Yellow
        }
        
        Remove-Item -Force $tmpZip -ErrorAction SilentlyContinue
        Remove-Item -Recurse -Force $tmpExtract -ErrorAction SilentlyContinue
    } catch {
        Write-Host "AVISO: Nao foi possivel baixar o binario do Whisper ($($_.Exception.Message))." -ForegroundColor Yellow
    } finally {
        $ProgressPreference = $origProgress
    }
} else {
    Write-Ok "Whisper.cpp binarios prontos"
}

# Baixar os modelos essenciais com validacao de integridade (tamanho minimo)
Download-FileWithCache `
    -url 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin' `
    -targetPath (Join-Path $WhisperModelsDir 'ggml-base.bin') `
    -cachedPath (Join-Path $CacheModelsDir 'ggml-base.bin') `
    -label 'Modelo Whisper ggml-base.bin (~140 MB)' `
    -minBytes 104857600

Download-FileWithCache `
    -url 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.bin' `
    -targetPath (Join-Path $WhisperModelsDir 'ggml-small.bin') `
    -cachedPath (Join-Path $CacheModelsDir 'ggml-small.bin') `
    -label 'Modelo Whisper ggml-small.bin (~460 MB)' `
    -minBytes 314572800

# 6) comando `helper-node` no PATH do usuario atual - sem precisar de admin
New-Item -ItemType Directory -Path $BinDir -Force | Out-Null
$cmdContent = @'
@echo off
start "" "%LOCALAPPDATA%\helper-node\node_modules\electron\dist\electron.exe" "%LOCALAPPDATA%\helper-node" %*
'@
Set-Content -Path (Join-Path $BinDir 'helper-node.cmd') -Value $cmdContent -Encoding ASCII

$userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
if ($userPath -notlike "*$BinDir*") {
    $newPath = if ([string]::IsNullOrEmpty($userPath)) { $BinDir } else { "$userPath;$BinDir" }
    [Environment]::SetEnvironmentVariable('Path', $newPath, 'User')
    Write-Ok "Comando 'helper-node' registrado no PATH (abra um NOVO terminal PowerShell pra usar)"
} else {
    Write-Ok "Comando 'helper-node' ja estava no PATH"
}

# 7) atalhos (Area de Trabalho + Menu Iniciar)
$iconPath = Join-Path $InstallDir 'assets\windows.ico'
$shell = New-Object -ComObject WScript.Shell
function New-HelperShortcut([string]$LnkPath) {
    $sc = $shell.CreateShortcut($LnkPath)
    $sc.TargetPath = $electronExe
    $sc.Arguments = "`"$InstallDir`""
    $sc.WorkingDirectory = $InstallDir
    if (Test-Path $iconPath) { $sc.IconLocation = $iconPath }
    $sc.Description = 'Helper Node - copiloto de IA stealth'
    $sc.Save()
}
New-HelperShortcut (Join-Path ([Environment]::GetFolderPath('Desktop')) 'Helper Node.lnk')
$startMenuPrograms = Join-Path ([Environment]::GetFolderPath('StartMenu')) 'Programs'
New-HelperShortcut (Join-Path $startMenuPrograms 'Helper Node.lnk')
Write-Ok "Atalhos criados (Area de Trabalho e Menu Iniciar)"

Write-Host ""
Write-Host "=== Instalacao concluida (edicao: $Edition) ===" -ForegroundColor Magenta
Write-Host "Instalado em: $InstallDir"
Write-Host "Pra abrir depois: clique no atalho, ou digite 'helper-node' num NOVO terminal PowerShell."
Write-Host "Pra atualizar: rode este mesmo comando de novo (faz git pull + npm install)."
Write-Host "Edicao FULL: Transcricao offline local (Whisper) e provedores locais prontos." -ForegroundColor Green
Write-Host ""

Write-Step "Abrindo o Helper Node..."
Start-Process -FilePath $electronExe -ArgumentList "`"$InstallDir`""
