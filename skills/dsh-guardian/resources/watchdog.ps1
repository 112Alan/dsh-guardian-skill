# DSH watchdog v2 (2026-08-17) - ASCII safe
#
# Duties:
#   1. Interval, enable switch and optional vision-proxy fallback are read from
#      the watchdog: section of ~/.dsh/settings.yaml (editable from the DSH
#      settings card; re-read every loop, so changes apply immediately).
#   2. If DSH dies (port 3080 down and no dsh process) it is restarted
#      automatically, throttled to once per 30 seconds.
#   3. Intentional stop: when watchdog.stop exists and DSH is down, remove the
#      marker and exit WITHOUT restarting (the dsh-watchdog plugin writes the
#      marker for /dsh-stop or GUI shutdown).
#   4. Parent-process mode:
#      - spawned by start-dsh.cmd (console cmd): exit when the console closes;
#      - spawned by the dsh-watchdog plugin (node parent) or with -Detached:
#        never exit on parent death, restart on crash.
#   5. Single instance guard (watchdog.pid), log to watchdog.log.
param(
  [switch]$Detached
)

$dir        = 'C:\Users\16021\AppData\Local\dsh'
$lock       = Join-Path $dir 'watchdog.pid'
$log        = Join-Path $dir 'watchdog.log'
$stopMarker = Join-Path $dir 'watchdog.stop'
$settings   = Join-Path $env:USERPROFILE '.dsh\settings.yaml'
$outLog     = Join-Path $dir 'web.log'
$errLog     = Join-Path $dir 'web.err.log'
$shim       = Join-Path $env:APPDATA 'npm\dsh.cmd'
$visionScript = Join-Path $dir 'vision-restart.ps1'
$myPid      = $PID

function Write-Log([string]$msg) {
  try {
    ("{0}  {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $msg) | Add-Content -LiteralPath $log
  } catch {}
}

# ---------- single instance guard ----------
try {
  if (Test-Path -LiteralPath $lock) {
    $old = [int](Get-Content -LiteralPath $lock -Raw)
    if (Get-Process -Id $old -ErrorAction SilentlyContinue) { exit }
  }
  Set-Content -LiteralPath $lock -Value $myPid
} catch {}

# ---------- read settings ----------
function Read-WatchdogSettings {
  $enabled = $true
  $interval = 10
  $watchVision = $false
  if (Test-Path -LiteralPath $settings) {
    $inSection = $false
    foreach ($line in (Get-Content -LiteralPath $settings)) {
      if ($line -match '^watchdog:\s*$') { $inSection = $true; continue }
      if ($inSection) {
        if ($line -match '^[^\s#]') {
          $inSection = $false
        } elseif ($line -match '^\s+enabled:\s*(true|false)') {
          $enabled = ($Matches[1] -eq 'true')
        } elseif ($line -match '^\s+intervalSeconds:\s*(\d+)') {
          $interval = [int]$Matches[1]
        } elseif ($line -match '^\s+watchVisionProxy:\s*(true|false)') {
          $watchVision = ($Matches[1] -eq 'true')
        }
      }
    }
  }
  if ($interval -lt 2) { $interval = 2 }
  if ($interval -gt 300) { $interval = 300 }
  [pscustomobject]@{ Enabled = $enabled; Interval = $interval; WatchVision = $watchVision }
}

$cfg = Read-WatchdogSettings
if (-not $cfg.Enabled) {
  Write-Log 'watchdog disabled by settings (watchdog.enabled=false); exiting'
  exit
}

# ---------- parent process mode ----------
$consoleMode = $true
try {
  $parent = (Get-CimInstance Win32_Process -Filter "ProcessId=$myPid" -ErrorAction Stop).ParentProcessId
  if ($parent -eq 0) { exit }
  $parentName = (Get-Process -Id $parent -ErrorAction SilentlyContinue).ProcessName
  if ($Detached -or $parentName -eq 'node' -or $parentName -eq 'nodejs') { $consoleMode = $false }
} catch {
  $consoleMode = $false
}

Write-Log ("watchdog v2 started (pid " + $myPid + ", interval " + $cfg.Interval + "s, consoleMode=" + $consoleMode + ")")

# ---------- port probe ----------
function Test-PortOpen([int]$port) {
  $up = $false
  $t = New-Object System.Net.Sockets.TcpClient
  try {
    $iar = $t.BeginConnect('127.0.0.1', $port, $null, $null)
    $ok = $iar.AsyncWaitHandle.WaitOne(1500)
    if ($ok) { $t.EndConnect($iar); $up = $true }
  } catch { $up = $false }
  try { $t.Close() } catch {}
  return $up
}

$lastRestart = 0
$lastVisionRestart = 0
while ($true) {
  Start-Sleep -Seconds $cfg.Interval
  # re-read settings every loop so card edits apply immediately
  $cfg = Read-WatchdogSettings
  if (-not $cfg.Enabled) {
    Write-Log 'watchdog disabled by settings during run; exiting'
    exit
  }

  # console mode: parent gone = user closed the DSH window => exit
  if ($consoleMode) {
    try {
      $parent = (Get-CimInstance Win32_Process -Filter "ProcessId=$myPid" -ErrorAction Stop).ParentProcessId
    } catch { exit }
    if ($parent -eq 0) { exit }
    if (-not (Get-Process -Id $parent -ErrorAction SilentlyContinue)) { exit }
  }

  $up = Test-PortOpen 3080
  $dshProc = Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -match 'dsh' }

  if (-not $up -and -not $dshProc) {
    # intentional stop marker: user stopped DSH on purpose => no restart
    if (Test-Path -LiteralPath $stopMarker) {
      Remove-Item -LiteralPath $stopMarker -Force -ErrorAction SilentlyContinue
      Write-Log 'intentional stop marker found; dsh not restarted; watchdog exits'
      exit
    }
    $now = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
    if ($now - $lastRestart -ge 30) {
      Write-Log ('restart dsh at ' + (Get-Date -Format s))
      $lastRestart = $now
      Start-Process -FilePath $shim -ArgumentList 'web' -WindowStyle Hidden `
        -RedirectStandardOutput $outLog -RedirectStandardError $errLog
    }
  }

  # optional vision proxy (8083) fallback; restart command in vision-restart.ps1
  if ($cfg.WatchVision -and -not (Test-PortOpen 8083) -and (Test-Path -LiteralPath $visionScript)) {
    $now = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
    if ($now - $lastVisionRestart -ge 60) {
      Write-Log ('vision proxy (8083) down; restarting at ' + (Get-Date -Format s))
      $lastVisionRestart = $now
      Start-Process powershell -ArgumentList '-NoProfile','-ExecutionPolicy','Bypass','-WindowStyle','Hidden','-File',$visionScript `
        -WindowStyle Hidden
    }
  }
}
