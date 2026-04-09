#!/usr/bin/env bash
set -euo pipefail

# Simple launcher for the example app (backend FastAPI + frontend Vite)
# Requirements:
#  - Python 3 with uvicorn installed (see backend/requirements.txt)
#  - Node.js with npm (for frontend)
# The script installs frontend deps on first run. Backend uses system Python env.

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
BACKEND_DIR="$ROOT_DIR/backend"
FRONTEND_DIR="$ROOT_DIR/frontend"

start_backend() {
  cd "$BACKEND_DIR"
  if ! command -v uvicorn >/dev/null 2>&1; then
    echo "[backend] uvicorn not found; install dependencies first: pip install -r requirements.txt" >&2
    exit 1
  fi
  echo "[backend] Starting uvicorn on http://localhost:8000"
  uvicorn main:app --host 0.0.0.0 --port 8000 --reload
}

start_frontend() {
  cd "$FRONTEND_DIR"
  if [ ! -d node_modules ]; then
    echo "[frontend] Installing dependencies..."
    npm install
  fi
  echo "[frontend] Starting Vite dev server on http://localhost:5173"
  npm run dev -- --host 0.0.0.0 --port 5173
}

start_all() {
  cd "$ROOT_DIR"
  echo "Launching backend and frontend..."
  ( start_backend ) &
  BACK_PID=$!
  trap 'echo "Stopping backend..."; kill $BACK_PID 2>/dev/null || true' EXIT
  start_frontend
}

start_all
