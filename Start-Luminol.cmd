@echo off
powershell.exe -NoProfile -File "%~dp0Start-Luminol.ps1"
if errorlevel 1 pause
