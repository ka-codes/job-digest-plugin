@echo off
REM Double-click this to start the job-digest dashboard. It runs invisibly
REM in the background - no window to leave open. To stop it, double-click
REM stop-dashboard.cmd in this same folder.

cd /d "%~dp0..\app"

if not exist node_modules (
  echo First time setup - installing a few things, this takes a minute...
  call npm install
  echo.
)

echo Starting job-digest...
powershell -NoProfile -Command "$p = Start-Process -FilePath 'node' -ArgumentList 'server.mjs' -WorkingDirectory (Get-Location) -WindowStyle Hidden -PassThru; $p.Id | Out-File -Encoding ascii '%~dp0.dashboard.pid'"

echo Waiting for it to come up, then opening your browser...
timeout /t 3 /nobreak >nul
start "" http://localhost:4317

echo.
echo job-digest is now running in the background.
echo To stop it later, double-click stop-dashboard.cmd in this folder.
timeout /t 4 /nobreak >nul
