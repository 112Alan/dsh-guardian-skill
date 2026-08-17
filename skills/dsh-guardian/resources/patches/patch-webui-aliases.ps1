# Patch: add "watchdog" alias to the web-ui-settings bridge allowlist.
# Byte-safe UTF-8 handling (NEVER use Get-Content/Set-Content on this file).
$ErrorActionPreference = 'Stop'
$f = 'C:\Users\16021\.dsh\profiles\web\node_modules\@linxin666\dsh-client-ui-web-ui-settings\lib\index.js'
if (-not (Test-Path $f)) { Write-Error "web-ui-settings not found: $f"; exit 1 }
$t = [System.IO.File]::ReadAllText($f, [System.Text.Encoding]::UTF8)
if ($t.Contains('"watchdog": "watchdog"')) {
  Write-Output 'already patched'
  exit 0
}
Copy-Item $f "$f.bak" -Force
$anchor = '"dsh-tool-describe-image": "describe-image",'
if (-not $t.Contains($anchor)) { Write-Error 'anchor not found'; exit 1 }
$t = $t.Replace($anchor, $anchor + "`n`t`"watchdog`": `"watchdog`",")
[System.IO.File]::WriteAllText($f, $t, (New-Object System.Text.UTF8Encoding($false)))
node --check $f
if ($LASTEXITCODE -ne 0) { Write-Error 'syntax check failed after patch'; exit 1 }
Write-Output 'patched OK'
