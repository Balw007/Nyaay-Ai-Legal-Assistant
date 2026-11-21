@echo off
setlocal enableextensions
title Nyaay - system check
cd /d "%~dp0"

set "PY="
for %%C in (py python python3) do (
  if not defined PY (
    %%C -c "import sys; sys.exit(0 if sys.version_info[:2] >= (3,9) else 1)" >nul 2>nul && set "PY=%%C"
  )
)
if not defined PY (
  echo  [X] Python 3.9 or newer was not found. Install it from https://www.python.org/downloads/ and tick "Add python.exe to PATH".
  goto :end
)
if /i "%PY%"=="py" set "PY=py -3"

if not exist ".venv\Scripts\python.exe" (
  echo  Creating a private Python environment, first time only ...
  %PY% -m venv .venv
  if errorlevel 1 ( echo  [X] Could not create the Python environment. & goto :end )
)
set "VPY=.venv\Scripts\python.exe"

fc /b requirements.txt .venv\installed-requirements.txt >nul 2>nul
if errorlevel 1 (
  echo  Installing Python packages, first time only, a few minutes ...
  "%VPY%" -m pip install --disable-pip-version-check -q -r requirements.txt
  if errorlevel 1 ( echo  [X] Installing the Python packages failed. Check your internet connection and run this again. & goto :end )
  copy /y requirements.txt .venv\installed-requirements.txt >nul
)

"%VPY%" -m app.doctor %*

:end
echo.
pause
endlocal
