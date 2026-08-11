@echo off
cd /d "%~dp0"
echo Rebuilding the app (about a minute)...
node .\node_modules\vite\bin\vite.js build > rebuild-output.txt 2>&1
type rebuild-output.txt
echo.
echo FINISHED - you can close this window now.
pause
