@echo off
setlocal

set "BIN_DIR=%~dp0"
for %%I in ("%BIN_DIR%..") do set "ROOT_DIR=%%~fI"
set "ELECTRON_BIN=%ROOT_DIR%\node_modules\electron\dist\electron.exe"

if exist "%ELECTRON_BIN%" (
    start "" "%ELECTRON_BIN%" "%ROOT_DIR%" %*
) else (
    node "%ROOT_DIR%\launch.js" %*
)
