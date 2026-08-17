# Patch: add "watchdog" to the official settings allowlist.
# dsh upgrades overwrite this file; re-run this script after every upgrade.
# Byte-safe UTF-8 handling (NEVER use Get-Content/Set-Content on this file).
$ErrorActionPreference = 'Stop'
$f = 'C:\Users\16021\AppData\Roaming\npm\node_modules\@deepseek-ai\dsh\node_modules\@deepseek-ai\dsh-host-apiproxy\lib\index.js'
if (-not (Test-Path $f)) { Write-Error "apiproxy not found: $f"; exit 1 }
$t = [System.IO.File]::ReadAllText($f, [System.Text.Encoding]::UTF8)
if ($t.Contains('"watchdog"')) {
  Write-Output 'already patched'
  exit 0
}
Copy-Item $f "$f.bak" -Force
$old = "`t`"web-search-deepseek`"`n];"
$new = "`t`"web-search-deepseek`",`n`t`"watchdog`"`n];"
if (-not $t.Contains($old)) { Write-Error 'anchor not found'; exit 1 }
$t = $t.Replace($old, $new)
[System.IO.File]::WriteAllText($f, $t, (New-Object System.Text.UTF8Encoding($false)))
node --check $f
if ($LASTEXITCODE -ne 0) { Write-Error 'syntax check failed after patch'; exit 1 }
Write-Output 'patched OK'
