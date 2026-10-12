@echo off
setlocal
cd /d "%~dp0"
echo This installs the daily 17:00 task on THIS computer for the current Windows user.
echo Run this only on the intended SAP sync computer, after setup and a successful run.bat.
powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "%~dp0scripts\register-sap-sync.ps1" %*
set "TASK_EXIT=%ERRORLEVEL%"
if not "%TASK_EXIT%"=="0" echo Task installation failed. Read the message above.
pause
exit /b %TASK_EXIT%
