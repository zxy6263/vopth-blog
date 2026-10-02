@echo off
REM ===========================================================================
REM  One-click "delete a post" launcher.
REM
REM  Lists every post, asks which one to delete, shows exactly which files will
REM  be removed (article / its cover image / its asset folder), asks for
REM  confirmation, rebuilds, verifies the old page is gone, then offers to add
REM  a 301 redirect so shared links do not become dead links.
REM
REM  Why switch the code page: the console defaults to 936 (GBK) on a Chinese
REM  Windows, but Node writes UTF-8. Without chcp 65001 the Chinese text would
REM  show up as garbage.
REM
REM  Keep this file ASCII-only. Batch files are parsed in the OEM code page,
REM  so non-ASCII characters in the script itself are unreliable.
REM ===========================================================================

chcp 65001 >nul
cd /d "%~dp0"

node "tools\del-post.js" %*
set EXITCODE=%ERRORLEVEL%

echo.
if not "%EXITCODE%"=="0" echo [exit code: %EXITCODE%]
echo Press any key to close this window...
pause >nul
