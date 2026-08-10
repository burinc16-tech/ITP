@echo off
cd /d "%~dp0"
echo Starting the ITP/ITR website server.
echo KEEP THIS WINDOW OPEN - closing it stops the website.
echo.
node .\node_modules\vite\bin\vite.js preview --port 4173 --host
pause
