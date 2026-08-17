<#
.SYNOPSIS
    Start FinAlly in Docker (Windows).

.DESCRIPTION
    Builds the image if it is missing, runs the container with the data volume
    and port mapping, waits for /api/health and prints the URL.

    Idempotent: running it again while the container is up is a no-op that just
    prints the URL.

.PARAMETER Build
    Rebuild the Docker image even if it already exists.

.PARAMETER NoBrowser
    Do not open the app in a browser once it is ready.

.EXAMPLE
    .\scripts\start_windows.ps1
    .\scripts\start_windows.ps1 -Build
#>
[CmdletBinding()]
param(
    [switch]$Build,
    [switch]$NoBrowser
)

# Deliberately not 'Stop': native commands such as docker write progress to
# stderr, which Windows PowerShell 5.1 turns into terminating errors under
# ErrorActionPreference = 'Stop'. Exit codes are checked explicitly instead.
$ErrorActionPreference = 'Continue'

$Image     = 'finally:latest'
$Container = 'finally'
$Volume    = 'finally-data'
$Port      = 8000
$Url       = "http://localhost:$Port"

$RepoRoot = Split-Path -Parent $PSScriptRoot

function Get-ContainerState {
    $state = & docker container inspect -f '{{.State.Status}}' $Container 2>$null
    if ($LASTEXITCODE -ne 0) { return $null }
    return ($state | Select-Object -First 1).Trim()
}

# --- preflight -------------------------------------------------------------

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
    Write-Host "Error: 'docker' was not found on your PATH." -ForegroundColor Red
    Write-Host ""
    Write-Host "FinAlly runs in a container. Install Docker Desktop from"
    Write-Host "  https://docs.docker.com/desktop/install/windows-install/"
    Write-Host "and run this script again."
    Write-Host ""
    Write-Host "To run without Docker instead:"
    Write-Host "  cd frontend; npm ci; npm run build"
    Write-Host "  Copy-Item -Recurse frontend\out backend\static"
    Write-Host "  cd backend; uv run uvicorn app.main:app --host 0.0.0.0 --port $Port"
    exit 1
}

& docker info 2>$null | Out-Null
if ($LASTEXITCODE -ne 0) {
    Write-Host "Error: Docker is installed but the daemon is not responding." -ForegroundColor Red
    Write-Host ""
    Write-Host "Start Docker Desktop, wait until the whale icon reports 'Engine running',"
    Write-Host "then run this script again."
    exit 1
}

Set-Location $RepoRoot

if (-not (Test-Path '.env')) {
    Write-Host "No .env found - creating one from .env.example."
    Write-Host "Edit it to add OPENROUTER_API_KEY if you want the AI chat panel."
    Copy-Item '.env.example' '.env'
}

# --- already running? ------------------------------------------------------

$state = Get-ContainerState

if ($state -eq 'running' -and -not $Build) {
    Write-Host "FinAlly is already running at $Url" -ForegroundColor Green
    exit 0
}

# Any other state (created/exited/paused, or a stale container from an older
# image) gets replaced so the run below always starts from a known state.
if ($state) {
    Write-Host "Removing existing '$Container' container (state: $state)..."
    & docker rm -f $Container 2>$null | Out-Null
    if ($LASTEXITCODE -ne 0) {
        Write-Host "Error: failed to remove the existing container." -ForegroundColor Red
        exit 1
    }
}

# --- build -----------------------------------------------------------------

& docker image inspect $Image 2>$null | Out-Null
$imageExists = ($LASTEXITCODE -eq 0)

if ($Build -or -not $imageExists) {
    Write-Host "Building $Image (first build takes a few minutes)..."
    & docker build -t $Image .
    if ($LASTEXITCODE -ne 0) {
        Write-Host "Error: docker build failed." -ForegroundColor Red
        exit 1
    }
} else {
    Write-Host "Using existing image $Image (pass -Build to rebuild)."
}

# --- run -------------------------------------------------------------------

Write-Host "Starting $Container..."
& docker run -d `
    --name $Container `
    --restart unless-stopped `
    -p "$($Port):8000" `
    --env-file .env `
    -v "$($Volume):/app/db" `
    $Image | Out-Null

if ($LASTEXITCODE -ne 0) {
    Write-Host "Error: docker run failed." -ForegroundColor Red
    exit 1
}

# --- wait for health -------------------------------------------------------

Write-Host -NoNewline "Waiting for the app to come up"
$ready = $false
foreach ($attempt in 1..60) {
    try {
        $response = Invoke-WebRequest -Uri "$Url/api/health" -UseBasicParsing -TimeoutSec 3
        if ($response.StatusCode -eq 200) { $ready = $true; break }
    } catch {
        # Not up yet - keep polling.
    }

    if ((Get-ContainerState) -ne 'running') {
        Write-Host ""
        Write-Host "Error: the container exited during startup. Logs:" -ForegroundColor Red
        & docker logs $Container
        exit 1
    }

    Write-Host -NoNewline "."
    Start-Sleep -Seconds 1
}
Write-Host ""

if (-not $ready) {
    Write-Host "Warning: no healthy response after 60s. Check 'docker logs $Container'." -ForegroundColor Yellow
}

Write-Host ""
Write-Host "FinAlly is running at $Url" -ForegroundColor Green
Write-Host "  logs:  docker logs -f $Container"
Write-Host "  stop:  .\scripts\stop_windows.ps1"

if (-not $NoBrowser) {
    Start-Process $Url | Out-Null
}
