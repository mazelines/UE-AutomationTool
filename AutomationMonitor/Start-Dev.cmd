@echo off
REM AutomationMonitor - Development one-click (double-click me).
REM Launches backend (--dev, :4174) + Vite dev server (:5173) in their own windows.
REM Open http://127.0.0.1:5173 (auto-opens).
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-dev.ps1" %*
if errorlevel 1 pause
