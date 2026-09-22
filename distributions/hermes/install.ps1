# three-ws-agent installer for Windows: Hermes Agent with three.ws built in.
#
#   irm https://three.ws/install/hermes.ps1 | iex
#
# three-ws-agent is a downstream distribution of Hermes Agent (Nous Research,
# MIT). Upstream code is unchanged; the distribution adds the three.ws plugin.
# This script clones the distribution, runs Hermes' own unmodified installer
# against it (so `hermes update` keeps tracking the distribution), and finishes
# with `hermes three-ws setup`.
#
# Set $env:THREE_WS_AGENT_CONVERT = "1" to switch an existing stock Hermes
# checkout to three-ws-agent. Set $env:THREE_WS_SKIP_SETUP = "1" to skip the
# final setup step.

$ErrorActionPreference = "Stop"

$Repo = if ($env:THREE_WS_AGENT_REPO) { $env:THREE_WS_AGENT_REPO } else { "https://github.com/nirholas/three-ws-agent.git" }
$Branch = if ($env:THREE_WS_AGENT_BRANCH) { $env:THREE_WS_AGENT_BRANCH } else { "main" }
$HermesHome = if ($env:HERMES_HOME) { $env:HERMES_HOME } else { "$env:LOCALAPPDATA\hermes" }
$InstallDir = if ($env:HERMES_INSTALL_DIR) { $env:HERMES_INSTALL_DIR } else { "$HermesHome\hermes-agent" }

function Normalize([string]$Url) {
    return ($Url -replace '^git@github.com:', 'https://github.com/' -replace '\.git$', '' -replace '/$', '')
}

if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
    throw "git is required. Install it with: winget install --id Git.Git -e, then open a new terminal and rerun."
}

if (Test-Path "$InstallDir\.git") {
    $origin = (git -C $InstallDir remote get-url origin 2>$null)
    if ((Normalize $origin) -ne (Normalize $Repo)) {
        if ($env:THREE_WS_AGENT_CONVERT -ne "1") {
            Write-Host "An existing Hermes install lives at $InstallDir (origin: $origin)."
            Write-Host ""
            Write-Host "Keep it and add three.ws as a plugin:"
            Write-Host "  hermes plugins install nirholas/three-ws-agent/plugins/three-ws; hermes plugins enable three-ws; hermes three-ws setup"
            Write-Host ""
            Write-Host "Or switch that install to three-ws-agent (config, memories and sessions are kept):"
            Write-Host '  $env:THREE_WS_AGENT_CONVERT = "1"; irm https://three.ws/install/hermes.ps1 | iex'
            exit 1
        }
        Write-Host "==> Switching $InstallDir to three-ws-agent"
        git -C $InstallDir remote set-url origin $Repo
    }
} else {
    Write-Host "==> Cloning three-ws-agent into $InstallDir"
    New-Item -ItemType Directory -Force -Path (Split-Path $InstallDir) | Out-Null
    git clone --depth 1 --single-branch --branch $Branch $Repo $InstallDir
    if ($LASTEXITCODE -ne 0) { throw "git clone of $Repo failed." }
}

Write-Host "==> Running the Hermes Agent installer from the distribution"
& "$InstallDir\scripts\install.ps1" -InstallDir $InstallDir -HermesHome $HermesHome -Branch $Branch

$HermesBin = "$InstallDir\venv\Scripts\hermes.exe"
if (-not (Test-Path $HermesBin)) {
    $found = Get-Command hermes -ErrorAction SilentlyContinue
    if (-not $found) { throw "Hermes installed but hermes.exe was not found. Open a new terminal and run: hermes plugins enable three-ws; hermes three-ws setup" }
    $HermesBin = $found.Source
}

$env:HERMES_HOME = $HermesHome
Write-Host "==> Enabling the three.ws plugin"
& $HermesBin plugins enable three-ws

if ($env:THREE_WS_SKIP_SETUP -ne "1") {
    Write-Host "==> Connecting three.ws"
    & $HermesBin three-ws setup
}

Write-Host ""
Write-Host "three-ws-agent is installed. Open a new terminal, then:"
Write-Host "  hermes                    start a chat"
Write-Host "  hermes three-ws status    check the three.ws connection"
Write-Host "  hermes update             pull the latest three-ws-agent (tracks Hermes upstream)"
