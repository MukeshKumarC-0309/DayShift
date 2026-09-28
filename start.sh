#!/usr/bin/env bash
#
# Single-command launcher: backend + frontend, one terminal.
#
#   ./start.sh
#
# Creates the venv and installs dependencies on first run, starts FastAPI in
# the background, then runs the Vite dev server in the foreground. Ctrl-C
# stops both.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

VENV="$ROOT/.venv"
BACKEND_PORT=8000
FRONTEND_PORT=5173
BACKEND_LOG="$ROOT/backend.log"

c_dim=$'\033[2m'; c_red=$'\033[31m'; c_grn=$'\033[32m'; c_rst=$'\033[0m'
c_ok=$'\u2713'
say()  { printf '%s\n' "${c_dim}[start]${c_rst} $*"; }
fail() { printf '%s\n' "${c_red}[start]${c_rst} $*" >&2; exit 1; }

# --- Preflight ---------------------------------------------------------------

command -v node >/dev/null 2>&1 || fail "node is not installed."
command -v npm  >/dev/null 2>&1 || fail "npm is not installed."

# Prefer a modern interpreter; anything 3.11+ works.
PY=""
for candidate in python3.13 python3.12 python3.11 python3.14 python3; do
  if command -v "$candidate" >/dev/null 2>&1; then PY="$candidate"; break; fi
done
[ -n "$PY" ] || fail "No python3 interpreter found."

# .env is optional: credentials are set up in the app on first run, and every
# other setting has a default. Nothing to configure to get started.
if [ ! -f "$ROOT/.env" ]; then
  say "no .env found — using defaults (this is fine)"
fi

# --- Backend deps ------------------------------------------------------------

# Check for the interpreter, not just the folder: a half-restored or moved
# .venv can exist without a working Python in it.
if [ ! -x "$VENV/bin/python" ] || ! "$VENV/bin/python" -c 'import sys' >/dev/null 2>&1; then
  [ -d "$VENV" ] && say "the virtualenv (.venv) is broken — rebuilding it"
  rm -rf "$VENV"
  say "creating virtualenv (.venv) with $PY"
  "$PY" -m venv "$VENV"
fi

# Reinstall only when requirements.txt is newer than the last install stamp.
STAMP="$VENV/.deps-installed"
if [ ! -f "$STAMP" ] || [ "$ROOT/requirements.txt" -nt "$STAMP" ]; then
  say "installing backend dependencies"
  "$VENV/bin/pip" install --quiet --upgrade pip
  "$VENV/bin/pip" install --quiet -r "$ROOT/requirements.txt"
  touch "$STAMP"
fi

# --- Frontend deps -----------------------------------------------------------

# Vite itself, not just the folder: node_modules can be left half there.
if [ ! -x "$ROOT/frontend/node_modules/.bin/vite" ]; then
  say "installing frontend dependencies (first run, this takes a minute)"
  (cd "$ROOT/frontend" && npm install --no-fund --no-audit)
fi

# --- Port check --------------------------------------------------------------

if lsof -nP -iTCP:"$BACKEND_PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  fail "Port $BACKEND_PORT is already in use — another copy may still be running."
fi

# --- Launch ------------------------------------------------------------------

BACKEND_PID=""
cleanup() {
  if [ -n "$BACKEND_PID" ] && kill -0 "$BACKEND_PID" 2>/dev/null; then
    say "stopping backend"
    kill "$BACKEND_PID" 2>/dev/null || true
    wait "$BACKEND_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT INT TERM

say "starting backend on http://localhost:$BACKEND_PORT"
( cd "$ROOT/backend" && exec "$VENV/bin/uvicorn" app:app --port "$BACKEND_PORT" --reload ) \
  >"$BACKEND_LOG" 2>&1 &
BACKEND_PID=$!

# Wait for the health endpoint rather than sleeping a fixed interval.
for _ in $(seq 1 60); do
  if curl -sf "http://127.0.0.1:$BACKEND_PORT/api/health" >/dev/null 2>&1; then
    break
  fi
  if ! kill -0 "$BACKEND_PID" 2>/dev/null; then
    printf '%s\n' "${c_red}[start]${c_rst} backend exited during startup:" >&2
    tail -20 "$BACKEND_LOG" >&2
    exit 1
  fi
  sleep 0.5
done

curl -sf "http://127.0.0.1:$BACKEND_PORT/api/health" >/dev/null 2>&1 \
  || fail "Backend did not come up in 30s. See $BACKEND_LOG"

say "backend up ${c_grn}✓${c_rst}  (logs: backend.log)"
say "frontend starting — open ${c_grn}http://localhost:$FRONTEND_PORT${c_rst}"
if [ "${DAYSHIFT_SHARE:-}" = "1" ]; then
  # Set by `dayshift share`: the frontend listens on the network too.
  say "shared on your network — phone addresses: ${c_grn}dayshift share${c_rst}"
fi
echo

# Vite runs in the foreground: its output is what you watch, and Ctrl-C here
# tears down the backend too via the EXIT trap. Deliberately NOT `exec` —
# exec would replace this shell and discard the trap, orphaning uvicorn.
cd "$ROOT/frontend"
npm run dev -- --port "$FRONTEND_PORT" --strictPort
