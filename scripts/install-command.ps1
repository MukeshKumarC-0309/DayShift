# Windows: put `dayshift` on your PATH by adding this app's bin folder to the
# user PATH (the counterpart of `make install-command` on a Mac). Run once:
#   powershell -ExecutionPolicy Bypass -File scripts\install-command.ps1
# Open a new Command Prompt afterwards. Undo: remove the folder from
# System Settings -> Environment Variables -> Path.

$Bin = Join-Path (Split-Path -Parent $PSScriptRoot) 'bin'
$current = [Environment]::GetEnvironmentVariable('Path', 'User')
$parts = @($current -split ';' | Where-Object { $_ })
if ($parts -contains $Bin) {
  Write-Host "Already on your PATH: $Bin"
} else {
  [Environment]::SetEnvironmentVariable('Path', (($parts + $Bin) -join ';'), 'User')
  Write-Host "Added to your PATH: $Bin"
  Write-Host "Open a new Command Prompt and type: dayshift"
}
