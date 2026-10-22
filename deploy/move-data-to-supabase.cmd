@echo off
rem Double-click to copy this computer's portal data into Supabase (one time, before using the Render site).
cd /d "%~dp0.."
title Move SAO data to Supabase
set "SUPABASE_URL=https://chrgfpssxaapsghcgxql.supabase.co"
echo.
echo  Moving the SAO Portal data to Supabase project:
echo  %SUPABASE_URL%
echo.
echo  Paste your NEW Supabase secret key (starts with sb_secret_) and press Enter.
echo  (Right-click in this window to paste.)
echo.
set /p "SUPABASE_SERVICE_KEY=Secret key: "
echo.
node deploy\upload-to-supabase.js
echo.
pause
