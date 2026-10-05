@echo off
setlocal
title MCP Bridge + ngrok
cd /d "%~dp0.."

echo ============================================
echo   MCP Bridge + ngrok - All in One
echo ============================================
echo.

if not exist "config\tunnel.json" (
  echo Pengaturan tunnel tidak ditemukan: config\tunnel.json
  pause
  exit /b 1
)

for /f "usebackq delims=" %%i in (`powershell -NoProfile -Command "$s=Get-Content -Raw 'config/tunnel.json' | ConvertFrom-Json; [Console]::WriteLine($s.ngrokDomain)"`) do set "NGROK_DOMAIN=%%i"
for /f "usebackq delims=" %%i in (`powershell -NoProfile -Command "$s=Get-Content -Raw 'config/tunnel.json' | ConvertFrom-Json; [Console]::WriteLine($s.ngrokToken)"`) do set "NGROK_AUTHTOKEN=%%i"

if not defined NGROK_DOMAIN (
  echo Domain ngrok belum diisi. Pilih ngrok dan isi Domain di UI, lalu simpan.
  pause
  exit /b 1
)
if not defined NGROK_AUTHTOKEN (
  echo ngrok Authtoken belum diisi. Isi Authtoken di UI, lalu simpan.
  pause
  exit /b 1
)
if not exist "%USERPROFILE%\bin\ngrok.exe" (
  echo ngrok.exe tidak ditemukan di %USERPROFILE%\bin\ngrok.exe
  pause
  exit /b 1
)

set "NGROK_DOMAIN_HOST=%NGROK_DOMAIN:https://=%"
set "NGROK_DOMAIN_HOST=%NGROK_DOMAIN_HOST:http://=%"
set "NGROK_DOMAIN_HOST=%NGROK_DOMAIN_HOST:/=%"

echo [1/2] Memulai MCP Bridge di port 8787...
start "MCP Bridge" /B node src/index.js --config config/default.json --no-stdio --host 127.0.0.1 --port 8787

timeout /t 2 /nobreak >nul

echo [2/2] Memulai ngrok untuk %NGROK_DOMAIN_HOST%...
start "ngrok" /B "%USERPROFILE%\bin\ngrok.exe" http --domain=%NGROK_DOMAIN_HOST% 8787 --log=stdout --log-format=json

timeout /t 3 /nobreak >nul

echo.
echo ============================================
echo   Admin UI : http://127.0.0.1:8787/
echo   Connector: https://%NGROK_DOMAIN_HOST%/mcp
echo   -------------------------------------------
echo   Ctrl+C untuk menghentikan launcher.
echo ============================================
echo.
timeout /t -1 /nobreak >nul
