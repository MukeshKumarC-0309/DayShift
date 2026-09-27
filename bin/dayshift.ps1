# DAYSHIFT for Windows — the counterpart of bin/dayshift. Run it as `dayshift`
# (bin\dayshift.cmd) once the bin folder is on your PATH:
#   powershell -ExecutionPolicy Bypass -File scripts\install-command.ps1
#
#   dayshift            open it if it's running; otherwise start it, then open it
#   dayshift share      start it reachable from your phone; show the address + QR
#   dayshift share tailscale   the same, with the QR for away-from-home
#   dayshift open       open it in the browser (assumes it is running)
#   dayshift status     is it running, and where
#   dayshift stop       stop this app's backend and frontend
#   dayshift help       this text

param([string]$Command = '', [string]$Option = '')

$AppDir = Split-Path -Parent $PSScriptRoot
$BackendPort = 8000
$FrontendPort = 5173
$Url = "http://localhost:$FrontendPort"

function Test-Up([string]$Address) {
  try {
    return (Invoke-WebRequest -UseBasicParsing -TimeoutSec 2 $Address).StatusCode -eq 200
  } catch { return $false }
}
function Test-Backend { Test-Up "http://127.0.0.1:$BackendPort/api/health" }
function Test-Frontend { Test-Up $Url }

# True when the frontend listens on the network, not just this PC.
function Test-Shared {
  $listen = Get-NetTCPConnection -LocalPort $FrontendPort -State Listen -ErrorAction SilentlyContinue
  return [bool]($listen | Where-Object { $_.LocalAddress -in '0.0.0.0', '::' })
}

# Processes on our ports whose command line points into this app's folder,
# so `stop` never touches another program that happens to use the same port.
function Get-OurProcesses {
  $ids = Get-NetTCPConnection -LocalPort $BackendPort, $FrontendPort -State Listen -ErrorAction SilentlyContinue |
    Select-Object -ExpandProperty OwningProcess -Unique
  foreach ($id in $ids) {
    $proc = Get-CimInstance Win32_Process -Filter "ProcessId = $id" -ErrorAction SilentlyContinue
    $text = "$($proc.ExecutablePath) $($proc.CommandLine)"
    if ($proc -and $text -like "*$AppDir*") { $id }
  }
}

function Stop-Ours {
  $ids = @(Get-OurProcesses)
  foreach ($id in $ids) { & taskkill /PID $id /T /F *> $null }
  return $ids.Count -gt 0
}

function Open-Browser {
  Start-Process $Url
  Write-Host "Dayshift -> $Url"
}

# Starts start.ps1 in this window, after (optionally) opening the browser once
# the app answers.
function Start-Here([bool]$OpenWhenUp) {
  if ($OpenWhenUp) {
    Start-Job -ScriptBlock {
      param($u, $h)
      foreach ($i in 1..180) {
        try {
          if ((Invoke-WebRequest -UseBasicParsing -TimeoutSec 2 $u).StatusCode -eq 200 -and
              (Invoke-WebRequest -UseBasicParsing -TimeoutSec 2 $h).StatusCode -eq 200) {
            Start-Process $u; return
          }
        } catch {}
        Start-Sleep -Seconds 1
      }
    } -ArgumentList $Url, "http://127.0.0.1:$BackendPort/api/health" | Out-Null
  }
  & (Join-Path $AppDir 'scripts\start.ps1')
}

switch ($Command) {
  '' {
    if ((Test-Backend) -and (Test-Frontend)) { Write-Host 'Already running.'; Open-Browser; exit 0 }
    if ((Test-Backend) -or (Test-Frontend)) {
      Write-Host 'Half running (backend or frontend only). Run: dayshift stop, then dayshift'
      exit 1
    }
    Start-Here $true
  }
  'share' {
    if ((Test-Backend) -and (Test-Frontend) -and (Test-Shared)) {
      & node (Join-Path $AppDir 'scripts\share.mjs') $Option
      exit 0
    }
    if ((Test-Backend) -or (Test-Frontend)) {
      Write-Host 'Running for this PC only - restarting it shared...'
      Stop-Ours | Out-Null
      Start-Sleep -Seconds 2
    }
    $env:DAYSHIFT_SHARE = '1'
    $env:DAYSHIFT_QR = $Option
    Start-Here $false
  }
  'open' {
    if (Test-Frontend) { Open-Browser } else { Write-Host 'Not running - start it with: dayshift'; exit 1 }
  }
  'status' {
    Write-Host "App folder: $AppDir"
    if (Test-Backend) { Write-Host "Backend:  running on :$BackendPort" } else { Write-Host 'Backend:  stopped' }
    if (Test-Frontend) {
      if (Test-Shared) { Write-Host "Frontend: running -> $Url, shared on your network (dayshift share for the address)" }
      else { Write-Host "Frontend: running -> $Url, this PC only" }
    } else { Write-Host 'Frontend: stopped' }
  }
  'stop' {
    if (Stop-Ours) { Write-Host 'Stopped.' } else { Write-Host "Nothing of Dayshift's is running." }
  }
  { $_ -in 'help', '-h', '--help' } {
    Get-Content $PSCommandPath | Select-Object -Skip 4 -First 8 | ForEach-Object { $_ -replace '^# ?', '' }
  }
  default { Write-Host "Unknown command: $Command (try: dayshift help)"; exit 2 }
}
