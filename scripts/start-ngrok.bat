@echo off
echo Starting ngrok tunnel with reserved domain...
echo URL: https://immense-eft-properly.ngrok-free.app/mcp
echo.
start /B "" "%USERPROFILE%\bin\ngrok.exe" http --domain=immense-eft-properly.ngrok-free.app 8787 --log=stdout --log-format=json > ngrok.log 2>&1
timeout /t 3 >nul
echo.
echo Tunnel active!
echo ChatGPT MCP Connector URL: https://immense-eft-properly.ngrok-free.app/mcp
echo.
echo Press Ctrl+C to stop.
pause >nul
