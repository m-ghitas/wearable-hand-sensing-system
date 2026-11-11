@echo off
setlocal
cd /d "%~dp0"

set PORT=8001

echo ================================================
echo          GLOVE MOTION LAB - VERSION 4
echo       MODEL-AUTHORED JOINT KINEMATICS
echo ================================================

echo.
if not exist "assets\hand_model.glb" (
    echo ERROR: assets\hand_model.glb is missing.
    pause
    exit /b 1
)
if not exist "assets\hand_kinematics.json" (
    echo ERROR: assets\hand_kinematics.json is missing.
    pause
    exit /b 1
)

for %%A in ("assets\hand_model.glb") do set MODEL_SIZE=%%~zA
if %MODEL_SIZE% LSS 1000000 (
    echo ERROR: hand_model.glb is unexpectedly small. Re-extract the complete ZIP.
    pause
    exit /b 1
)

echo Local hand model and kinematics reference found.
echo V4 uses its own address: http://localhost:%PORT%
echo This avoids an older V3.3 server already running on port 8000.
echo Keep this window open while using the simulator.
echo.
start "" powershell -NoProfile -WindowStyle Hidden -Command "Start-Sleep -Seconds 2; Start-Process 'http://localhost:%PORT%'"

where py >nul 2>&1
if %errorlevel%==0 (
    py -m http.server %PORT% --bind 127.0.0.1
) else (
    python -m http.server %PORT% --bind 127.0.0.1
)
pause
endlocal
