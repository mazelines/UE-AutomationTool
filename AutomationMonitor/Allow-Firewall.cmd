@echo off
REM Add inbound firewall rule for Vite dev port 5173. Self-elevates via UAC.
net session >nul 2>&1
if %errorlevel% neq 0 (
  powershell -NoProfile -Command "Start-Process -Verb RunAs '%~f0'"
  exit /b
)
netsh advfirewall firewall add rule name="Vite 5173" dir=in action=allow protocol=TCP localport=5173
echo.
echo Done. Rule "Vite 5173" added.
pause
