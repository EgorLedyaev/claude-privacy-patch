@echo off
cd /d "%~dp0"
if not exist "node_modules" (
  call npm install
)
node cli.js update all %*
pause
