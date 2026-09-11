@echo off
setlocal
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\configure-sap-sync.ps1" %*
set "SETUP_EXIT=%ERRORLEVEL%"
pause
exit /b %SETUP_EXIT%
