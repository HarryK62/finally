<#
.SYNOPSIS
    Stop FinAlly (Windows).

.DESCRIPTION
    Stops and removes the 'finally' container. Idempotent: safe to run when the
    container is already stopped or was never created.

    The 'finally-data' volume is never touched, so your portfolio, trades and
    chat history survive. To delete the data too, run explicitly:
        docker volume rm finally-data

.EXAMPLE
    .\scripts\stop_windows.ps1
#>
[CmdletBinding()]
param()

# See start_windows.ps1: native stderr must not be treated as terminating.
$ErrorActionPreference = 'Continue'

$Container = 'finally'
$Volume    = 'finally-data'

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
    Write-Host "Error: 'docker' was not found on your PATH - nothing to stop." -ForegroundColor Red
    Write-Host "Install Docker Desktop from https://docs.docker.com/desktop/install/windows-install/"
    Write-Host "if you expected a container here."
    exit 1
}

& docker info 2>$null | Out-Null
if ($LASTEXITCODE -ne 0) {
    Write-Host "Error: Docker is installed but the daemon is not responding." -ForegroundColor Red
    Write-Host "Start Docker Desktop, then run this script again."
    exit 1
}

$state = & docker container inspect -f '{{.State.Status}}' $Container 2>$null
if ($LASTEXITCODE -ne 0) {
    $state = $null
} else {
    $state = ($state | Select-Object -First 1).Trim()
}

if (-not $state) {
    Write-Host "No '$Container' container exists - nothing to do."
} else {
    if ($state -eq 'running') {
        Write-Host "Stopping $Container..."
        & docker stop $Container 2>$null | Out-Null
        if ($LASTEXITCODE -ne 0) {
            Write-Host "Error: docker stop failed." -ForegroundColor Red
            exit 1
        }
    } else {
        Write-Host "Container '$Container' is not running (state: $state)."
    }

    & docker rm $Container 2>$null | Out-Null
    if ($LASTEXITCODE -ne 0) {
        Write-Host "Error: docker rm failed." -ForegroundColor Red
        exit 1
    }
    Write-Host "Removed container '$Container'."
}

Write-Host "Data volume '$Volume' left intact. Run .\scripts\start_windows.ps1 to resume."
