@echo off
chcp 65001 >nul
cd /d "%~dp0"
set "NPM_CONFIG_CACHE=D:\npm_cache"
"C:\Program Files\nodejs\node.exe" "scripts\check-local-updates.mjs"
curl.exe -fsS --max-time 2 http://127.0.0.1:3000/local-launch-marker.txt 2>NUL | findstr /C:"moranjianghu-local-launcher-bacon159" >NUL
if not errorlevel 1 (
  echo [墨色江湖] 本地网站已经运行：http://127.0.0.1:3000/
  pause
  exit /b 0
)
"C:\Program Files\nodejs\node.exe" "node_modules\vite\bin\vite.js" --host 127.0.0.1 --port 3000 --strictPort
pause
