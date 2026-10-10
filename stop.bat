@echo off
cd /d "%~dp0"
".venv\Scripts\python.exe" scripts\launch.py --stop
if errorlevel 1 pause
