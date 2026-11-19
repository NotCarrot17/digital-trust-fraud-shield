@echo off
setlocal
cd /d "%~dp0"
set "SHIELD_DOWNLOADS_DIR=%~dp0demo_downloads"
if not exist "dist\public\index.html" (
  echo Building the app for the first time...
  call npm run build
  if errorlevel 1 (
    echo Build failed. Make sure Node.js is installed.
    pause
    exit /b 1
  )
)
start "Silver Shield Demo" /min /d "%~dp0api_python" cmd /c ".venv\Scripts\python.exe -m uvicorn main:app --host 127.0.0.1 --port 8010"
timeout /t 5 /nobreak >nul
start "" "http://127.0.0.1:8010"
exit /b 0
