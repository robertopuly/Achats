@echo off
title Avvio Automatico - Lista Supermercato (Achats)
set "SRC=C:\Progetti\Achats\start_silenzioso.vbs"
set "DST=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\AchatsServer.vbs"
copy /y "%SRC%" "%DST%" >nul
wscript.exe "%SRC%"
echo [OK] Server avviato in background e configurato per l'avvio automatico di Windows!
pause
