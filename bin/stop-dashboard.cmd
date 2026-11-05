@echo off
REM Double-click this to stop the job-digest dashboard if it's running in
REM the background. You only need this if you actually want to pause or
REM remove it - there's no need to run it as part of normal daily use.

echo Stopping job-digest...

if exist "%~dp0.dashboard.pid" (
  set /p DASHBOARD_PID=<"%~dp0.dashboard.pid"
  taskkill /PID %DASHBOARD_PID% /F >nul 2>&1
  del "%~dp0.dashboard.pid" >nul 2>&1
)

REM Fallback in case the saved PID is stale (e.g. after a restart) - find
REM whatever is actually listening on the dashboard's port and stop that too.
powershell -NoProfile -Command "Get-NetTCPConnection -LocalPort 4317 -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique | ForEach-Object { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue }"

echo Done.
timeout /t 2 /nobreak >nul
