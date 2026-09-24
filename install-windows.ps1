#Requires -Version 5.1
# Helper Node — instalador Windows oficial e unificado
#
# Uso (PowerShell, sem precisar clonar nada antes):
#   irm https://raw.githubusercontent.com/SoderJuliano/helper-node/master/install-windows.ps1 | iex
#
# Clona/atualiza o codigo-fonte, executa `npm install` (baixa o electron.exe oficial
# do projeto Electron) e registra atalho na Area de Trabalho/Menu Iniciar + o comando
# `helper-node` no PATH do usuario atual (sem exigir privilegios de administrador).

$ErrorActionPreference = 'Stop'

# Libera execucao de scripts para este processo (sem alterar configuracoes globais da maquina)
try { Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass -Force } catch {}

$RepoUrl = 'https://github.com/SoderJuliano/helper-node.git'
$ZipUrl = 'https://github.com/SoderJuliano/helper-node/archive/refs/heads/master.zip'
$InstallDir = Join-Path $env:LOCALAPPDATA 'helper-node'
$BinDir = Join-Path $InstallDir 'bin'

function Write-Step($msg) { Write-Host "-> $msg" -ForegroundColor Cyan }
function Write-Ok($msg) { Write-Host "OK: $msg" -ForegroundColor Green }
function Write-Fatal($msg) { Write-Host "ERRO: $msg" -ForegroundColor Red; exit 1 }

Write-Host "=== Helper Node - Instalador Windows ===" -ForegroundColor Magenta
Write-Host "Versao de acesso gratuito - Instalacao rapida e unificada" -ForegroundColor DarkGray

# 1) Node.js (minimo 18)
$nodeCmd = Get-Command node -ErrorAction SilentlyContinue
if (-not $nodeCmd) {
    Write-Fatal "Node.js nao encontrado. Instale a versao 18 ou mais recente em https://nodejs.org e execute este instalador novamente."
}
$nodeVersion = [Version]((node -v) -replace '^v', '')
if ($nodeVersion.Major -lt 18) {
    Write-Fatal "Node.js v$nodeVersion e antigo demais (minimo: 18). Atualize em https://nodejs.org."
}
Write-Ok "Node.js v$nodeVersion detectado"

# 2) Codigo-fonte: git clone/pull (preferido) ou fallback via .zip
$gitCmd = Get-Command git -ErrorAction SilentlyContinue
if (Test-Path $InstallDir) {
    if ($gitCmd -and (Test-Path (Join-Path $InstallDir '.git'))) {
        Write-Step "Instalacao existente encontrada em $InstallDir - atualizando..."

        Get-Process -Name electron -ErrorAction SilentlyContinue |
            Where-Object { $_.Path -and $_.Path.StartsWith($InstallDir, [StringComparison]::OrdinalIgnoreCase) } |
            ForEach-Object {
                Write-Step "Fechando instancia em execucao (PID $($_.Id)) para liberar arquivos..."
                try { Stop-Process -Id $_.Id -Force -ErrorAction Stop; Start-Sleep -Milliseconds 800 } catch {}
            }

        Push-Location $InstallDir
        $antes = (git rev-parse HEAD 2>$null)
        git fetch origin master
        if ($LASTEXITCODE -ne 0) { Pop-Location; Write-Fatal "Nao foi possivel buscar atualizacoes no GitHub (verifique conexao)." }

        $alvo = (git rev-parse 'origin/master' 2>$null)
        git pull --ff-only origin master
        if ($LASTEXITCODE -ne 0) {
            Write-Step "pull --ff-only divergiu - sincronizando com origin/master..."
            git reset --hard 'origin/master'
        }
        $depois = (git rev-parse HEAD 2>$null)
        Pop-Location

        if ($depois -ne $alvo) {
            Write-Fatal ("A atualizacao nao foi aplicada (atual: $($depois.Substring(0,7)), esperado: $($alvo.Substring(0,7))). Feche o app e tente novamente.")
        }
        if ($antes -eq $depois) {
            Write-Ok "Ja esta na versao mais recente ($($depois.Substring(0,7)))"
        } else {
            Write-Ok "Atualizado com sucesso: $($antes.Substring(0,7)) -> $($depois.Substring(0,7))"
        }
    } else {
        Write-Step "Instalacao anterior sem git encontrada - reinstalando..."
        Remove-Item -Recurse -Force $InstallDir
    }
}

if (-not (Test-Path $InstallDir)) {
    if ($gitCmd) {
        Write-Step "Clonando o repositorio em $InstallDir..."
        git clone --quiet $RepoUrl $InstallDir
    } else {
        Write-Step "Git nao encontrado - baixando codigo-fonte via pacote .zip..."
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
Write-Ok "Codigo-fonte pronto em $InstallDir"

# 3) Marcador de configuracao unificada
Set-Content -Path (Join-Path $InstallDir 'edition.json') -Value '{"edition":"unified"}' -Encoding UTF8

# 4) Dependencias do projeto (npm install)
Write-Step "Instalando dependencias (npm install) - baixando Electron oficial..."
Push-Location $InstallDir
npm install --no-fund --no-audit
$npmExit = $LASTEXITCODE
Pop-Location
if ($npmExit -ne 0) { Write-Fatal "npm install falhou (codigo $npmExit)." }
Write-Ok "Dependencias instaladas"

$electronDir = Join-Path $InstallDir 'node_modules\electron'
$electronExe = Join-Path $electronDir 'dist\electron.exe'

# Fallback se a descompactacao do Electron falhar em certas versoes do Node
if (-not (Test-Path $electronExe)) {
    Write-Step "electron.exe ausente - realizando extracao direta..."
    $ver = (Get-Content (Join-Path $electronDir 'package.json') -Raw | ConvertFrom-Json).version
    $arch = (& node -p 'process.arch').Trim()
    $zipName = "electron-v$ver-win32-$arch.zip"
    $cacheRoot = Join-Path $env:LOCALAPPDATA 'electron\Cache'
    $zip = $null
    if (Test-Path $cacheRoot) {
        $zip = Get-ChildItem $cacheRoot -Recurse -Filter $zipName -ErrorAction SilentlyContinue | Select-Object -First 1
    }
    if (-not $zip) {
        Write-Step "Baixando $zipName do repositorio oficial do Electron..."
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
    Write-Fatal "electron.exe ausente. Execute 'npm install' manualmente em $InstallDir para verificar os logs."
}
Write-Ok "Electron configurado e pronto"

# 5) Comando `helper-node` registrado no PATH de usuario
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
    Write-Ok "Comando 'helper-node' registrado no PATH"
} else {
    Write-Ok "Comando 'helper-node' ja configurado no PATH"
}

# 6) Atalhos na Area de Trabalho e Menu Iniciar
$iconPath = Join-Path $InstallDir 'assets\windows.ico'
$shell = New-Object -ComObject WScript.Shell
function New-HelperShortcut([string]$LnkPath) {
    $sc = $shell.CreateShortcut($LnkPath)
    $sc.TargetPath = $electronExe
    $sc.Arguments = "`"$InstallDir`""
    $sc.WorkingDirectory = $InstallDir
    if (Test-Path $iconPath) { $sc.IconLocation = $iconPath }
    $sc.Description = 'Helper Node - Copiloto de IA Stealth'
    $sc.Save()
}
New-HelperShortcut (Join-Path ([Environment]::GetFolderPath('Desktop')) 'Helper Node.lnk')
$startMenuPrograms = Join-Path ([Environment]::GetFolderPath('StartMenu')) 'Programs'
New-HelperShortcut (Join-Path $startMenuPrograms 'Helper Node.lnk')
Write-Ok "Atalhos criados na Area de Trabalho e no Menu Iniciar"

Write-Host ""
Write-Host "=== Instalacao concluida com sucesso! ===" -ForegroundColor Magenta
Write-Host "Local da instalacao: $InstallDir"
Write-Host "Como abrir: Use o atalho na Area de Trabalho ou execute 'helper-node' em um terminal."
Write-Host "Para atualizar: Basta executar este mesmo comando novamente a qualquer momento."
Write-Host "Acesso gratuito: Esta versao e 100% gratuita por tempo limitado."
Write-Host ""

Write-Step "Iniciando o Helper Node..."
Start-Process -FilePath $electronExe -ArgumentList "`"$InstallDir`""
