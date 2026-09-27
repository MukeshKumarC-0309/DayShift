# Single-command launcher for Windows — the counterpart of ./start.sh.
#
#   start.cmd              (from Command Prompt, or double-click it)
#
# Creates the venv and installs dependencies on first run, starts FastAPI in
# the background, then runs the Vite dev server in this window. Ctrl-C stops
# both. Set DAYSHIFT_SHARE=1 (or run `dayshift share`) to reach it from your
# phone; the backend always stays on 127.0.0.1.

$ErrorActionPreference = 'Stop'

$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root

$Venv = Join-Path $Root '.venv'
$BackendPort = 8000
$FrontendPort = 5173
$BackendLog = Join-Path $Root 'backend.log'
$BackendErrLog = Join-Path $Root 'backend.err.log'

function Say([string]$Text) { Write-Host "[start] $Text" -ForegroundColor DarkGray }
function Fail([string]$Text) { Write-Host "[start] $Text" -ForegroundColor Red; exit 1 }

# --- Preflight ---------------------------------------------------------------

if (-not (Get-Command node -ErrorAction SilentlyContinue)) { Fail 'node is not installed (https://nodejs.org).' }
if (-not (Get-Command npm -ErrorAction SilentlyContinue)) { Fail 'npm is not installed.' }

# Prefer a modern interpreter; anything 3.11+ works. The `py` launcher knows
# every installed version; plain `python` is the fallback.
$PyExe = $null
$PyArgs = @()
if (Get-Command py -ErrorAction SilentlyContinue) {
  foreach ($v in '3.13', '3.12', '3.11', '3.14') {
    & py "-$v" -c 'import sys' 2>$null
    if ($LASTEXITCODE -eq 0) { $PyExe = 'py'; $PyArgs = @("-$v"); break }
  }
}
if (-not $PyExe -and (Get-Command python -ErrorAction SilentlyContinue)) {
  & python -c 'import sys; sys.exit(0 if sys.version_info >= (3, 11) else 1)' 2>$null
  if ($LASTEXITCODE -eq 0) { $PyExe = 'python' }
}
if (-not $PyExe) { Fail 'No Python 3.11+ found (https://www.python.org/downloads/).' }

# .env is optional: credentials are set up in the app on first run.
if (-not (Test-Path (Join-Path $Root '.env'))) { Say 'no .env found — using defaults (this is fine)' }

# --- Backend deps ------------------------------------------------------------

$VenvPython = Join-Path $Venv 'Scripts\python.exe'
if (-not (Test-Path $VenvPython)) {
  Say "creating virtualenv (.venv) with $PyExe $($PyArgs -join ' ')"
  & $PyExe @PyArgs -m venv $Venv
  if ($LASTEXITCODE -ne 0) { Fail 'Could not create the virtualenv.' }
}

# Reinstall only when requirements.txt is newer than the last install stamp.
$Stamp = Join-Path $Venv '.deps-installed'
$Requirements = Join-Path $Root 'requirements.txt'
if (-not (Test-Path $Stamp) -or (Get-Item $Requirements).LastWriteTime -gt (Get-Item $Stamp).LastWriteTime) {
  Say 'installing backend dependencies'
  & $VenvPython -m pip install --quiet --upgrade pip
  & $VenvPython -m pip install --quiet -r $Requirements
  if ($LASTEXITCODE -ne 0) { Fail 'Installing backend dependencies failed.' }
  Set-Content -Path $Stamp -Value (Get-Date -Format o)
}

# --- Frontend deps -----------------------------------------------------------

if (-not (Test-Path (Join-Path $Root 'frontend\node_modules'))) {
  Say 'installing frontend dependencies (first run, this takes a minute)'
  Push-Location (Join-Path $Root 'frontend')
  & npm install --no-fund --no-audit
  $ok = $LASTEXITCODE -eq 0
  Pop-Location
  if (-not $ok) { Fail 'Installing frontend dependencies failed.' }
}

# --- Port check --------------------------------------------------------------

if (Get-NetTCPConnection -LocalPort $BackendPort -State Listen -ErrorAction SilentlyContinue) {
  Fail "Port $BackendPort is already in use — another copy may still be running (dayshift stop)."
}

# --- Launch ------------------------------------------------------------------

function Test-Health {
  try {
    $r = Invoke-WebRequest -UseBasicParsing -TimeoutSec 2 "http://127.0.0.1:$BackendPort/api/health"
    return $r.StatusCode -eq 200
  } catch { return $false }
}

Say "starting backend on http://localhost:$BackendPort"
$Backend = Start-Process -FilePath $VenvPython `
  -ArgumentList '-m', 'uvicorn', 'app:app', '--port', "$BackendPort", '--reload' `
  -WorkingDirectory (Join-Path $Root 'backend') `
  -RedirectStandardOutput $BackendLog -RedirectStandardError $BackendErrLog `
  -NoNewWindow -PassThru

try {
  # Wait for the health endpoint rather than sleeping a fixed interval.
  $up = $false
  foreach ($i in 1..60) {
    if (Test-Health) { $up = $true; break }
    if ($Backend.HasExited) {
      Write-Host '[start] backend exited during startup:' -ForegroundColor Red
      Get-Content $BackendErrLog -Tail 20
      exit 1
    }
    Start-Sleep -Milliseconds 500
  }
  if (-not $up) { Fail "Backend did not come up in 30s. See $BackendErrLog" }

  Say 'backend up  (logs: backend.log, backend.err.log)'
  Say "frontend starting — open http://localhost:$FrontendPort"
  if ($env:DAYSHIFT_SHARE -eq '1') {
    Say 'shared on your network — phone addresses:'
    & node (Join-Path $Root 'scripts\share.mjs') $env:DAYSHIFT_QR
  }
  Write-Host ''

  # Vite runs in this window: its output is what you watch.
  Push-Location (Join-Path $Root 'frontend')
  & npm run dev -- --port $FrontendPort --strictPort
  Pop-Location
} finally {
  # Ctrl-C (or Vite exiting) lands here. `uvicorn --reload` runs the server in
  # a child process, so stop the whole tree, not just the parent.
  if ($Backend -and -not $Backend.HasExited) {
    Say 'stopping backend'
    & taskkill /PID $Backend.Id /T /F *> $null
  }
}
