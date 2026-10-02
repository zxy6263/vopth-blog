@echo off
REM ===========================================================================
REM  One-click "publish a post" launcher.
REM
REM  Double-click this file, answer a few questions, write the body in the
REM  editor that opens, then save and close it. The script builds the site and
REM  pushes to GitHub; Cloudflare redeploys automatically.
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

node "tools\new-post.js" %*
set EXITCODE=%ERRORLEVEL%

echo.
if not "%EXITCODE%"=="0" echo [exit code: %EXITCODE%]
echo Press any key to close this window...
pause >nul
