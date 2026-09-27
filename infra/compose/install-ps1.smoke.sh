#!/usr/bin/env bash
# Parses the Windows installer and checks its WSL distribution choice with PowerShell.
set -euo pipefail
root="$(cd "$(dirname "$0")" && pwd)"
src="$root/install.ps1"
fail() { echo "FAIL: $*" >&2; exit 1; }

# Windows PowerShell 5.1 reads a saved script without a BOM as ANSI.
if LC_ALL=C grep -n '[^[:print:][:space:]]' "$src"; then
  fail "install.ps1 must stay ASCII"
fi

# Windows PowerShell 5.1 (Windows only) and PowerShell 7 parse differently; check each present.
shells=()
for shell in pwsh powershell; do
  if command -v "$shell" >/dev/null 2>&1; then
    shells+=("$shell")
  fi
done
if ((${#shells[@]} == 0)); then
  [[ -z "${CI:-}" ]] || fail "PowerShell is required in CI"
  echo "skip: PowerShell is not installed"
  exit 0
fi

tmp="$(mktemp -d "${TMPDIR:-/tmp}/install-ps1-smoke.XXXXXX")"
trap 'rm -rf "$tmp"' EXIT
cat > "$tmp/check.ps1" <<'PS1'
param([string]$Installer)
$ErrorActionPreference = 'Stop'
$tokens = $null
$errors = $null
$ast = [System.Management.Automation.Language.Parser]::ParseFile($Installer, [ref]$tokens, [ref]$errors)
if ($errors.Count -gt 0) { throw ('parse errors: ' + ($errors | Out-String)) }
foreach ($name in 'Fail', 'Test-WindowsBuild', 'Find-DockerInstallation', 'ConvertFrom-WslVersion', 'Test-WslVersion', 'ConvertFrom-WslList', 'Select-WslDistro') {
  $definition = $ast.Find({ param($node) $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq $name }, $true)
  if (-not $definition) { throw "missing function $name" }
  . ([scriptblock]::Create($definition.Extent.Text))
}
function Assert-Choice($Lines, $Expected) {
  $choice = Select-WslDistro @(ConvertFrom-WslList $Lines)
  $actual = if ($choice) { $choice.Name } else { '' }
  if ($actual -ne $Expected) { throw "expected [$Expected], got [$actual] for: $($Lines -join ' | ')" }
}
# Older WSL prints UTF-16, which arrives with NUL characters between letters.
$utf16 = @('  NAME      STATE      VERSION', '* Ubuntu    Running    2') | ForEach-Object { $_.ToCharArray() -join "`0" }
Assert-Choice $utf16 'Ubuntu'
Assert-Choice @('  NAME  STATE  VERSION', '* docker-desktop  Running  2', '  Ubuntu-24.04  Stopped  2') 'Ubuntu-24.04'
Assert-Choice @('  NAME  STATE  VERSION', '* Debian  Stopped  2', '  Ubuntu  Stopped  2') 'Debian'
try {
  Assert-Choice @('  NAME  STATE  VERSION', '* Ubuntu  Stopped  1') ''
  throw 'WSL 1 Ubuntu must require explicit conversion'
} catch {
  if ($_.Exception.Message -notlike '*wsl --set-version Ubuntu 2*') { throw }
}
Assert-Choice @('  NAME  STATE  VERSION', '* Ubuntu  Stopped  1', '  Ubuntu-24.04  Stopped  2') 'Ubuntu-24.04'
Assert-Choice @('  NAME  STATE  VERSION', '  Ubuntu  Wird ausgefuehrt  2') 'Ubuntu'
Assert-Choice @() ''

foreach ($build in 19041, 19044, 22000, 22621) {
  if (Test-WindowsBuild $build) { throw "unsupported Windows build admitted: $build" }
}
foreach ($build in 19045, 22631, 26100) {
  if (-not (Test-WindowsBuild $build)) { throw "supported Windows build refused: $build" }
}
if ((ConvertFrom-WslVersion @('WSL version: 2.1.5.0', 'Kernel version: 5.15.0')) -ne [version]'2.1.5.0') { throw 'WSL version parsed incorrectly' }
$versionUtf16 = 'WSL version: 2.6.1.0'.ToCharArray() -join "`0"
if ((ConvertFrom-WslVersion @($versionUtf16)) -ne [version]'2.6.1.0') { throw 'UTF-16 WSL version parsed incorrectly' }
if ($null -ne (ConvertFrom-WslVersion @('Unknown option: --version'))) { throw 'inbox WSL must not look current' }
# Mock only the native command; exercise the actual installer version predicate.
function wsl.exe { $global:LASTEXITCODE = $script:wslExit; return $script:wslLines }
$script:wslExit = 0
foreach ($version in '1.2.5', '2.1.4', '2.1.5', '2.6.1.0') {
  $script:wslLines = @("WSL version: $version")
  if ((Test-WslVersion) -ne ([version]$version -ge [version]'2.1.5')) { throw "WSL version gate incorrect: $version" }
}
$script:wslExit = 1
if (Test-WslVersion) { throw 'failed WSL command must not pass' }

$fixture = Join-Path ([IO.Path]::GetTempPath()) ([guid]::NewGuid().ToString())
try {
  $programFiles = Join-Path $fixture 'program-files'
  $localAppData = Join-Path $fixture 'local-app-data'
  New-Item -ItemType Directory -Force $programFiles, $localAppData | Out-Null
  if ($null -ne (Find-DockerInstallation $programFiles $localAppData)) { throw 'missing Docker must remain absent' }
  foreach ($root in @((Join-Path $programFiles 'Docker\Docker'), (Join-Path $localAppData 'Programs\DockerDesktop'))) {
    New-Item -ItemType Directory -Force (Join-Path $root 'resources\bin') | Out-Null
    New-Item -ItemType File -Force (Join-Path $root 'Docker Desktop.exe'), (Join-Path $root 'resources\bin\docker.exe') | Out-Null
    $found = Find-DockerInstallation $programFiles $localAppData
    if ($found.Desktop -ne (Join-Path $root 'Docker Desktop.exe')) { throw "Docker root detection incorrect: $root" }
    if ($found.Cli -ne (Join-Path $root 'resources\bin\docker.exe')) { throw 'Docker CLI root mismatched' }
  }
} finally { Remove-Item -Recurse -Force $fixture -ErrorAction SilentlyContinue }
PS1

for shell in "${shells[@]}"; do
  "$shell" -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$tmp/check.ps1" "$src" \
    || fail "install.ps1 checks failed in $shell"
done

echo "ok"
