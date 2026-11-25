@echo off
cd /d "%~dp0\.."
node claude-science\patch-science.js %*
pause
