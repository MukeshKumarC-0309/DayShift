@echo off
rem Windows entry point for the dayshift command (see bin\dayshift.ps1).
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0dayshift.ps1" %*
