@echo off
setlocal
cd /d "%~dp0"

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\clean-local.ps1" -Force
set "CLEAN_EXIT_CODE=%ERRORLEVEL%"

echo.
if not "%CLEAN_EXIT_CODE%"=="0" (
  echo Cleanup failed. Review the error above.
) else (
  echo Local cache and local D1 cleanup finished.
)

pause
exit /b %CLEAN_EXIT_CODE%
