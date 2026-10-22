@echo off
cd /d "%~dp0"
where node >nul 2>nul || (echo Node.js is not installed. Install Node 22 LTS from https://nodejs.org and run this again. & pause & exit /b 1)
if not exist node_modules ( echo Installing libraries, please wait... & call npm install || (echo npm install failed & pause & exit /b 1) )
if not exist .env copy .env.example .env >nul
echo Starting Pulscare... open http://localhost:3000 in Chrome
call npm start
pause
