@echo off
setlocal
cd /d %~dp0

echo ==========================================
echo RandoRadar - creation APK DEBUG
 echo ==========================================

call npm install
if errorlevel 1 goto :error

call npx expo prebuild --platform android
if errorlevel 1 goto :error

cd android
call gradlew.bat assembleDebug
if errorlevel 1 goto :error

cd ..
echo.
echo APK cree ici :
echo android\app\build\outputs\apk\debug\app-debug.apk
pause
exit /b 0

:error
echo.
echo Echec de compilation. Android Studio / SDK / JDK doivent etre installes et configures.
pause
exit /b 1
