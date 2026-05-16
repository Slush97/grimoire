@echo off
setlocal
set "SCRIPT=%~dp0diagnose-gameinfo.ps1"
if not exist "%SCRIPT%" (
    echo Could not find diagnose-gameinfo.ps1 next to this file.
    pause
    exit /b 1
)
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT%"
echo.
echo Done. The report opened in Notepad and is saved on your Desktop as
echo grimoire-gameinfo-diagnostic.txt
echo.
pause
