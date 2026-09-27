@echo off
rem Single-command launcher for Windows: backend + frontend, one window.
rem   start.cmd        (Command Prompt, or double-click)
rem The work is in scripts\start.ps1; Ctrl-C stops both servers.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\start.ps1"
