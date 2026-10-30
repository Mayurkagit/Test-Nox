@echo off
rem Double-click to sync this PC's clock (asks for administrator rights)
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0sync-time.ps1"
