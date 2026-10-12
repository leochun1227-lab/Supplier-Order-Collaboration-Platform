@echo off
setlocal
cd /d "%~dp0"
powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "%~dp0scripts\run-supplier-update.ps1" %*
set "SYNC_EXIT=%ERRORLEVEL%"
exit /b %SYNC_EXIT%
