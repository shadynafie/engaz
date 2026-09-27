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
foreach ($name in 'ConvertFrom-WslList', 'Select-WslDistro') {
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
Assert-Choice @('  NAME  STATE  VERSION', '* Ubuntu  Stopped  1') ''
Assert-Choice @('  NAME  STATE  VERSION', '  Ubuntu  Wird ausgefuehrt  2') 'Ubuntu'
Assert-Choice @() ''
PS1

for shell in "${shells[@]}"; do
  "$shell" -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$tmp/check.ps1" "$src" \
    || fail "install.ps1 checks failed in $shell"
done

echo "ok"
