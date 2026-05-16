#!/usr/bin/env bash
set -e

ROOT="$(cd "$(dirname "$0")" && pwd)"

echo "Starting CivicRAG backend..."
"$ROOT/.venv/bin/uvicorn" api.main:app --reload --port 8000 &
BACKEND_PID=$!

sleep 3

echo "Starting CivicRAG frontend..."
cd "$ROOT/frontend"
npm run dev &
FRONTEND_PID=$!

sleep 3

echo "Opening browser..."
xdg-open http://localhost:3000 2>/dev/null || open http://localhost:3000 2>/dev/null || true

echo ""
echo "  Backend  PID $BACKEND_PID: http://localhost:8000"
echo "  Frontend PID $FRONTEND_PID: http://localhost:3000"
echo ""
echo "Press Ctrl+C to stop both servers."

trap "echo 'Stopping...'; kill $BACKEND_PID $FRONTEND_PID 2>/dev/null; exit" INT TERM
wait
