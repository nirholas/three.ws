# Startup script for the short-lived Windows VM created by
# scripts/verify-winget-on-gce.mjs. Runs as SYSTEM on first boot, installs the
# ThreeWs.Agent winget manifests handed over in instance metadata, exercises the
# installed three-ws-agent, and reports every step on serial port 1 as lines
# shaped "THREEWS|<kind>|<step>|<text>", which the driver reads back.
#
# Metadata in:
#   winget-manifests   JSON object { "<file name>": "<yaml text>" }
#   three-ws-api-key   optional short-lived key for the production checks
#   three-ws-origin    optional, defaults to https://three.ws

$ErrorActionPreference = 'Continue'
$ProgressPreference = 'SilentlyContinue'
$script:failed = @()

function Say([string]$kind, [string]$step, [string]$text) {
	foreach ($line in ($text -split "`r?`n")) {
		if ($line.Trim().Length -eq 0) { continue }
		Write-Output "THREEWS|$kind|$step|$line"
	}
}

function Meta([string]$key) {
	try {
		$r = Invoke-WebRequest -UseBasicParsing -Headers @{ 'Metadata-Flavor' = 'Google' } -Uri "http://metadata.google.internal/computeMetadata/v1/instance/attributes/$key"
		return [string]$r.Content
	} catch {
		return $null
	}
}

# Run a native command, stream its output, record the exit code.
function Run([string]$step, [string]$exe, [string[]]$argv, [switch]$Optional) {
	Say 'RUN' $step ("$exe " + ($argv -join ' '))
	$out = & $exe @argv 2>&1 | Out-String
	$code = $LASTEXITCODE
	Say 'OUT' $step $out
	Say 'EXIT' $step "$code"
	if ($code -ne 0 -and -not $Optional) { $script:failed += $step }
	return $code
}

function Refresh-Path {
	$env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User')
}

function Newest-AppxDir([string]$pattern) {
	Get-ChildItem "$env:ProgramFiles\WindowsApps" -Directory -Filter $pattern -ErrorAction SilentlyContinue |
		Sort-Object { try { [version](($_.Name -split '_')[1]) } catch { [version]'0.0' } } -Descending |
		Select-Object -First 1
}

# winget.exe from the provisioned App Installer package. Under SYSTEM there is no
# per-user app execution alias, so call the exe inside the package directly and
# put its VCLibs runtime on PATH.
function Find-Winget {
	$cmd = Get-Command winget.exe -ErrorAction SilentlyContinue
	if ($cmd) { return $cmd.Source }
	$dir = Newest-AppxDir 'Microsoft.DesktopAppInstaller_*_x64__8wekyb3d8bbwe'
	if ($dir -and (Test-Path (Join-Path $dir.FullName 'winget.exe'))) {
		$vclibs = Newest-AppxDir 'Microsoft.VCLibs.140.00.UWPDesktop_*_x64__8wekyb3d8bbwe'
		if ($vclibs) { $env:Path = $vclibs.FullName + ';' + $env:Path }
		return (Join-Path $dir.FullName 'winget.exe')
	}
	return $null
}

Say 'INFO' 'os' ((Get-CimInstance Win32_OperatingSystem | Select-Object Caption, Version, OSArchitecture | Format-List | Out-String))

# 1. winget itself.
$winget = Find-Winget
if (-not $winget) {
	Say 'INFO' 'winget' 'winget not present; installing App Installer with Microsoft.WinGet.Client'
	try {
		[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
		Install-PackageProvider -Name NuGet -MinimumVersion 2.8.5.201 -Force -Scope AllUsers | Out-Null
		Set-PSRepository -Name PSGallery -InstallationPolicy Trusted
		Install-Module -Name Microsoft.WinGet.Client -Force -Scope AllUsers -Repository PSGallery | Out-Null
		Import-Module Microsoft.WinGet.Client
		Repair-WinGetPackageManager -AllUsers -Latest -Force | Out-String | ForEach-Object { Say 'OUT' 'winget-install' $_ }
	} catch {
		Say 'OUT' 'winget-install' ("Microsoft.WinGet.Client route failed: " + $_.Exception.Message)
	}
	$winget = Find-Winget
}
if (-not $winget) {
	Say 'INFO' 'winget' 'installing App Installer and its dependencies from their release packages'
	$tmp = Join-Path $env:TEMP 'winget-bootstrap'
	New-Item -ItemType Directory -Force -Path $tmp | Out-Null
	try {
		Invoke-WebRequest -UseBasicParsing -Uri 'https://aka.ms/Microsoft.VCLibs.x64.14.00.Desktop.appx' -OutFile "$tmp\vclibs.appx"
		Invoke-WebRequest -UseBasicParsing -Uri 'https://github.com/microsoft/microsoft-ui-xaml/releases/download/v2.8.6/Microsoft.UI.Xaml.2.8.x64.appx' -OutFile "$tmp\xaml.appx"
		Invoke-WebRequest -UseBasicParsing -Uri 'https://aka.ms/getwinget' -OutFile "$tmp\appinstaller.msixbundle"
		Add-AppxProvisionedPackage -Online -PackagePath "$tmp\appinstaller.msixbundle" -DependencyPackagePath "$tmp\vclibs.appx", "$tmp\xaml.appx" -SkipLicense | Out-String | ForEach-Object { Say 'OUT' 'winget-install' $_ }
	} catch {
		Say 'OUT' 'winget-install' ("release package route failed: " + $_.Exception.Message)
	}
	$winget = Find-Winget
}
if (-not $winget) {
	Say 'EXIT' 'winget' '1'
	$script:failed += 'winget'
	Say 'DONE' 'summary' ('failed: ' + ($script:failed -join ','))
	exit 1
}
Say 'INFO' 'winget' "using $winget"
Run 'winget-version' $winget @('--version') | Out-Null

# 2. The manifests under test.
$dir = 'C:\threews-winget\manifest'
New-Item -ItemType Directory -Force -Path $dir | Out-Null
$manifests = (Meta 'winget-manifests') | ConvertFrom-Json
$utf8 = New-Object System.Text.UTF8Encoding $false
foreach ($p in $manifests.PSObject.Properties) {
	[IO.File]::WriteAllText((Join-Path $dir $p.Name), [string]$p.Value, $utf8)
	Say 'INFO' 'manifest' "wrote $($p.Name)"
}

Run 'settings-local-manifests' $winget @('settings', '--enable', 'LocalManifestFiles') | Out-Null
Run 'validate' $winget @('validate', '--manifest', $dir, '--disable-interactivity') | Out-Null
Run 'install' $winget @('install', '--manifest', $dir, '--scope', 'machine', '--accept-package-agreements', '--accept-source-agreements', '--disable-interactivity') | Out-Null

# 3. The installed command, through PATH exactly as a user would get it.
Refresh-Path
$cmd = Get-Command three-ws-agent -ErrorAction SilentlyContinue
if (-not $cmd) {
	Say 'EXIT' 'on-path' '1'
	$script:failed += 'on-path'
} else {
	Say 'INFO' 'on-path' "three-ws-agent resolves to $($cmd.Source)"
	Say 'EXIT' 'on-path' '0'
	$target = (Get-Item $cmd.Source).Target
	if ($target) { Say 'INFO' 'on-path' "link target $target" }
	$exe = if ($target) { [string]$target } else { $cmd.Source }
	$sig = Get-AuthenticodeSignature -FilePath $exe
	Say 'INFO' 'signature' "Authenticode status: $($sig.Status)"

	$home3 = 'C:\threews-winget\home'
	New-Item -ItemType Directory -Force -Path $home3 | Out-Null
	$env:USERPROFILE = $home3
	$env:APPDATA = "$home3\AppData\Roaming"
	$env:LOCALAPPDATA = "$home3\AppData\Local"
	$env:NO_COLOR = '1'
	$origin = Meta 'three-ws-origin'
	if ($origin) { $env:THREE_WS_ORIGIN = $origin }

	Run 'version' 'three-ws-agent' @('--version') | Out-Null
	Run 'help' 'three-ws-agent' @('--help') | Out-Null
	Run 'sessions' 'three-ws-agent' @('sessions') | Out-Null

	$key = Meta 'three-ws-api-key'
	if ($key) {
		$env:THREE_WS_API_KEY = $key.Trim()
		Run 'whoami' 'three-ws-agent' @('whoami') | Out-Null
		Run 'doctor' 'three-ws-agent' @('doctor') | Out-Null
		Remove-Item Env:\THREE_WS_API_KEY
	} else {
		Say 'INFO' 'whoami' 'no API key in metadata; production checks skipped'
	}
}

$threats = Get-MpThreatDetection -ErrorAction SilentlyContinue
Say 'INFO' 'defender' ("Defender detections: " + @($threats).Count)

Run 'uninstall' $winget @('uninstall', '--manifest', $dir, '--scope', 'machine', '--disable-interactivity') | Out-Null
Refresh-Path
if (Get-Command three-ws-agent -ErrorAction SilentlyContinue) {
	Say 'EXIT' 'removed' '1'
	$script:failed += 'removed'
} else {
	Say 'INFO' 'removed' 'three-ws-agent is no longer on PATH'
	Say 'EXIT' 'removed' '0'
}

if ($script:failed.Count -eq 0) { Say 'DONE' 'summary' 'ok' } else { Say 'DONE' 'summary' ('failed: ' + ($script:failed -join ',')) }
