# dsh-guardian one-click installer for a NEW machine.
# Usage:  git clone https://github.com/112Alan/dsh-guardian-skill.git
#         cd dsh-guardian-skill
#         .\install.ps1
# Requirements: git, node, npm, pnpm (dsh plugin forwards to pnpm), dsh installed,
#               and the web profile created once (dsh web --help is enough).
# The script adapts the hard-coded machine paths from the author's machine to
# the current user, so it works on any Windows machine.
param(
  [string]$SourceDir,
  [string]$Profile = 'web'
)

$ErrorActionPreference = 'Stop'
$skill = Join-Path $PSScriptRoot 'skills\dsh-guardian'
if (-not (Test-Path (Join-Path $skill 'SKILL.md'))) { Write-Error "skill not found at $skill"; exit 1 }

# ---------- resolve target paths ----------
if (-not $SourceDir) { $SourceDir = Join-Path $HOME 'dsh-plugins' }
$watchDir = Join-Path $env:LOCALAPPDATA 'dsh'
$dshInstallRoot = Join-Path $env:APPDATA 'npm\node_modules\@deepseek-ai\dsh'
$profileDir = Join-Path $HOME ".dsh\profiles\$Profile"
$settingsFile = Join-Path $HOME '.dsh\settings.yaml'
New-Item -ItemType Directory -Force -Path $SourceDir, $watchDir | Out-Null

function Update-FilePaths([string]$path) {
  # Byte-safe path adaptation: author-machine paths -> current machine.
  $t = [System.IO.File]::ReadAllText($path, [System.Text.Encoding]::UTF8)
  $changed = $false
  if ($t.Contains('C:\Users\16021\AppData\Local\dsh')) {
    $t = $t.Replace('C:\Users\16021\AppData\Local\dsh', $watchDir); $changed = $true
  }
  if ($t.Contains('C:\Users\16021\deepseek多模态')) {
    $t = $t.Replace('C:\Users\16021\deepseek多模态', $SourceDir); $changed = $true
  }
  if ($t.Contains('C:\Users\16021\AppData\Roaming\npm')) {
    $t = $t.Replace('C:\Users\16021\AppData\Roaming\npm', (Join-Path $env:APPDATA 'npm')); $changed = $true
  }
  if ($t.Contains('C:\Users\16021\.dsh')) {
    $t = $t.Replace('C:\Users\16021\.dsh', (Join-Path $HOME '.dsh')); $changed = $true
  }
  if ($changed) {
    # vision-restart.ps1 may carry a non-ASCII path -> write with BOM so PS5.1 reads it.
    [System.IO.File]::WriteAllText($path, $t, (New-Object System.Text.UTF8Encoding($true)))
    Write-Host "  paths adapted: $path"
  }
}

Write-Host '== 1/6 copy plugin sources =='
Copy-Item -Recurse (Join-Path $skill 'resources\plugins\dsh-rollback') $SourceDir -Force
Copy-Item -Recurse (Join-Path $skill 'resources\plugins\dsh-watchdog') $SourceDir -Force

Write-Host '== 2/6 install dsh-watchdog deps =='
Push-Location (Join-Path $SourceDir 'dsh-watchdog')
npm install --no-audit --no-fund
Pop-Location

Write-Host '== 3/6 register plugins into profile =='
dsh plugin --profile $Profile add (Join-Path $SourceDir 'dsh-rollback')
dsh plugin --profile $Profile add (Join-Path $SourceDir 'dsh-watchdog')

Write-Host '== 4/6 copy + adapt scripts =='
$watchdogTarget = Join-Path $watchDir 'watchdog.ps1'
$visionTarget = Join-Path $watchDir 'vision-restart.ps1'
Copy-Item (Join-Path $skill 'resources\watchdog.ps1') $watchdogTarget -Force
Copy-Item (Join-Path $skill 'resources\vision-restart.ps1') $visionTarget -Force
Update-FilePaths $watchdogTarget
Update-FilePaths $visionTarget
Update-FilePaths (Join-Path $SourceDir 'dsh-watchdog\lib\index.js')
Update-FilePaths (Join-Path $SourceDir 'dsh-watchdog\package.json')
Update-FilePaths (Join-Path $SourceDir 'dsh-rollback\package.json')

Write-Host '== 5/6 apply settings allowlist patches =='
# Adapt the patch scripts' hard-coded roots first (byte-safe, keep ASCII).
$patch1 = Join-Path $skill 'resources\patches\patch-apiproxy-allowlist.ps1'
$patch2 = Join-Path $skill 'resources\patches\patch-webui-aliases.ps1'
$tmp1 = Join-Path $env:TEMP 'patch-apiproxy-allowlist.ps1'
$tmp2 = Join-Path $env:TEMP 'patch-webui-aliases.ps1'
Copy-Item $patch1 $tmp1 -Force; Copy-Item $patch2 $tmp2 -Force
$t1 = [System.IO.File]::ReadAllText($tmp1, [System.Text.Encoding]::UTF8)
$t1 = $t1.Replace('C:\Users\16021\AppData\Roaming\npm\node_modules\@deepseek-ai\dsh', $dshInstallRoot)
[System.IO.File]::WriteAllText($tmp1, $t1, (New-Object System.Text.UTF8Encoding($false)))
$t2 = [System.IO.File]::ReadAllText($tmp2, [System.Text.Encoding]::UTF8)
$t2 = $t2.Replace('C:\Users\16021\.dsh\profiles\web', $profileDir)
[System.IO.File]::WriteAllText($tmp2, $t2, (New-Object System.Text.UTF8Encoding($false)))
powershell -NoProfile -ExecutionPolicy Bypass -File $tmp1
powershell -NoProfile -ExecutionPolicy Bypass -File $tmp2
Remove-Item $tmp1, $tmp2 -Force -ErrorAction SilentlyContinue

Write-Host '== 6/6 append settings.yaml (if missing) =='
$doc = ''
if (Test-Path $settingsFile) { $doc = [System.IO.File]::ReadAllText($settingsFile, [System.Text.Encoding]::UTF8) }
$add = @()

if (-not $doc.Contains('watchdog:')) {
  $add += ''
  $add += '# dsh-guardian: watchdog config (enabled / intervalSeconds / watchVisionProxy)'
  $add += 'watchdog:'
  $add += '  enabled: true'
  $add += '  intervalSeconds: 10'
  $add += '  watchVisionProxy: false'
}
if (-not $doc.Contains('web_settings_namespaces:')) {
  $add += ''
  $add += '# web-ui-settings bridge allowlist (rc.6 compatibility)'
  $add += 'web_settings_namespaces:'
  $add += '  - dsh-ssh'
  $add += '  - task-board'
  $add += '  - remote-web-ui'
  $add += '  - live-stats'
  $add += '  - pet'
  $add += '  - describe-image'
  $add += '  - skin-background'
  $add += '  - community-plugins'
  $add += '  - watchdog'
}
if ($add.Count -gt 0) {
  $newDoc = $doc.TrimEnd("`r", "`n") + "`n" + ($add -join "`n") + "`n"
  [System.IO.File]::WriteAllText($settingsFile, $newDoc, (New-Object System.Text.UTF8Encoding($false)))
  Write-Host '  settings.yaml appended'
} else {
  Write-Host '  settings.yaml already has both sections'
}

Write-Host ''
Write-Host '===================================================='
Write-Host 'Install done. Next steps:'
Write-Host '  1. (optional) re-apply the [dsh-mod] image-analysis patch:'
Write-Host '     see skills/dsh-guardian/resources/patches/dsh-mod-block.js.txt and SKILL.md section 5'
Write-Host '  2. Restart DSH (close the shortcut window, reopen the shortcut).'
Write-Host '  3. Verify: settings -> Plugins -> Plugin configuration -> watchdog card;'
Write-Host '     watchdog.log shows "watchdog v2.1 started"; /rollback-api returns JSON.'
Write-Host '===================================================='
