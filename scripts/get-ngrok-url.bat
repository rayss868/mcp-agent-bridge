@echo off
echo Current ngrok tunnel URL:
curl -s http://127.0.0.1:4040/api/tunnels 2>/dev/null | findstr /C:"https://"
