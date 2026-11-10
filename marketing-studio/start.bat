@echo off
cd /d "%~dp0"
where ffmpeg >nul 2>nul || echo ! ffmpeg not found - video export needs it (winget install ffmpeg)
if not exist .venv python -m venv .venv
.venv\Scripts\pip install -q -r requirements.txt
.venv\Scripts\python studio.py serve %*
