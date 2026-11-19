@echo off
setlocal
cd /d "%~dp0"
if not exist "api_python\.venv\Scripts\python.exe" (
  echo Silver Shield is not set up yet. Run setup_shield.bat first.
  pause
  exit /b 1
)
if not exist "dist\public\index.html" (
  echo Building the app for the first time...
  call npm run build
  if errorlevel 1 (
    echo Build failed. Make sure Node.js is installed.
    pause
    exit /b 1
  )
)
start "Silver Shield Helper" /min /d "%~dp0api_python" cmd /c ".venv\Scripts\python.exe -m uvicorn main:app --host 127.0.0.1 --port 8000"
timeout /t 5 /nobreak >nul
start "" "http://127.0.0.1:8000"
exit /b 0
