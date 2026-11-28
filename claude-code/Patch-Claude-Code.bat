@echo off
cd /d "%~dp0\.."
node cli.js patch code %*
pause
