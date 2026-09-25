@echo off
title Antigravity Custom (SX Core SDK) Installer
chcp 65001 >nul
cd /d "%~dp0"
echo.
echo =======================================================
echo  Antigravity Custom (SX Core SDK) Kurulumu Baslatiliyor
echo =======================================================
echo.
node installer.js %*
echo.
pause
