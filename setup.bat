@echo off
cd /d "%~dp0"
python scripts\setup_env.py %*
if errorlevel 1 pause
