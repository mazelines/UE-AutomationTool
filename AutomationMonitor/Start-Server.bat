@echo off
setlocal EnableExtensions
REM AutomationMonitor - pure-batch server launcher (production mode).
REM Builds the UI, frees the port, then runs the Node server that serves
REM UI + API on one port (default http://127.0.0.1:4174).
REM Usage: Start-Server.bat [--no-build] [--no-browser] [port]

title AutomationMonitor Server
cd /d "%~dp0" || exit /b 1

set "PORT=4174"
set "DO_BUILD=1"
set "DO_BROWSER=1"

:parse_args
if "%~1"=="" goto args_done
if /i "%~1"=="--no-build" ( set "DO_BUILD=0" ) else if /i "%~1"=="--no-browser" ( set "DO_BROWSER=0" ) else ( set "PORT=%~1" )
shift
goto parse_args
:args_done

REM Elevate before installing, building, stopping listeners, or starting the server.
set "UE_MONITOR_BATCH_PATH=%~f0"
set "UE_MONITOR_BATCH_PORT=%PORT%"
set "UE_MONITOR_BATCH_BUILD=%DO_BUILD%"
set "UE_MONITOR_BATCH_BROWSER=%DO_BROWSER%"
powershell.exe -NoProfile -Command "if ($env:UE_MONITOR_BATCH_PORT -notmatch '^\d{1,5}$' -or [int]$env:UE_MONITOR_BATCH_PORT -lt 1 -or [int]$env:UE_MONITOR_BATCH_PORT -gt 65535) { Write-Host '[error] Port must be between 1 and 65535.'; exit 2 }; if (([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { exit 0 }; Write-Host '[admin] Approve the Windows UAC prompt.'; $launchArgs = @($env:UE_MONITOR_BATCH_PORT); if ($env:UE_MONITOR_BATCH_BUILD -eq '0') { $launchArgs += '--no-build' }; if ($env:UE_MONITOR_BATCH_BROWSER -eq '0') { $launchArgs += '--no-browser' }; try { $child = Start-Process -FilePath $env:UE_MONITOR_BATCH_PATH -Verb RunAs -WindowStyle Hidden -ArgumentList $launchArgs -PassThru -Wait; if ($child.ExitCode -ne 0) { exit 2 }; exit 10 } catch { Write-Host '[error] Administrator launch failed or UAC was cancelled.'; exit 2 }"
if errorlevel 10 exit /b 0
if errorlevel 1 (
    pause
    exit /b 1
)

where node >nul 2>nul
if errorlevel 1 (
    echo [error] Node.js not found in PATH. Install Node 18+ from https://nodejs.org/
    pause
    exit /b 1
)

if not exist "node_modules\" (
    echo [setup] Installing dependencies - first run...
    call npm install
    if errorlevel 1 ( echo [error] npm install failed. & pause & exit /b 1 )
)

if "%DO_BUILD%"=="1" (
    echo [build] Building production UI - vite build...
    call npm run build
    if errorlevel 1 ( echo [error] vite build failed. & pause & exit /b 1 )
) else (
    echo [build] Skipped - serving existing dist\
)

REM Free the port so a re-run restarts cleanly instead of hitting EADDRINUSE.
for /f "tokens=5" %%P in ('netstat -ano -p tcp ^| findstr /c:":%PORT% " ^| findstr /c:"LISTENING"') do (
    echo [port ] Stopping previous listener PID %%P on port %PORT%...
    taskkill /PID %%P /T /F >nul 2>nul
)

set "URL=http://127.0.0.1:%PORT%"
if "%DO_BROWSER%"=="1" (
    REM Open the browser once the server answers, so this window stays on the server log.
    start "open-when-ready" /min powershell -NoProfile -ExecutionPolicy Bypass -Command "for($i=0;$i -lt 120;$i++){ try { Invoke-WebRequest -Uri '%URL%' -UseBasicParsing -TimeoutSec 2 | Out-Null; Start-Process '%URL%'; break } catch { Start-Sleep -Milliseconds 500 } }"
)

echo.
echo [serve] Production server on %URL%
echo         This window runs the server -- press Ctrl+C or close it to stop.
echo.
set "UE6_MONITOR_PORT=%PORT%"
node server/index.js
