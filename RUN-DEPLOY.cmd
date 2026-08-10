@echo off
setlocal
cd /d "%~dp0"
echo [%date% %time%] runner started > run-output.txt
echo Checking tools... >> run-output.txt
where powershell >> run-output.txt 2>&1
where node >> run-output.txt 2>&1
echo. >> run-output.txt
echo Running the ITP/ITR deploy - this window will sit quiet for a few minutes.
echo Please leave it open until it says FINISHED.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0deploy-with-token.ps1" >> run-output.txt 2>&1
echo [%date% %time%] powershell exited with code %errorlevel% >> run-output.txt
echo.
echo ================ OUTPUT ================
type run-output.txt
echo.
echo FINISHED - you can close this window now.
pause
