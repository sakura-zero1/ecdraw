@echo off
cd /d "%~dp0"
echo Starting ECDraw 2.0 Dev Server...
pnpm tauri dev
pause
