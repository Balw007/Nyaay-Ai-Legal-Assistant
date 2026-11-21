@echo off
setlocal enableextensions
title Nyaay
cd /d "%~dp0"
echo.
echo  Nyaay
echo  -----

rem ---- 1. Python 3.9 or newer
set "PY="
for %%C in (py python python3) do (
  if not defined PY (
    %%C -c "import sys; sys.exit(0 if sys.version_info[:2] >= (3,9) else 1)" >nul 2>nul && set "PY=%%C"
  )
)
if not defined PY (
  echo  [X] Python 3.9 or newer was not found.
  echo      Install Python 3.12 from https://www.python.org/downloads/
  echo      Tick "Add python.exe to PATH" on the first screen, then run this file again.
  goto :fail
)
if /i "%PY%"=="py" set "PY=py -3"

rem ---- 2. Private Python environment, created once
if not exist ".venv\Scripts\python.exe" (
  echo  Creating a private Python environment, first time only ...
  %PY% -m venv .venv
  if errorlevel 1 ( echo  [X] Could not create the Python environment. & goto :fail )
)
set "VPY=.venv\Scripts\python.exe"

rem ---- 3. Python packages: install the first time and whenever requirements.txt changes
fc /b requirements.txt .venv\installed-requirements.txt >nul 2>nul
if errorlevel 1 (
  echo  Installing Python packages, first time only, a few minutes ...
  "%VPY%" -m pip install --disable-pip-version-check -q -r requirements.txt
  if errorlevel 1 (
    echo  [X] Installing the Python packages failed. Check your internet connection and run this again.
    goto :fail
  )
  copy /y requirements.txt .venv\installed-requirements.txt >nul
)

rem ---- 4. Friendly warnings. None of these stop Nyaay from starting.
where node >nul 2>nul || (
  echo  [!] Node.js was not found. Install the LTS version from https://nodejs.org to get the new screens.
  echo      Nyaay will start with the basic screens meanwhile.
)
where ollama >nul 2>nul || (
  echo  [!] Ollama was not found. Install it from https://ollama.com/download for AI answers, then run setup-ai.bat
)
where tesseract >nul 2>nul || if not exist "C:\Program Files\Tesseract-OCR\tesseract.exe" (
  echo  [!] Tesseract OCR was not found, so scanned orders cannot be read. See README: "Scanned orders".
)

rem ---- 5. Run
set "ARGS="
if /i "%~1"=="rebuild" set "ARGS=--rebuild"
"%VPY%" -m app.launch %ARGS%
if errorlevel 1 goto :fail
goto :end

:fail
echo.
echo  Nyaay did not start. To find out why, run check-nyaay.bat and read the lines marked FAIL.
echo.
pause
exit /b 1

:end
endlocal
