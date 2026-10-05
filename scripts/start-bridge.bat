@echo off
title MCP Bridge - All in One
cd /d "D:\All_project\own\AI_Coder\MCP_Bridge"

echo ============================================
echo   MCP Bridge - All in One Terminal
echo ============================================
echo.

echo [1/3] Menjalankan Cloudflare Tunnel...
if not defined CLOUDFLARED_TUNNEL_TOKEN (
  echo CLOUDFLARED_TUNNEL_TOKEN belum diatur.
  echo Atur token sebagai environment variable sebelum menjalankan skrip ini.
  pause
  exit /b 1
)
start /B cmd /c "cloudflared.exe tunnel run --protocol http2 --token %CLOUDFLARED_TUNNEL_TOKEN%"

echo [2/3] Memulai MCP Bridge di port 8787...
start /B cmd /c "node src/index.js --config config/default.json --no-stdio --host 127.0.0.1 --port 8787"

timeout /t 3 /nobreak >nul
echo [3/3] Membuka Admin UI...
start http://127.0.0.1:8787/

echo.
echo ============================================
echo   Admin UI : http://127.0.0.1:8787/
echo   Tunnel   : configure via local settings
echo   -------------------------------------------
echo   Press CTRL+C untuk stop launcher
echo ============================================
echo.
timeout /t -1 /nobreak >nul
