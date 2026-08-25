@echo off
setlocal
cd /d %~dp0

echo ==========================================
echo RandoRadar - preparation Android
echo ==========================================

where node >nul 2>nul
if errorlevel 1 (
  echo ERREUR: Node.js n'est pas installe.
  echo Installer Node.js 22.13 ou plus recent puis relancer ce fichier.
  pause
  exit /b 1
)

echo [1/3] Installation des dependances...
call npm install
if errorlevel 1 goto :error

echo [2/3] Generation du projet Android natif...
call npx expo prebuild --platform android
if errorlevel 1 goto :error

echo [3/3] Lancement sur un telephone Android connecte / emulateur...
call npx expo run:android
if errorlevel 1 goto :error

echo Termine.
pause
exit /b 0

:error
echo.
echo Une erreur est survenue. Verifier Android Studio, le SDK Android et la connexion du telephone.
pause
exit /b 1
