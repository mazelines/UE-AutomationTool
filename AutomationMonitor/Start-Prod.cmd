@echo off
REM AutomationMonitor - Production one-click (double-click me).
REM Builds the UI and runs the single-port server (default http://127.0.0.1:4174).
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-prod.ps1" %*
if errorlevel 1 pause
