@echo off
REM ===========================================================================
REM  One-click "back up the project memory" launcher.
REM
REM  Copies .project-notes and .dsh-project-memory to another PHYSICAL disk
REM  (D: -> F: by default). Both folders are gitignored -- the repo is public,
REM  these notes are not -- so without this they exist on exactly one disk.
REM  On this machine D: and F: are two different SSDs, so a copy survives one
REM  of them dying.
REM
REM  Double-click to refresh the backup. Pass a path to store it elsewhere:
REM    backup-memory.cmd -Dest "E:\somewhere"
REM
REM  Keep this file ASCII-only. Batch files are parsed in the OEM code page,
REM  so non-ASCII characters in the script itself are unreliable.
REM ===========================================================================

chcp 65001 >nul
cd /d "%~dp0"

powershell -NoProfile -ExecutionPolicy Bypass -File "tools\backup-memory.ps1" %*
set EXITCODE=%ERRORLEVEL%

echo.
if not "%EXITCODE%"=="0" echo [exit code: %EXITCODE%]
echo Press any key to close this window...
pause >nul
