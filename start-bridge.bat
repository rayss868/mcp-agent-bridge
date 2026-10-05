@echo off
title MCP Bridge - All in One
cd /d "D:\All_project\own\AI_Coder\MCP_Bridge"

echo ============================================
echo   MCP Bridge - All in One Terminal
echo ============================================
echo.

:: Start Cloudflare Tunnel using an environment variable
echo [1/3] Starting Cloudflare Tunnel...
if not defined CLOUDFLARED_TUNNEL_TOKEN (
  echo Set CLOUDFLARED_TUNNEL_TOKEN before running this script.
  pause
  exit /b 1
)
start /B cmd /c "cloudflared.exe tunnel run --protocol http2 --token %CLOUDFLARED_TUNNEL_TOKEN%"

:: Start MCP Bridge (background, same window)
echo [2/3] Starting MCP Bridge on port 8787...
start /B cmd /c "node src/index.js --config config/default.json --no-stdio --host 127.0.0.1 --port 8787"

timeout /t 3 /nobreak >nul
echo [3/3] Opening Admin UI...
start http://127.0.0.1:8787/

echo.
echo ============================================
echo   Admin UI : http://127.0.0.1:8787/
echo   Configure the tunnel in local settings.
echo   -------------------------------------------
echo   Press CTRL+C to stop the launcher.
echo ============================================
echo.
timeout /t -1 /nobreak >nul
