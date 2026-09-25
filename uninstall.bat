@echo off
title Antigravity Custom (SX Core SDK) Uninstaller
chcp 65001 >nul
cd /d "%~dp0"
echo.
echo =======================================================
echo  Antigravity Custom (SX Core SDK) Kaldiriliyor...
echo =======================================================
echo.
node installer.js --uninstall
echo.
pause
