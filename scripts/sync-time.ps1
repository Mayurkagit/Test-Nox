# Set this PC's clock to the exact time and keep it synced. Run it on every booking PC.
#
# Easiest: double-click sync-time.cmd next to this file (it asks for admin).
# Or, in PowerShell: powershell -ExecutionPolicy Bypass -File sync-time.ps1
#
# What it does:
#  1. Time zone -> India Standard Time (TIMED reads the local clock).
#  2. Windows Time service on, synced from time.google.com / time.windows.com,
#     set to step the clock at once instead of bending it slowly.
#  3. Measures the real offset (internet time servers over NTP; if UDP 123 is
#     blocked, the booking server's clock over HTTPS) and sets the clock
#     directly, to the millisecond. Checks again afterwards.

$ErrorActionPreference = 'Continue'
$WorkerTime = 'https://dda-engine.asmrahul17.workers.dev/time'

# Needs administrator: restart itself elevated if it isn't
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole(
  [Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
  Write-Host 'Asking for administrator rights...' -ForegroundColor Yellow
  try {
    Start-Process powershell.exe -Verb RunAs -ArgumentList @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', "`"$PSCommandPath`"")
  } catch {
    Write-Host 'Administrator rights were refused. Nothing was changed.' -ForegroundColor Red
    Read-Host 'Press Enter to close'
  }
  exit
}

function Step($text) { Write-Host "`n== $text" -ForegroundColor Cyan }

# NTP offset against time.google.com in seconds (positive: PC is behind), or $null
function Get-NtpOffset {
  $out = w32tm /stripchart /computer:time.google.com /samples:3 /dataonly 2>$null
  $vals = @()
  foreach ($line in $out) {
    if ($line -match ',\s*([+-]\d+\.\d+)s') { $vals += [double]$Matches[1] }
  }
  if ($vals.Count -eq 0) { return $null }
  return ($vals | Sort-Object)[[int][math]::Floor($vals.Count / 2)]
}

# Offset against the booking server's clock over HTTPS (best of 5 by round trip), or $null
function Get-HttpOffset {
  try { [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12 } catch {}
  $best = $null
  for ($i = 0; $i -lt 5; $i++) {
    try {
      $t0 = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
      $r = Invoke-RestMethod -Uri "$WorkerTime`?r=$i" -TimeoutSec 5 -Headers @{ 'Cache-Control' = 'no-store' }
      $t1 = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
      if ($r.now -is [long] -or $r.now -is [int] -or $r.now -is [double]) {
        $rtt = $t1 - $t0
        $off = ([double]$r.now - ($t0 + $t1) / 2) / 1000
        if ($i -gt 0 -and ($null -eq $best -or $rtt -lt $best.Rtt)) { $best = @{ Off = $off; Rtt = $rtt } }
      }
    } catch {}
  }
  if ($null -eq $best) { return $null }
  return $best.Off
}

# Offset from NTP, else HTTPS: @{ Off = seconds; Src = 'NTP'/'HTTPS' } or $null
function Get-Offset {
  $o = Get-NtpOffset
  if ($null -ne $o) { return @{ Off = $o; Src = 'internet time (NTP)' } }
  $o = Get-HttpOffset
  if ($null -ne $o) { return @{ Off = $o; Src = 'booking server (HTTPS)' } }
  return $null
}

function Show-Offset($label, $m) {
  if ($null -eq $m) {
    Write-Host "$label could not measure: no internet time and no booking server reachable" -ForegroundColor Red
    return
  }
  $abs = [math]::Abs($m.Off)
  $dir = if ($m.Off -lt 0) { 'AHEAD of' } else { 'BEHIND' }
  $color = if ($abs -lt 0.1) { 'Green' } else { 'Yellow' }
  Write-Host ("{0} this PC is {1:N3} s {2} real time  (measured against {3})" -f $label, $abs, $dir, $m.Src) -ForegroundColor $color
}

Step 'Time zone'
$tz = (Get-TimeZone).Id
if ($tz -ne 'India Standard Time') {
  Write-Host "Was: $tz  ->  setting India Standard Time" -ForegroundColor Yellow
  tzutil /s "India Standard Time"
} else {
  Write-Host 'India Standard Time (OK)' -ForegroundColor Green
}

Step 'Clock before'
$before = Get-Offset
Show-Offset 'Before:' $before

Step 'Windows Time service: on, internet servers, step the clock at once'
if (-not (Get-Service w32time -ErrorAction SilentlyContinue)) {
  Write-Host 'Windows Time service is missing; registering it...'
  w32tm /register | Out-Host
}
sc.exe config w32time start= auto | Out-Null
net start w32time 2>$null | Out-Null
# Step (not slowly bend) any error over 1 s, and accept any size of correction
$cfg = 'HKLM:\SYSTEM\CurrentControlSet\Services\W32Time\Config'
Set-ItemProperty -Path $cfg -Name MaxAllowedPhaseOffset -Value 1 -Type DWord -ErrorAction SilentlyContinue
Set-ItemProperty -Path $cfg -Name MaxPosPhaseCorrection -Value 0xFFFFFFFF -Type DWord -ErrorAction SilentlyContinue
Set-ItemProperty -Path $cfg -Name MaxNegPhaseCorrection -Value 0xFFFFFFFF -Type DWord -ErrorAction SilentlyContinue
w32tm /config /manualpeerlist:"time.google.com,0x8 time.windows.com,0x8" /syncfromflags:manual /reliable:no /update | Out-Null
net stop w32time 2>$null | Out-Null
net start w32time 2>$null | Out-Null
Start-Sleep -Seconds 3
$res = (w32tm /resync /rediscover) -join ' '
if ($res -match 'completed successfully') { Write-Host 'Windows Time synced.' -ForegroundColor Green }
else { Write-Host "Windows Time: $res" -ForegroundColor Yellow }

Step 'Set the clock exactly'
$after = $null
for ($i = 1; $i -le 3; $i++) {
  $m = Get-Offset
  if ($null -eq $m) { break }
  if ([math]::Abs($m.Off) -lt 0.05) { $after = $m; break }
  Write-Host ("Correcting by {0:+0.000;-0.000} s (from {1})" -f $m.Off, $m.Src)
  Set-Date -Adjust ([TimeSpan]::FromMilliseconds([math]::Round($m.Off * 1000))) | Out-Null
  Start-Sleep -Milliseconds 500
}
if ($null -eq $after) { $after = Get-Offset }

Step 'Clock after'
Show-Offset 'After:' $after
$srv = Get-HttpOffset
if ($null -ne $srv) {
  Write-Host ("Booking server check: this PC is {0:N3} s {1} the booking server" -f [math]::Abs($srv), $(if ($srv -lt 0) { 'ahead of' } else { 'behind' }))
}
Write-Host ("Now on this PC: {0:dd MMM yyyy  HH:mm:ss.fff}  ({1})" -f (Get-Date), (Get-TimeZone).Id)

Write-Host ''
if ($null -ne $after -and [math]::Abs($after.Off) -lt 0.1) {
  Write-Host 'DONE: this PC is on the right time and Windows will keep it synced.' -ForegroundColor Green
} elseif ($null -eq $after) {
  Write-Host 'NOT SET: no time source reachable. Check the internet connection and run this again.' -ForegroundColor Red
} else {
  Write-Host 'Still off. Run this again; if it stays off, send a photo of this window.' -ForegroundColor Yellow
}
Write-Host ''
Read-Host 'Press Enter to close'
