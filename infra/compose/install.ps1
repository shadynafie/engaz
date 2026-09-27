# Engaz installer for Windows. Run in PowerShell:
#   irm https://engaz.app/install.ps1 | iex
# It prepares WSL and Docker Desktop, then runs the same installer as Linux and macOS
# inside WSL. Running it again updates an existing installation.
# Keep this file ASCII: Windows PowerShell 5.1 reads saved scripts without a BOM as ANSI.

& {
  Set-StrictMode -Version 2
  $ErrorActionPreference = 'Stop'
  $ProgressPreference = 'SilentlyContinue'
  [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12

  $ReleaseVersion = ''
  $DownloadBase = 'https://raw.githubusercontent.com/shadynafie/engaz/main/infra/compose'
  if (-not $ReleaseVersion -and $env:ENGAZ_DOWNLOAD_BASE) { $DownloadBase = $env:ENGAZ_DOWNLOAD_BASE.TrimEnd('/') }
  $InstallerBase = if ($ReleaseVersion) { "https://github.com/shadynafie/engaz/releases/download/$ReleaseVersion" } else { $DownloadBase }
  $DockerDesktop = ''
  $DockerCli = ''
  $CommandDir = Join-Path $env:LOCALAPPDATA 'Engaz'

  # Windows Terminal and VS Code draw emoji; the classic console shows boxes.
  $Fancy = [bool]$env:WT_SESSION -or $env:TERM_PROGRAM -eq 'vscode'
  $Icons = @{
    wave = 0x1F44B; wsl = 0x1F427; docker = 0x1F433; wait = 0x23F3; ok = 0x2705; restart = 0x1F504
    download = 0x1F4E6; key = 0x1F511; tool = 0x1F527; shield = 0x1F6E1; error = 0x274C
  }

  function Say([string]$Icon, [string]$Text) {
    if ($Fancy) { Write-Host ([char]::ConvertFromUtf32($Icons[$Icon]) + ' ' + $Text) } else { Write-Host $Text }
  }

  function Step([string]$Icon, [string]$Text) {
    Write-Host ''
    Say $Icon $Text
  }

  function Fail([string]$Text) { throw "ENGAZ: $Text" }

  # Windows PowerShell 5.1 turns redirected native stderr into errors; exit codes decide here.
  function Invoke-Quietly([scriptblock]$Command) {
    $ErrorActionPreference = 'Continue'
    & $Command *> $null
    return $LASTEXITCODE -eq 0
  }

  # Enter accepts; only an explicit no declines.
  function Confirm-Step([string]$Question) {
    $answer = Read-Host "$Question [Y/n]"
    return -not ($answer -match '^\s*n')
  }

  # One permission prompt per system change; everything else runs as the signed-in user.
  function Invoke-Elevated([string]$File, [string[]]$Arguments) {
    $quoted = $Arguments | ForEach-Object { if ($_ -match '\s') { '"' + $_ + '"' } else { $_ } }
    $process = Start-Process -FilePath $File -ArgumentList $quoted -Verb RunAs -Wait -PassThru
    return $process.ExitCode
  }

  # Setup resumes by itself after a restart that Windows requires.
  function Register-Resume {
    $command = "powershell.exe -NoProfile -ExecutionPolicy Bypass -NoExit -Command `"irm $InstallerBase/install.ps1 | iex`""
    Set-ItemProperty -Path 'HKCU:\Software\Microsoft\Windows\CurrentVersion\RunOnce' -Name 'EngazSetup' -Value $command
  }

  function Request-Restart([string]$Reason) {
    Register-Resume
    Step 'restart' "$Reason Setup continues by itself after you sign in again."
    if (Confirm-Step 'Restart now?') { Restart-Computer -Force }
    throw 'ENGAZ-RESTART: Restart Windows to continue. Setup resumes after you sign in.'
  }

  function Test-WindowsBuild([int]$Build) {
    # Windows 10 22H2, or Windows 11 23H2 and newer, as required by Docker Desktop.
    return ($Build -ge 19045 -and $Build -lt 22000) -or $Build -ge 22631
  }

  function Find-DockerInstallation([string]$ProgramFiles, [string]$LocalAppData) {
    foreach ($root in @((Join-Path $LocalAppData 'Programs\DockerDesktop'), (Join-Path $ProgramFiles 'Docker\Docker'))) {
      $desktop = Join-Path $root 'Docker Desktop.exe'
      $cli = Join-Path $root 'resources\bin\docker.exe'
      if ((Test-Path $desktop) -and (Test-Path $cli)) {
        return [pscustomobject]@{ Desktop = $desktop; Cli = $cli }
      }
    }
    return $null
  }

  function ConvertFrom-WslVersion([string[]]$Lines) {
    foreach ($line in $Lines) {
      $clean = $line -replace "`0", ''
      if ($clean -match '(\d+\.\d+\.\d+(?:\.\d+)?)') { return [version]$Matches[1] }
    }
    return $null
  }

  function Test-WslVersion {
    $ErrorActionPreference = 'Continue'
    $lines = & wsl.exe --version 2>$null
    if ($LASTEXITCODE -ne 0) { return $false }
    $version = ConvertFrom-WslVersion $lines
    return $null -ne $version -and $version -ge [version]'2.1.5'
  }

  function Test-Wsl {
    if (-not (Get-Command wsl.exe -ErrorAction SilentlyContinue)) { return $false }
    return Invoke-Quietly { wsl.exe --status }
  }

  # `wsl --list --verbose`: an optional default marker, the name, a state, and the WSL version.
  function ConvertFrom-WslList([string[]]$Lines) {
    foreach ($line in $Lines) {
      $clean = $line -replace "`0", ''
      if ($clean -match '^\s*(\*?)\s*(\S+)\s+.*\s([12])\s*$') {
        [pscustomobject]@{ Name = $Matches[2]; Default = $Matches[1] -eq '*'; Version = [int]$Matches[3] }
      }
    }
  }

  function Get-WslDistribution {
    $ErrorActionPreference = 'Continue'
    $env:WSL_UTF8 = '1'
    $lines = & wsl.exe --list --verbose 2>$null
    if ($LASTEXITCODE -ne 0) { return @() }
    return @(ConvertFrom-WslList $lines)
  }

  # Docker Desktop connects to the default WSL distribution, so Engaz uses it.
  function Select-WslDistro($Distros) {
    $usable = @($Distros | Where-Object { $_.Name -notlike 'docker-desktop*' -and $_.Version -eq 2 })
    $default = @($usable | Where-Object { $_.Default })
    if ($default.Count -gt 0) { return $default[0] }
    $ubuntu = @($usable | Where-Object { $_.Name -like 'Ubuntu*' })
    if ($ubuntu.Count -gt 0) { return $ubuntu[0] }
    if (@($Distros | Where-Object { $_.Name -eq 'Ubuntu' -and $_.Version -eq 1 }).Count -gt 0) {
      Fail 'Ubuntu already uses WSL 1. To convert it explicitly, run wsl --set-version Ubuntu 2, then run this command again. Back up existing Ubuntu data before conversion.'
    }
    return $null
  }

  # Runs in the console, not captured, so questions and progress reach the person; read $LASTEXITCODE after.
  function Invoke-InWsl([string]$Distro, [string]$User, [string]$Script) {
    $arguments = @('-d', $Distro)
    if ($User) { $arguments += @('-u', $User) }
    & wsl.exe @arguments --cd '~' --exec bash -c $Script
  }

  function Test-DockerEngine {
    if (-not (Test-Path $DockerCli)) { return $false }
    return Invoke-Quietly { & $DockerCli info }
  }

  function Wait-Until([scriptblock]$Ready, [int]$Seconds) {
    $deadline = (Get-Date).AddSeconds($Seconds)
    while ((Get-Date) -lt $deadline) {
      if (& $Ready) { return $true }
      Start-Sleep -Seconds 3
    }
    return $false
  }

  function Install-DockerDesktop {
    Step 'docker' 'Engaz runs on Docker Desktop, which is not installed yet.'
    Write-Host '   Engaz can install it for you (about 600 MB). It is free for personal use and small'
    Write-Host '   businesses. Installing it accepts the Docker Subscription Service Agreement:'
    Write-Host '   https://www.docker.com/legal/docker-subscription-service-agreement/'
    if (-not (Confirm-Step 'Install Docker Desktop now?')) {
      Fail 'Docker Desktop is required. Install it from https://docs.docker.com/desktop/setup/install/windows-install/, then run this command again.'
    }
    $architecture = if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64') { 'arm64' } else { 'amd64' }
    $installer = Join-Path $env:TEMP 'EngazDockerDesktopInstaller.exe'
    Say 'download' 'Downloading Docker Desktop.'
    & curl.exe -fL --proto '=https' --progress-bar -o $installer "https://desktop.docker.com/win/main/$architecture/Docker%20Desktop%20Installer.exe"
    if ($LASTEXITCODE -ne 0) { Fail 'could not download Docker Desktop.' }
    Say 'key' 'Windows will ask for permission to install Docker Desktop.'
    $code = Invoke-Elevated $installer @('install', '--quiet', '--accept-license', '--backend=wsl-2')
    Remove-Item $installer -ErrorAction SilentlyContinue
    if ($code -eq 3010) { Request-Restart 'Restart Windows to finish installing Docker Desktop.' }
    if ($code -ne 0) { Fail "Docker Desktop installation failed (code $code)." }
    Say 'ok' 'Docker Desktop is installed.'
  }

  # The engaz command records where Engaz runs, so a rerun updates that same installation.
  function Get-PreviousInstall($Distros) {
    $shim = Join-Path $CommandDir 'engaz.cmd'
    if (-not (Test-Path $shim)) { return $null }
    if ((Get-Content -Raw $shim) -notmatch 'wsl\.exe -d (\S+)(?: -u (\S+))?') { return $null }
    $previous = @($Distros | Where-Object { $_.Name -eq $Matches[1] })
    if ($previous.Count -eq 0) { return $null }
    return [pscustomobject]@{ Distro = $previous[0]; User = $Matches[2] }
  }

  function Install-EngazCommand([string]$Distro, [string]$User) {
    New-Item -ItemType Directory -Force -Path $CommandDir | Out-Null
    $userArgument = if ($User) { " -u $User" } else { '' }
    $shim = "@echo off`r`nwsl.exe -d $Distro$userArgument --cd ~ --exec .local/bin/engaz %*`r`n"
    Set-Content -Path (Join-Path $CommandDir 'engaz.cmd') -Value $shim -Encoding ASCII -NoNewline
    $path = [Environment]::GetEnvironmentVariable('Path', 'User')
    if (-not $path) { $path = '' }
    if (($path -split ';') -notcontains $CommandDir) {
      [Environment]::SetEnvironmentVariable('Path', (($path.TrimEnd(';') + ';' + $CommandDir).TrimStart(';')), 'User')
      Say 'tool' 'Added the engaz command. It works in new PowerShell windows.'
    }
  }

  function Install-Engaz {
    Step 'wave' "Welcome to Engaz! Let's get your AI team workspace running on Windows."

    if (-not (Test-WindowsBuild ([Environment]::OSVersion.Version.Build))) {
      Fail 'Docker Desktop needs Windows 10 22H2 (build 19045), or Windows 11 23H2 (build 22631) or newer. Update Windows, then run this command again.'
    }
    if (-not [Environment]::Is64BitOperatingSystem) { Fail 'Engaz needs 64-bit Windows.' }

    Step 'wsl' 'Checking Windows Subsystem for Linux (WSL).'
    if (-not (Test-Wsl)) {
      $cpu = Get-CimInstance Win32_Processor | Select-Object -First 1
      $system = Get-CimInstance Win32_ComputerSystem
      if (-not $system.HypervisorPresent -and -not $cpu.VirtualizationFirmwareEnabled) {
        Fail 'virtualization is turned off in this computer''s firmware (BIOS/UEFI). Turn on Intel VT-x or AMD-V, then run this command again.'
      }
      Write-Host '   Engaz runs Linux containers, which need WSL.'
      if (-not (Confirm-Step 'Turn on WSL now? Windows will ask for permission.')) {
        Fail 'WSL is required. Run wsl --install in an administrator PowerShell, restart, then run this command again.'
      }
      $code = Invoke-Elevated 'wsl.exe' @('--install', '--no-distribution')
      if ($code -eq 3010) { Request-Restart 'Restart Windows to finish turning on WSL.' }
      if ($code -ne 0) { Fail "turning on WSL failed (code $code)." }
      if (-not (Test-Wsl)) { Request-Restart 'Restart Windows to finish turning on WSL.' }
    }
    if (-not (Test-WslVersion)) {
      if (-not (Confirm-Step 'Docker Desktop needs WSL 2.1.5 or newer. Update WSL now? Windows may ask for permission.')) {
        Fail 'Run wsl --update in an administrator PowerShell, then run this command again.'
      }
      $code = Invoke-Elevated 'wsl.exe' @('--update')
      if ($code -eq 3010) { Request-Restart 'Restart Windows to finish updating WSL.' }
      if ($code -ne 0 -or -not (Test-WslVersion)) {
        Fail 'WSL must be version 2.1.5 or newer. Run wsl --update in an administrator PowerShell, restart if requested, then run this command again.'
      }
    }
    Say 'ok' 'WSL is ready.'

    $installedDistro = $false
    $user = ''
    $distros = Get-WslDistribution
    $previous = Get-PreviousInstall $distros
    if ($previous) {
      $distro = $previous.Distro
      $user = $previous.User
    } else {
      $distro = Select-WslDistro $distros
    }
    if (-not $distro) {
      Step 'wsl' 'Installing Ubuntu for WSL. This takes a few minutes.'
      & wsl.exe --install --distribution Ubuntu --no-launch --web-download
      if ($LASTEXITCODE -ne 0) { Fail 'could not install Ubuntu for WSL.' }
      $distro = Select-WslDistro (Get-WslDistribution)
      if (-not $distro) {
        Fail 'Ubuntu was installed but is not ready yet. Open Ubuntu from the Start menu once, then run this command again.'
      }
      $installedDistro = $true
    }
    if (-not $distro.Default) {
      & wsl.exe --set-default $distro.Name | Out-Null
      Say 'ok' "Made $($distro.Name) the default WSL distribution, which Docker Desktop connects to."
    }
    # A distribution Engaz installed has no user account yet; its commands run as root.
    if ($installedDistro) { $user = 'root' }

    Step 'docker' 'Checking Docker Desktop.'
    $dockerInstallation = Find-DockerInstallation $env:ProgramFiles $env:LOCALAPPDATA
    if (-not $dockerInstallation) {
      Install-DockerDesktop
      $dockerInstallation = Find-DockerInstallation $env:ProgramFiles $env:LOCALAPPDATA
      if (-not $dockerInstallation) { Fail 'Docker Desktop installation files were not found. Open Docker Desktop, then run this command again.' }
    }
    $DockerDesktop = $dockerInstallation.Desktop
    $DockerCli = $dockerInstallation.Cli
    if (-not (Test-DockerEngine)) {
      Start-Process -FilePath $DockerDesktop
      Say 'wait' 'Waiting for Docker Desktop to start. The first start can take a few minutes.'
      if (-not (Wait-Until { Test-DockerEngine } 300)) {
        Fail 'Docker Desktop did not start. Open Docker Desktop, wait until it says Engine running, then run this command again.'
      }
    }
    Say 'ok' 'Docker Desktop is running.'

    $name = $distro.Name
    if (-not (Wait-Until { Invoke-Quietly { Invoke-InWsl $name $user 'docker info' } } 90)) {
      Fail "Docker Desktop is not connected to $name. In Docker Desktop, open Settings > Resources > WSL integration, turn on $name, then run this command again."
    }

    $missing = @(Invoke-InWsl $name $user 'for c in curl python3 openssl; do command -v $c >/dev/null || echo $c; done')
    if ($missing.Count -gt 0) {
      Step 'download' "Installing tools Engaz needs in $($name): $($missing -join ', ')"
      Invoke-InWsl $name 'root' 'command -v apt-get >/dev/null && apt-get update -qq && DEBIAN_FRONTEND=noninteractive apt-get install -y -qq curl python3 openssl ca-certificates'
      if ($LASTEXITCODE -ne 0) { Fail "install curl, python3, and openssl in $name, then run this command again." }
    }

    Step 'shield' 'If Windows asks whether Docker Desktop may use the network, allow private networks so your other devices can open Engaz.'

    # The Linux installer does the rest, and updates an existing installation.
    $env:ENGAZ_DOWNLOAD_BASE = $DownloadBase
    $env:ENGAZ_INSTALLER_URL = "$InstallerBase/install-images.sh"
    $env:ENGAZ_WINDOWS_DOCKER_DESKTOP = $DockerDesktop
    $shared = @('ENGAZ_DOWNLOAD_BASE/u', 'ENGAZ_INSTALLER_URL/u', 'ENGAZ_WINDOWS_DOCKER_DESKTOP/p')
    if (-not $Fancy) {
      $env:ENGAZ_PLAIN = '1'
      $shared += 'ENGAZ_PLAIN/u'
    }
    $env:WSLENV = (@($env:WSLENV) + $shared | Where-Object { $_ }) -join ':'
    Invoke-InWsl $name $user 'set -o pipefail; curl -fsSL --proto =https "$ENGAZ_INSTALLER_URL" | bash'
    if ($LASTEXITCODE -ne 0) { Fail 'the installer stopped. Read the message above, then run this command again.' }

    Install-EngazCommand $name $user
  }

  $encoding = [Console]::OutputEncoding
  try {
    if ($Fancy) { [Console]::OutputEncoding = [Text.Encoding]::UTF8 }
    Install-Engaz
  } catch {
    $message = $_.Exception.Message
    Write-Host ''
    if ($message -like 'ENGAZ-RESTART: *') {
      Say 'restart' ($message -replace '^ENGAZ-RESTART: ', '')
    } else {
      Say 'error' ('Engaz setup failed: ' + ($message -replace '^ENGAZ: ', ''))
    }
  } finally {
    [Console]::OutputEncoding = $encoding
  }
}
