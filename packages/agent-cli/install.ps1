# Installs three-ws-agent on Windows from a checkout of the three.ws repository.
#
#   powershell -ExecutionPolicy Bypass -File packages\agent-cli\install.ps1
#
# Checks for Node.js 22.13 or newer (node:sqlite ships unflagged from there),
# packs this package and installs it globally with npm (which puts the
# `three-ws-agent` command on PATH), and runs `three-ws-agent doctor`.

$ErrorActionPreference = 'Stop'
$PackageDir = $PSScriptRoot

$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) {
    Write-Host 'Node.js was not found. Install Node.js 22.13 or newer from https://nodejs.org (or: winget install OpenJS.NodeJS.LTS), then run this script again.' -ForegroundColor Red
    exit 1
}

$raw = (& node --version).Trim().TrimStart('v')
$parts = $raw.Split('.')
$major = [int]$parts[0]
$minor = [int]$parts[1]
if ($major -lt 22 -or ($major -eq 22 -and $minor -lt 13)) {
    Write-Host "Node.js $raw is too old: three-ws-agent needs 22.13 or newer. Update it (winget upgrade OpenJS.NodeJS.LTS) and run this script again." -ForegroundColor Red
    exit 1
}
Write-Host "Node.js $raw found."

# Pack this directory and install the tarball globally: npm resolves the
# dependencies from the registry, so this works the same inside or outside the
# monorepo's workspace.
$tmp = Join-Path ([System.IO.Path]::GetTempPath()) "three-ws-agent-$PID"
New-Item -ItemType Directory -Force -Path $tmp | Out-Null
Push-Location $PackageDir
try {
    Write-Host 'Packing @three-ws/agent...'
    $tgz = (& npm pack --pack-destination $tmp --silent | Select-Object -Last 1).Trim()
    if ($LASTEXITCODE -ne 0) { throw "npm pack failed with exit code $LASTEXITCODE" }

    Write-Host 'Installing the three-ws-agent command...'
    & npm install --global --no-audit --no-fund (Join-Path $tmp $tgz)
    if ($LASTEXITCODE -ne 0) { throw "npm install failed with exit code $LASTEXITCODE" }
}
finally {
    Pop-Location
    Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue
}

$cmd = Get-Command three-ws-agent -ErrorAction SilentlyContinue
if (-not $cmd) {
    $prefix = (& npm prefix -g).Trim()
    Write-Host "Installed, but $prefix is not on PATH. Add it to PATH, open a new terminal, and run: three-ws-agent doctor" -ForegroundColor Yellow
    exit 0
}

& three-ws-agent doctor
Write-Host ''
Write-Host 'Done. Sign in with `three-ws-agent login`, or point it at your own model with THREE_WS_AGENT_BASE_URL and THREE_WS_AGENT_MODEL, then run `three-ws-agent`.'
