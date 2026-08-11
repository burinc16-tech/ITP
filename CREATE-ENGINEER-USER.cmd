@echo off
setlocal
cd /d "%~dp0"
set WRANGLER=.\node_modules\wrangler\bin\wrangler.js

if not exist create-engineer-user.sql (
  echo create-engineer-user.sql not found next to this script.
  echo It may already have been applied and deleted - nothing to do.
  pause
  exit /b 1
)

echo Creating the engineer account on the LIVE database...
node %WRANGLER% d1 execute itp-itr --remote --config api\wrangler.toml --file create-engineer-user.sql
if not errorlevel 1 goto success

echo.
echo First attempt failed - you may need to log in to Cloudflare.
echo A browser window will open. Click "Allow", then come back here.
node %WRANGLER% login
if errorlevel 1 goto fail

echo Retrying...
node %WRANGLER% d1 execute itp-itr --remote --config api\wrangler.toml --file create-engineer-user.sql
if errorlevel 1 goto fail

:success
del create-engineer-user.sql
echo.
echo ==============================================
echo  DONE - engineer account created:
echo    Email: burinc@kenyon.com.sg
echo    Name:  Burin Chotwatanakul
echo    Role:  site_engineer
echo  Sign in with the password Claude gave you.
echo ==============================================
pause
exit /b 0

:fail
echo.
echo Something went wrong - read the messages above.
echo  - "UNIQUE constraint" means the account already exists.
echo  - An authentication error means the Cloudflare login did not finish;
echo    run this file again and complete the browser login.
pause
exit /b 1
