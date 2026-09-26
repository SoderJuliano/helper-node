<#
.SYNOPSIS
    Helper Node launcher para PowerShell.
.DESCRIPTION
    Permite abrir arquivos ou diretorios no Helper Node via PowerShell:
    helper-node teste.txt
    helper-node .
#>
[CmdletBinding()]
param(
    [Parameter(ValueFromRemainingArguments = $true)]
    [string[]]$Arguments
)

$RootDir = Split-Path -Parent $PSScriptRoot
$ElectronBin = Join-Path $RootDir "node_modules\electron\dist\electron.exe"

$resolvedArgs = @($RootDir)
if ($Arguments) {
    foreach ($arg in $Arguments) {
        if ($arg.StartsWith("-")) {
            $resolvedArgs += $arg
        } elseif (Test-Path $arg) {
            $resolvedArgs += (Resolve-Path $arg).Path
        } else {
            $resolvedArgs += $arg
        }
    }
}

if (Test-Path $ElectronBin) {
    Start-Process -FilePath $ElectronBin -ArgumentList $resolvedArgs
} else {
    $LaunchJs = Join-Path $RootDir "launch.js"
    Start-Process -FilePath "node" -ArgumentList @($LaunchJs) + $Arguments
}
