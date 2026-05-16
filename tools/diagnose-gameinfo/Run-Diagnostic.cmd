@echo off
setlocal
set "SCRIPT=%~dp0diagnose-gameinfo.ps1"
if not exist "%SCRIPT%" set "SCRIPT=%~dp0diagnosegameinfo.ps1"
if not exist "%SCRIPT%" set "SCRIPT=%~dp0diagnose_gameinfo.ps1"
if not exist "%SCRIPT%" (
    echo Could not find diagnose-gameinfo.ps1 next to this file.
    echo Looked for: diagnose-gameinfo.ps1, diagnosegameinfo.ps1, diagnose_gameinfo.ps1
    echo Make sure both files are in the same folder.
    pause
    exit /b 1
)
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT%"
echo.
echo Done. The report opened in Notepad and is saved on your Desktop as
echo grimoire-gameinfo-diagnostic.txt
echo.
pause
