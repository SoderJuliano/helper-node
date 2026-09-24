#Requires -Version 5.1
# Helper Node — instalador Windows (redirecionado para instalador unificado)
#
# A divisao entre versoes Lite e Full foi unificada em um instalador unico,
# leve e moderno.

$ErrorActionPreference = 'Stop'
try { Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass -Force } catch {}

Write-Host "Redirecionando para o instalador unificado do Helper Node..." -ForegroundColor Cyan
& (Join-Path $PSScriptRoot 'install-windows.ps1')
