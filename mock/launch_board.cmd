@echo off
setlocal
set PORT=5172
set URL=http://localhost:%PORT%/index.html
echo Launching Edge in kiosk mode: %URL%
start "" msedge --kiosk "%URL%" --edge-kiosk-type=fullscreen
endlocal
