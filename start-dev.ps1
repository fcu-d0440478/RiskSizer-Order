$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$backendDir = Join-Path $projectRoot "backend"
$frontendDir = Join-Path $projectRoot "frontend"
$venvActivate = Join-Path $backendDir ".venv\Scripts\Activate.ps1"

if (-not (Test-Path $backendDir)) {
  throw "Backend directory not found: $backendDir"
}

if (-not (Test-Path $frontendDir)) {
  throw "Frontend directory not found: $frontendDir"
}

if (-not (Test-Path $venvActivate)) {
  throw "Backend virtual environment not found: $venvActivate"
}

$backendCommand = @"
Set-Location '$backendDir'
& '$venvActivate'
uvicorn app.main:app --reload
"@

$frontendCommand = @"
Set-Location '$frontendDir'
python -m http.server 4173
"@

Start-Process powershell.exe -ArgumentList @(
  "-NoExit",
  "-ExecutionPolicy", "Bypass",
  "-Command", $backendCommand
)

Start-Process powershell.exe -ArgumentList @(
  "-NoExit",
  "-ExecutionPolicy", "Bypass",
  "-Command", $frontendCommand
)

Write-Host "Backend starting at http://127.0.0.1:8000"
Write-Host "Frontend starting at http://127.0.0.1:4173"
