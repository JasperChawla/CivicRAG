@echo off
echo Starting CivicRAG...
echo.

set ROOT=%~dp0

start "CivicRAG Backend" cmd /k "cd /d %ROOT% && .venv\Scripts\uvicorn.exe api.main:app --reload --port 8000"

timeout /t 4 /nobreak > nul

start "CivicRAG Frontend" cmd /k "cd /d %ROOT%frontend && npm run dev"

timeout /t 5 /nobreak > nul

start http://localhost:3000

echo Both servers started.
echo   Backend:  http://localhost:8000
echo   Frontend: http://localhost:3000
echo.
echo Close the two terminal windows to stop the servers.
