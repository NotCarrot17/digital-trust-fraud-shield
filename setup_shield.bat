@echo off
setlocal
cd /d "%~dp0"
where python >nul 2>nul
if errorlevel 1 (
  echo Please install Python 3.11 or newer from python.org and tick "Add to PATH".
  pause
  exit /b 1
)
if not exist "dist\public\index.html" (
  where npm >nul 2>nul
  if errorlevel 1 (
    echo The web app is not built yet. Install Node.js 20 or newer from nodejs.org, or copy a built dist folder.
    pause
    exit /b 1
  )
)
cd api_python
if not exist ".venv\Scripts\python.exe" (
  python -m venv .venv
  if errorlevel 1 (
    pause
    exit /b 1
  )
)
".venv\Scripts\python.exe" -m pip install --upgrade pip
".venv\Scripts\python.exe" -m pip install -r requirements.txt
if errorlevel 1 (
  echo Could not install the Python packages.
  pause
  exit /b 1
)
cd ..
if exist "dist\public\index.html" (
  echo Web app is already built. Skipping Node.js steps.
) else (
  call npm install
  if errorlevel 1 (
    echo Could not install the web packages.
    pause
    exit /b 1
  )
  call npm run build
  if errorlevel 1 (
    echo Could not build the web app.
    pause
    exit /b 1
  )
)
echo.
echo Setup complete. Double-click start_shield.bat to open Silver Shield.
pause
