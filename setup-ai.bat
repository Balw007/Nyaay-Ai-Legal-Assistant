@echo off
title Nyaay - set up local AI
cd /d "%~dp0"
where ollama >nul 2>nul || (
  echo Ollama is not installed. Install it from https://ollama.com/download, open it once, then run this file again.
  pause
  exit /b 1
)
echo Downloading the local AI models (one time, about 8 GB). Keep this window open.
echo.
rem  Defaults can be changed in the .env file; small computers can use qwen3:4b only.
ollama pull qwen3:8b || goto :err
ollama pull qwen3:4b || goto :err
ollama pull nomic-embed-text || goto :err
echo.
echo Done. Run check-nyaay.bat to confirm everything works.
pause
exit /b 0
:err
echo.
echo A download failed. Check your internet and run this file again: it continues where it stopped.
pause
exit /b 1
