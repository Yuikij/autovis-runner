<#
.SYNOPSIS
    AutoVis Runner Windows Installer
.DESCRIPTION
    One-command installer for AutoVis Runner on Windows.
    Downloads the latest release (or builds from source), installs a bundled
    Node.js runtime when needed, installs dependencies and browsers, and
    registers a native Windows Service via WinSW with autostart, crash
    restart, and log rotation. Re-running the installer upgrades in place
    while preserving config and data.
.PARAMETER InstallDir
    Installation directory. Default: C:\autovis-runner
.PARAMETER ConfigDir
    Configuration directory. Default: <InstallDir>\config
.PARAMETER DataDir
    Data / artifact storage directory. Default: <InstallDir>\data
.PARAMETER Port
    HTTP listen port. Default: 8787
.PARAMETER ServiceName
    Windows service name. Default: AutoVisRunner
.PARAMETER Version
    Install a specific release (e.g. 0.9.0) instead of the latest.
.PARAMETER PackageUrl
    Install from a custom release tarball URL.
.PARAMETER FromSource
    Build from the current source tree instead of downloading a release.
.PARAMETER SkipService
    Install files and deps only; do not register a Windows service.
.PARAMETER Uninstall
    Remove the Windows service and application files (config and data are kept).
.PARAMETER Purge
    With -Uninstall: also remove config, data, and the whole install directory.
.EXAMPLE
    # Install or upgrade from the latest GitHub release:
    powershell -ExecutionPolicy Bypass -File install.ps1

    # Install from source (when you have the repo checked out):
    powershell -ExecutionPolicy Bypass -File install.ps1 -FromSource

    # Pin a version:
    powershell -ExecutionPolicy Bypass -File install.ps1 -Version 0.9.0

    # Uninstall (keep config and data):
    powershell -ExecutionPolicy Bypass -File install.ps1 -Uninstall

    # Uninstall everything:
    powershell -ExecutionPolicy Bypass -File install.ps1 -Uninstall -Purge
#>

#requires -Version 5.1

[CmdletBinding()]
param(
    [string]$InstallDir  = "C:\autovis-runner",
    [string]$ConfigDir   = "",
    [string]$DataDir     = "",
    [int]$Port           = 8787,
    [string]$ServiceName = "AutoVisRunner",
    [string]$Version     = "",
    [string]$PackageUrl  = "",
    [switch]$FromSource,
    [switch]$SkipService,
    [switch]$Uninstall,
    [switch]$Purge
)

$ErrorActionPreference = "Stop"
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

# -- Derived paths -----------------------------------------------------------
if (-not $ConfigDir) { $ConfigDir = Join-Path $InstallDir "config" }
if (-not $DataDir)   { $DataDir   = Join-Path $InstallDir "data" }

$AppDir      = Join-Path $InstallDir "app"
$NodeDir     = Join-Path $InstallDir "node"
$ToolsDir    = Join-Path $InstallDir "tools"
$LogDir      = Join-Path $InstallDir "logs"
$WinswDir    = Join-Path $InstallDir "winsw"
$WinswExe    = Join-Path $WinswDir "autovis-service.exe"
$WinswXml    = Join-Path $WinswDir "autovis-service.xml"
$EnvFile     = Join-Path $ConfigDir "runner.env"
$StartScript = Join-Path $InstallDir "start-runner.ps1"
$Repo        = if ($env:AUTOVIS_RUNNER_REPO) { $env:AUTOVIS_RUNNER_REPO } else { "Yuikij/autovis-runner" }
$NodeMajorRequired = 25
$WinswUrl    = "https://github.com/winsw/winsw/releases/download/v2.12.0/WinSW-x64.exe"

# Resolved at runtime by Resolve-Node / Resolve-Pnpm
$script:NodeExe = $null
$script:PnpmExe = $null

# -- Output helpers ----------------------------------------------------------
function Write-Step { param([string]$Msg) Write-Host "`n> $Msg" -ForegroundColor Cyan }
function Write-Ok   { param([string]$Msg) Write-Host "  [OK] $Msg" -ForegroundColor Green }
function Write-Warn2 { param([string]$Msg) Write-Host "  [WARN] $Msg" -ForegroundColor Yellow }

# Run a native command and fail loudly on a non-zero exit code.
# (try/catch does NOT catch native exe failures, so exit codes must be checked.)
function Exec {
    param(
        [Parameter(Mandatory)][scriptblock]$Command,
        [string]$What = ""
    )
    & $Command
    if ($LASTEXITCODE -ne 0) {
        $label = if ($What) { $What } else { $Command.ToString().Trim() }
        throw "command failed with exit code $LASTEXITCODE`: $label"
    }
}

function Test-IsAdmin {
    $identity  = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = New-Object Security.Principal.WindowsPrincipal($identity)
    return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Get-WindowsArch {
    if ($env:PROCESSOR_ARCHITECTURE -eq "ARM64") { return "arm64" }
    return "x64"
}

# -- Service management (WinSW, with legacy NSSM cleanup) --------------------
function Stop-RunnerService {
    $svc = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
    if (-not $svc) { return }
    if ($svc.Status -ne "Stopped") {
        Write-Host "  Stopping service '$ServiceName'..." -ForegroundColor DarkGray
        if ((Test-Path $WinswExe) -and (Test-Path $WinswXml)) {
            & $WinswExe stop 2>&1 | Out-Null
        } else {
            Stop-Service -Name $ServiceName -Force -ErrorAction SilentlyContinue
        }
        Start-Sleep -Seconds 2
    }
}

function Remove-RunnerService {
    $svc = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
    if (-not $svc) { return }
    Stop-RunnerService
    if ((Test-Path $WinswExe) -and (Test-Path $WinswXml)) {
        & $WinswExe uninstall 2>&1 | Out-Null
    } else {
        # Legacy install (NSSM) or unknown wrapper: remove via sc.exe
        sc.exe delete $ServiceName | Out-Null
    }
    Start-Sleep -Seconds 1
    Write-Ok "Service '$ServiceName' removed."
}

function Install-RunnerService {
    Write-Step "Registering Windows Service '$ServiceName' (WinSW)..."

    New-Item -ItemType Directory -Force -Path $WinswDir, $LogDir | Out-Null

    if (-not (Test-Path $WinswExe)) {
        Write-Host "  Downloading WinSW service wrapper..." -ForegroundColor DarkGray
        Invoke-WebRequest -Uri $WinswUrl -OutFile $WinswExe -UseBasicParsing
    }

    # Remove any existing service (including legacy NSSM installs) first.
    Remove-RunnerService

    $pwshExe = (Get-Command powershell.exe).Source
    $xml = @"
<service>
  <id>$ServiceName</id>
  <name>AutoVis Runner</name>
  <description>AutoVis Runner - Browser automation service</description>
  <executable>$pwshExe</executable>
  <arguments>-ExecutionPolicy Bypass -NoProfile -File "$StartScript"</arguments>
  <workingdirectory>$InstallDir</workingdirectory>
  <startmode>Automatic</startmode>
  <onfailure action="restart" delay="3 sec"/>
  <resetfailure>1 hour</resetfailure>
  <stoptimeout>10 sec</stoptimeout>
  <logpath>$LogDir</logpath>
  <log mode="roll-by-size">
    <sizeThreshold>5120</sizeThreshold>
    <keepFiles>4</keepFiles>
  </log>
</service>
"@
    Set-Content -Path $WinswXml -Value $xml -Encoding UTF8

    Exec { & $WinswExe install } "winsw install"
    Exec { & $WinswExe start } "winsw start"
    Start-Sleep -Seconds 2

    $svc = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
    if ($svc -and $svc.Status -eq "Running") {
        Write-Ok "Service '$ServiceName' is running (autostarts on boot, restarts on crash)."
    } else {
        Write-Warn2 "Service may not have started. Check logs in $LogDir"
    }
}

# -- Uninstall ---------------------------------------------------------------
function Invoke-Uninstall {
    Write-Step "Uninstalling AutoVis Runner..."
    Remove-RunnerService

    if ($Purge) {
        Remove-Item -Recurse -Force $InstallDir -ErrorAction SilentlyContinue
        if (($ConfigDir -notlike "$InstallDir*")) { Remove-Item -Recurse -Force $ConfigDir -ErrorAction SilentlyContinue }
        if (($DataDir   -notlike "$InstallDir*")) { Remove-Item -Recurse -Force $DataDir   -ErrorAction SilentlyContinue }
        Write-Ok "Removed install directory, config, and data."
    } else {
        foreach ($p in @($AppDir, $NodeDir, $ToolsDir, $WinswDir, $LogDir, $StartScript, (Join-Path $InstallDir "nssm"), (Join-Path $InstallDir "pnpm.exe"))) {
            Remove-Item -Recurse -Force $p -ErrorAction SilentlyContinue
        }
        Write-Ok "Application files removed."
        Write-Host "  Config ($ConfigDir) and data ($DataDir) were kept. Re-run with -Uninstall -Purge to remove them."
    }
    Write-Host "`nAutoVis Runner has been uninstalled." -ForegroundColor Green
}

# -- Node.js runtime ---------------------------------------------------------
# Prefers a system Node >= 25; otherwise downloads an official Node build into
# <InstallDir>\node. Nothing is written to the machine PATH; the start script
# and this installer reference the bundled runtime by absolute path.
function Resolve-Node {
    Write-Step "Checking Node.js..."

    $systemNode = Get-Command node -ErrorAction SilentlyContinue
    if ($systemNode) {
        $ver = & $systemNode.Source -p "process.versions.node" 2>$null
        if ($ver -and [int]($ver -split "\.")[0] -ge $NodeMajorRequired) {
            $script:NodeExe = $systemNode.Source
            Write-Ok "Using system Node.js v$ver"
            return
        }
        Write-Warn2 "System Node.js v$ver found, but $NodeMajorRequired+ is required."
    }

    $bundledNode = Join-Path $NodeDir "node.exe"
    if (Test-Path $bundledNode) {
        $ver = & $bundledNode -p "process.versions.node" 2>$null
        if ($ver -and [int]($ver -split "\.")[0] -ge $NodeMajorRequired) {
            $script:NodeExe = $bundledNode
            Write-Ok "Using bundled Node.js v$ver"
            return
        }
    }

    Write-Host "  Downloading a bundled Node.js runtime..." -ForegroundColor DarkGray
    $arch = Get-WindowsArch
    $base = "https://nodejs.org/dist/latest-v$NodeMajorRequired.x"
    $shasums = (Invoke-WebRequest -Uri "$base/SHASUMS256.txt" -UseBasicParsing).Content
    $match = [regex]::Match($shasums, "node-v[\d.]+-win-$arch\.zip")
    if (-not $match.Success) { throw "could not resolve a Node.js $NodeMajorRequired.x build for win-$arch" }
    $zipName = $match.Value

    $zipPath = Join-Path $env:TEMP $zipName
    $tmpDir  = Join-Path $env:TEMP "autovis-node-$(Get-Random)"
    try {
        Invoke-WebRequest -Uri "$base/$zipName" -OutFile $zipPath -UseBasicParsing
        Expand-Archive -Path $zipPath -DestinationPath $tmpDir -Force
        $extracted = Get-ChildItem -Path $tmpDir -Directory | Select-Object -First 1
        if (Test-Path $NodeDir) { Remove-Item -Recurse -Force $NodeDir }
        Move-Item $extracted.FullName $NodeDir
    } finally {
        Remove-Item -Force $zipPath -ErrorAction SilentlyContinue
        Remove-Item -Recurse -Force $tmpDir -ErrorAction SilentlyContinue
    }

    $script:NodeExe = $bundledNode
    $ver = & $bundledNode -p "process.versions.node"
    Write-Ok "Bundled Node.js v$ver installed to $NodeDir"
}

# -- pnpm --------------------------------------------------------------------
# Prefers a system pnpm; otherwise downloads the standalone pnpm binary into
# <InstallDir>\tools (self-contained, no npm global prefix needed).
function Resolve-Pnpm {
    Write-Step "Checking pnpm..."

    $systemPnpm = Get-Command pnpm -ErrorAction SilentlyContinue
    if ($systemPnpm) {
        $script:PnpmExe = $systemPnpm.Source
        $ver = & $script:PnpmExe --version
        Write-Ok "Using system pnpm v$ver"
        return
    }

    $bundledPnpm = Join-Path $ToolsDir "pnpm.exe"
    if (-not (Test-Path $bundledPnpm)) {
        Write-Host "  Downloading standalone pnpm..." -ForegroundColor DarkGray
        New-Item -ItemType Directory -Force -Path $ToolsDir | Out-Null
        $arch = Get-WindowsArch
        try {
            Invoke-WebRequest -Uri "https://github.com/pnpm/pnpm/releases/latest/download/pnpm-win-$arch.exe" -OutFile $bundledPnpm -UseBasicParsing
        } catch {
            if ($arch -ne "x64") {
                Invoke-WebRequest -Uri "https://github.com/pnpm/pnpm/releases/latest/download/pnpm-win-x64.exe" -OutFile $bundledPnpm -UseBasicParsing
            } else { throw }
        }
    }
    $script:PnpmExe = $bundledPnpm
    $ver = & $script:PnpmExe --version
    Write-Ok "Using bundled pnpm v$ver"
}

# -- Application files -------------------------------------------------------
function Install-AppFilesFromSource {
    $srcRoot = $PSScriptRoot
    Write-Step "Building from source ($srcRoot)..."

    Push-Location $srcRoot
    try {
        Exec { & $script:PnpmExe install --frozen-lockfile } "pnpm install (source)"
        Exec { & $script:PnpmExe build } "pnpm build"
    } finally {
        Pop-Location
    }

    Write-Step "Copying build artifacts to $AppDir..."
    if (Test-Path $AppDir) { Remove-Item -Recurse -Force $AppDir }
    New-Item -ItemType Directory -Force -Path $AppDir | Out-Null

    foreach ($f in @("package.json", "pnpm-lock.yaml", "pnpm-workspace.yaml", "tsconfig.base.json")) {
        Copy-Item (Join-Path $srcRoot $f) -Destination $AppDir -Force
    }
    foreach ($sub in @("apps\server", "apps\web", "packages\shared", "packages\runner", "scripts")) {
        $src = Join-Path $srcRoot $sub
        if (-not (Test-Path $src)) { continue }
        $dst = Join-Path $AppDir $sub
        New-Item -ItemType Directory -Force -Path (Split-Path $dst -Parent) | Out-Null
        robocopy $src $dst /E /XD node_modules .turbo .vite /NFL /NDL /NJH /NJS /NC /NS /NP | Out-Null
        if ($LASTEXITCODE -ge 8) { throw "robocopy failed for $sub (exit $LASTEXITCODE)" }
    }
    $global:LASTEXITCODE = 0
    Write-Ok "Build artifacts copied."
}

function Install-AppFilesFromRelease {
    Write-Step "Fetching release package..."

    $url = $PackageUrl
    if (-not $url) {
        if ($Version) {
            $tag = "v" + ($Version -replace "^v", "")
        } else {
            $release = Invoke-RestMethod -Uri "https://api.github.com/repos/$Repo/releases/latest" -UseBasicParsing
            $tag = $release.tag_name
        }
        $ver = $tag -replace "^v", ""
        $url = "https://github.com/$Repo/releases/download/$tag/autovis-runner-$ver.tar.gz"
    }
    Write-Host "  URL: $url" -ForegroundColor DarkGray

    $tmpDir  = Join-Path $env:TEMP "autovis-install-$(Get-Random)"
    $tarball = Join-Path $tmpDir "autovis-runner.tar.gz"
    New-Item -ItemType Directory -Force -Path $tmpDir | Out-Null
    try {
        Invoke-WebRequest -Uri $url -OutFile $tarball -UseBasicParsing
        Exec { tar -xzf $tarball -C $tmpDir } "tar extract"
        $extracted = Get-ChildItem -Path $tmpDir -Directory -Filter "autovis-runner-*" | Select-Object -First 1
        if (-not $extracted) { throw "release archive did not contain an autovis-runner-* directory" }

        if (Test-Path $AppDir) { Remove-Item -Recurse -Force $AppDir }
        Move-Item (Join-Path $extracted.FullName "app") $AppDir
        Write-Ok "Release installed."
    } finally {
        Remove-Item -Recurse -Force $tmpDir -ErrorAction SilentlyContinue
    }
}

function Install-Dependencies {
    Write-Step "Installing application dependencies..."
    # Ensure the resolved node is first on PATH for this session so pnpm
    # lifecycle scripts and browser installers use it.
    $env:PATH = (Split-Path $script:NodeExe -Parent) + ";" + $env:PATH

    Push-Location $AppDir
    try {
        Exec { & $script:PnpmExe install --prod --frozen-lockfile } "pnpm install"
        Write-Ok "Dependencies installed."

        Write-Step "Installing browsers (Playwright + Patchright)..."
        & $script:PnpmExe --filter "@autovis/server" exec playwright install chromium chrome
        if ($LASTEXITCODE -ne 0) { Write-Warn2 "Playwright browser install failed (non-fatal); rerun later inside $AppDir" }
        else { Write-Ok "Playwright browsers installed." }

        & $script:PnpmExe --filter "@autovis/server" exec patchright install chromium
        if ($LASTEXITCODE -ne 0) { Write-Warn2 "Patchright browser install failed (non-fatal)." }
        else { Write-Ok "Patchright browser installed." }
        $global:LASTEXITCODE = 0
    } finally {
        Pop-Location
    }
}

# -- Config and start script -------------------------------------------------
function Write-RunnerConfig {
    if (Test-Path $EnvFile) {
        Write-Ok "Existing config preserved: $EnvFile"
        return
    }
    Write-Step "Writing default configuration..."
    $lines = @(
        "PORT=$Port"
        "DATA_DIR=$DataDir"
        "APP_ORIGIN=http://localhost:$Port"
        "HEADLESS=false"
        "BROWSER_BACKEND=patchright"
        "AUTOVIS_AUTH_ENABLED=false"
        "AUTOVIS_LLM_SCOPE=shared"
        "AUTOVIS_ADMIN_USER=admin"
        "AUTOVIS_ADMIN_PASSWORD="
        "AUTOVIS_CLOUD_URL="
        "AUTOVIS_DEVICE_TOKEN="
    )
    Set-Content -Path $EnvFile -Value ($lines -join "`n") -Encoding UTF8
    Write-Ok "Config written to $EnvFile"
}

function Write-StartScript {
    Write-Step "Writing start script..."

    $template = @'
$ErrorActionPreference = "Stop"
$ConfigFile = if ($env:AUTOVIS_CONFIG_FILE) { $env:AUTOVIS_CONFIG_FILE } else { "__ENV_FILE__" }
$AppDir = "__APP_DIR__"

if (Test-Path $ConfigFile) {
    Get-Content $ConfigFile | ForEach-Object {
        $line = $_.Trim()
        if ($line -and -not $line.StartsWith("#")) {
            $parts = $line -split "=", 2
            if ($parts.Count -eq 2) {
                [Environment]::SetEnvironmentVariable($parts[0].Trim(), $parts[1].Trim(), "Process")
            }
        }
    }
}

if (-not $env:PORT)       { $env:PORT       = "__PORT__" }
if (-not $env:DATA_DIR)   { $env:DATA_DIR   = "__DATA_DIR__" }
if (-not $env:APP_ORIGIN) { $env:APP_ORIGIN = "http://localhost:$env:PORT" }

# Prefer the bundled Node runtime when present
$BundledNode = "__NODE_EXE__"
$NodeCmd = if (Test-Path $BundledNode) { $BundledNode } else { "node" }

# Release packages ship compiled dist/; source installs may only have src/
$distEntry = Join-Path $AppDir "apps\server\dist\index.js"
if (Test-Path $distEntry) {
    & $NodeCmd $distEntry
} else {
    $tsxCmd = Join-Path $AppDir "apps\server\node_modules\.bin\tsx.cmd"
    & $tsxCmd (Join-Path $AppDir "apps\server\src\index.ts")
}
exit $LASTEXITCODE
'@

    $content = $template.
        Replace("__ENV_FILE__", $EnvFile).
        Replace("__APP_DIR__", $AppDir).
        Replace("__PORT__", "$Port").
        Replace("__DATA_DIR__", $DataDir).
        Replace("__NODE_EXE__", $script:NodeExe)
    Set-Content -Path $StartScript -Value $content -Encoding UTF8
    Write-Ok "Start script: $StartScript"
}

# -- Main --------------------------------------------------------------------
function Invoke-Install {
    Write-Host ""
    Write-Host "=================================================" -ForegroundColor Magenta
    Write-Host "     AutoVis Runner Windows Installer            " -ForegroundColor Magenta
    Write-Host "=================================================" -ForegroundColor Magenta

    New-Item -ItemType Directory -Force -Path $InstallDir, $ConfigDir, $DataDir, $LogDir | Out-Null

    Resolve-Node
    Resolve-Pnpm

    # Stop a running service before replacing files to release file locks.
    Stop-RunnerService

    if ($FromSource) {
        Install-AppFilesFromSource
    } else {
        Install-AppFilesFromRelease
    }

    Install-Dependencies
    Write-RunnerConfig
    Write-StartScript

    if ($SkipService) {
        Write-Warn2 "-SkipService given; service registration skipped."
        Write-Host "  Start manually with: powershell -ExecutionPolicy Bypass -File `"$StartScript`""
    } else {
        Install-RunnerService
    }

    Write-Host ""
    Write-Host "=================================================" -ForegroundColor Green
    Write-Host "     AutoVis Runner installed successfully!      " -ForegroundColor Green
    Write-Host "=================================================" -ForegroundColor Green
    Write-Host ""
    Write-Host "  URL:     http://localhost:$Port"
    Write-Host "  Config:  $EnvFile"
    if (-not $SkipService) {
        Write-Host "  Service: $WinswExe status|start|stop|restart"
        Write-Host "  Logs:    $LogDir\autovis-service.out.log"
    }
    Write-Host ""
}

try {
    if (-not (Test-IsAdmin)) {
        throw "please run this script as Administrator (right-click PowerShell -> Run as Administrator)"
    }
    if ($Uninstall) {
        Invoke-Uninstall
    } else {
        Invoke-Install
    }
} catch {
    Write-Host "`n[ERROR] $_" -ForegroundColor Red
    exit 1
}
