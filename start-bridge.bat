@echo off
title MCP Bridge - All in One
cd /d "D:\All_project\own\AI_Coder\MCP_Bridge"

echo ============================================
echo   MCP Bridge - All in One Terminal
echo ============================================
echo.

:: Start Cloudflare Tunnel (background, same window)
echo [1/3] Menjalankan Cloudflare Tunnel...
start /B cmd /c "cloudflared.exe tunnel run --protocol http2 --token eyJhIjoiNDA1NGI0MTMwODIyZTFhODcxMTUwNjY0NmNlZDM3NTUiLCJ0IjoiNjM2MDE4OTktYWYyNC00NWJiLTkwMDMtZDhiOTFjYzM0ODliIiwicyI6Ik1HTXpNemRtWTJNdFkyRmxNaTAwWWpVMExXRTFOamd0TW1ZNE5XWTFZalU0TnprMSJ9"

:: Start MCP Bridge (background, same window)
echo [2/3] Memulai MCP Bridge di port 8787...
start /B cmd /c "node src/index.js --config config/default.json --no-stdio --host 127.0.0.1 --port 8787"

:: Wait a moment then open browser
timeout /t 3 /nobreak >nul
echo [3/3] Membuka Admin UI...
start http://127.0.0.1:8787/

echo.
echo ============================================
echo   Semua berjalan di terminal ini!
echo   Admin UI : http://127.0.0.1:8787/
echo   Tunnel   : https://local-mcp.rayzs.qzz.io
echo   -------------------------------------------
echo   Press CTRL+C untuk stop semua proses
echo ============================================
echo.

:: Wait forever until user presses CTRL+C
timeout /t -1 /nobreak >nul
