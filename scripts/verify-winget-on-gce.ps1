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
		# Straight to stdout, so callers piping or discarding a function's output never swallow a report line.
		[Console]::Out.WriteLine("THREEWS|$kind|$step|$line")
	}
}

function Meta([string]$key) {
	try {
		# WebClient returns text; Invoke-WebRequest under PowerShell 5.1 hands back bytes for non-text content types.
		$wc = New-Object System.Net.WebClient
		$wc.Headers.Add('Metadata-Flavor', 'Google')
		$wc.Encoding = [System.Text.Encoding]::UTF8
		return $wc.DownloadString("http://metadata.google.internal/computeMetadata/v1/instance/attributes/$key")
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

# Reload PATH from the registry (to see what winget registered), keeping the
# VCLibs runtime winget.exe itself needs under SYSTEM.
$script:runtimePath = ''
function Refresh-Path {
	$env:Path = $script:runtimePath + [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User')
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
	$dir = Newest-AppxDir 'Microsoft.DesktopAppInstaller_*_x64__8wekyb3d8bbwe'
	if ($dir -and (Test-Path (Join-Path $dir.FullName 'winget.exe'))) {
		$vclibs = Newest-AppxDir 'Microsoft.VCLibs.140.00.UWPDesktop_*_x64__8wekyb3d8bbwe'
		if ($vclibs) {
			$script:runtimePath = $vclibs.FullName + ';'
			$env:Path = $script:runtimePath + $env:Path
		}
		return (Join-Path $dir.FullName 'winget.exe')
	}
	$cmd = Get-Command winget.exe -ErrorAction SilentlyContinue
	if ($cmd) { return $cmd.Source }
	return $null
}

Say 'INFO' 'os' ((Get-CimInstance Win32_OperatingSystem | Select-Object Caption, Version, OSArchitecture | Format-List | Out-String))

# 1. winget itself, at least the client version that reads the manifest schema
# under test. Desktop Windows keeps App Installer current through the Store;
# Server images ship whatever was current when they were built, so upgrade it
# here the way a maintained machine already has: provision the latest App
# Installer bundle with its dependencies. (Microsoft.WinGet.Client's
# Repair-WinGetPackageManager refuses to run under Windows PowerShell 5.1,
# which is what a startup script gets.)
$minWinget = [version]'1.28.0'

function Winget-Version([string]$exe) {
	if (-not $exe) { return $null }
	$v = (& $exe --version 2>$null | Out-String).Trim().TrimStart('v')
	try { return [version]($v -replace '[^0-9.].*$', '') } catch { return $null }
}

$winget = Find-Winget
$have = Winget-Version $winget
Say 'INFO' 'winget' ("found: " + $(if ($winget) { "$winget ($have)" } else { 'none' }))
if (-not $have -or $have -lt $minWinget) {
	Say 'INFO' 'winget' 'installing the latest App Installer and its dependencies from their release packages'
	$tmp = Join-Path $env:TEMP 'winget-bootstrap'
	New-Item -ItemType Directory -Force -Path $tmp | Out-Null
	try {
		Invoke-WebRequest -UseBasicParsing -Uri 'https://aka.ms/Microsoft.VCLibs.x64.14.00.Desktop.appx' -OutFile "$tmp\vclibs.appx"
		Invoke-WebRequest -UseBasicParsing -Uri 'https://github.com/microsoft/microsoft-ui-xaml/releases/download/v2.8.6/Microsoft.UI.Xaml.2.8.x64.appx' -OutFile "$tmp\xaml.appx"
		Invoke-WebRequest -UseBasicParsing -Uri 'https://aka.ms/getwinget' -OutFile "$tmp\appinstaller.msixbundle"
		Say 'OUT' 'winget-install' (Add-AppxProvisionedPackage -Online -PackagePath "$tmp\appinstaller.msixbundle" -DependencyPackagePath "$tmp\vclibs.appx", "$tmp\xaml.appx" -SkipLicense | Out-String)
	} catch {
		Say 'OUT' 'winget-install' ("release package route failed: " + $_.Exception.Message)
	}
	$winget = Find-Winget
	$have = Winget-Version $winget
}
if (-not $have -or $have -lt $minWinget) {
	Say 'INFO' 'winget' ("could not get winget $minWinget or newer; have " + $(if ($have) { $have } else { 'none' }))
	Say 'EXIT' 'winget' '1'
	$script:failed += 'winget'
	Say 'DONE' 'summary' ('failed: ' + ($script:failed -join ','))
	exit 1
}
Say 'INFO' 'winget' "using $winget ($have)"
Say 'EXIT' 'winget' '0'

# 2. The manifests under test.
$dir = 'C:\threews-winget\manifest'
New-Item -ItemType Directory -Force -Path $dir | Out-Null
$manifests = (Meta 'winget-manifests') | ConvertFrom-Json
$utf8 = New-Object System.Text.UTF8Encoding $false
foreach ($p in $manifests.PSObject.Properties) {
	[IO.File]::WriteAllText((Join-Path $dir $p.Name), [string]$p.Value, $utf8)
	Say 'INFO' 'manifest' "wrote $($p.Name)"
}

$null = Run 'settings-local-manifests' $winget @('settings', '--enable', 'LocalManifestFiles')
$null = Run 'validate' $winget @('validate', '--manifest', $dir, '--disable-interactivity')
$installArgs = @('install', '--manifest', $dir, '--scope', 'machine', '--accept-package-agreements', '--accept-source-agreements', '--disable-interactivity')
$code = Run 'install-shellapi' $winget $installArgs -Optional
if ($code -ne 0) {
	# winget's default extractor is the Windows Shell zip API, which fails under
	# SYSTEM with no interactive desktop. Show the archive itself is sound, then
	# use winget's documented tar extraction method, as unattended installs do.
	$installer = [regex]::Match([IO.File]::ReadAllText((Join-Path $dir 'ThreeWs.Agent.installer.yaml')), 'Architecture: x64\s+InstallerUrl: (\S+)').Groups[1].Value
	$zip = 'C:\threews-winget\x64.zip'
	(New-Object System.Net.WebClient).DownloadFile($installer, $zip)
	Say 'INFO' 'archive' ("downloaded $installer, sha256 " + (Get-FileHash $zip -Algorithm SHA256).Hash)
	$null = Run 'archive-tar-list' "$env:SystemRoot\System32\tar.exe" @('-tvf', $zip)
	try {
		Expand-Archive -Path $zip -DestinationPath 'C:\threews-winget\expanded' -Force
		Say 'INFO' 'archive' ('Expand-Archive: ' + ((Get-ChildItem 'C:\threews-winget\expanded' | ForEach-Object { "$($_.Name) $($_.Length)" }) -join ', '))
		Say 'EXIT' 'archive-expand' '0'
	} catch {
		Say 'INFO' 'archive' ('Expand-Archive failed: ' + $_.Exception.Message)
		Say 'EXIT' 'archive-expand' '1'
		$script:failed += 'archive-expand'
	}
	$export = (& $winget settings export 2>$null | Out-String) | ConvertFrom-Json
	$settingsFile = [Environment]::ExpandEnvironmentVariables([string]$export.userSettingsFile)
	New-Item -ItemType Directory -Force -Path (Split-Path $settingsFile) | Out-Null
	[IO.File]::WriteAllText($settingsFile, '{ "installBehavior": { "archiveExtractionMethod": "tar" } }', $utf8)
	Say 'INFO' 'install' "set installBehavior.archiveExtractionMethod = tar in $settingsFile"
	$null = Run 'install' $winget $installArgs
} else {
	Say 'EXIT' 'install' '0'
}

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

	$null = Run 'version' 'three-ws-agent' @('--version')
	$null = Run 'help' 'three-ws-agent' @('--help')
	$null = Run 'sessions' 'three-ws-agent' @('sessions')

	$key = Meta 'three-ws-api-key'
	if ($key) {
		$env:THREE_WS_API_KEY = $key.Trim()
		$null = Run 'whoami' 'three-ws-agent' @('whoami')
		$null = Run 'doctor' 'three-ws-agent' @('doctor')
		Remove-Item Env:\THREE_WS_API_KEY
	} else {
		Say 'INFO' 'whoami' 'no API key in metadata; production checks skipped'
	}
}

$threats = Get-MpThreatDetection -ErrorAction SilentlyContinue
Say 'INFO' 'defender' ("Defender detections: " + @($threats).Count)

$null = Run 'uninstall' $winget @('uninstall', '--manifest', $dir, '--scope', 'machine', '--disable-interactivity')
Refresh-Path
if (Get-Command three-ws-agent -ErrorAction SilentlyContinue) {
	Say 'EXIT' 'removed' '1'
	$script:failed += 'removed'
} else {
	Say 'INFO' 'removed' 'three-ws-agent is no longer on PATH'
	Say 'EXIT' 'removed' '0'
}

if ($script:failed.Count -eq 0) { Say 'DONE' 'summary' 'ok' } else { Say 'DONE' 'summary' ('failed: ' + ($script:failed -join ',')) }
