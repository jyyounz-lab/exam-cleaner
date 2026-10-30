@echo off
chcp 65001 >nul
cd /d "%~dp0"
if not exist "node_modules\vite" (
  echo 請先在此資料夾執行 npm ci，再執行 npm run build。
  pause
  exit /b 1
)
set "BASE_PATH=/"
call npm run build
if errorlevel 1 exit /b 1
echo 本機預覽：http://127.0.0.1:4174/
echo 按 Ctrl+C 停止預覽。
call npm run preview -- --port 4174
