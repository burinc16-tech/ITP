@echo off
rem One-shot Worker-only deploy for the ITP/ITR app. Double-click to run.
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0deploy-worker.ps1"
echo.
pause
