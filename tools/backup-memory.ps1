# ===========================================================================
#  Backup project memory to another physical disk.
#
#  What it backs up
#    .project-notes/        knowledge docs (architecture / pitfalls / choices)
#    .dsh-project-memory/   local memory store (insights + code index)
#
#  Why a separate disk
#    Both folders are gitignored (the repo is PUBLIC, these notes are not),
#    so they exist on exactly one disk. On this machine D: and F: are two
#    different physical SSDs -- copying D: -> F: survives one disk dying.
#
#  IMPORTANT: this file must stay pure ASCII.
#    Windows PowerShell 5.1 decodes BOM-less UTF-8 using the system ANSI code
#    page (936/GBK on a Chinese system) and would turn non-ASCII into mojibake,
#    which then breaks the parser in confusing ways.
#
#  Usage
#    powershell -ExecutionPolicy Bypass -File tools\backup-memory.ps1
#    powershell -ExecutionPolicy Bypass -File tools\backup-memory.ps1 -Dest "E:\other"
#    double-click  ..\backup-memory.cmd
# ===========================================================================

[CmdletBinding()]
param(
  [string]$Dest = 'F:\blog-memory-backup',
  [switch]$Quiet
)

$ErrorActionPreference = 'Stop'

$RepoRoot = Split-Path -Parent $PSScriptRoot
$Folders  = @('.project-notes', '.dsh-project-memory')
$Stamp    = Get-Date -Format 'yyyy-MM-dd_HHmm'

function Say($msg, $color = 'Gray') {
  if (-not $Quiet) { Write-Host $msg -ForegroundColor $color }
}

Say ''
Say '==============================================================' 'Cyan'
Say ' Backup project memory' 'Cyan'
Say '==============================================================' 'Cyan'
Say ("  Source : " + $RepoRoot)
Say ("  Dest   : " + $Dest)
Say ("  Stamp  : " + $Stamp)

# --- sanity: source folders exist -----------------------------------------
$found = @()
foreach ($f in $Folders) {
  if (Test-Path (Join-Path $RepoRoot $f)) { $found += $f }
  else { Say ("  [WARN] missing source folder: " + $f) 'Yellow' }
}
if ($found.Count -eq 0) {
  Say ''
  Say '  [FAIL] nothing to back up. Run this from inside the blog repo.' 'Red'
  exit 1
}

# --- sanity: destination drive exists -------------------------------------
$drive = $null
if ($Dest -match '^([A-Za-z]):') { $drive = $Matches[1].ToUpper() + ':' }
if ($drive -and -not (Test-Path ($drive + '\'))) {
  Say ''
  Say ("  [FAIL] drive " + $drive + " is not available. Plug it in, or pass -Dest <path>.") 'Red'
  exit 1
}

# --- create layout ---------------------------------------------------------
#   <Dest>\<folder>            latest copy, easy to read
#   <Dest>\snapshots\<stamp>\  point-in-time copy, survives a bad edit
foreach ($f in $found) {
  New-Item -ItemType Directory -Path (Join-Path $Dest $f) -Force | Out-Null
  New-Item -ItemType Directory -Path (Join-Path $Dest ('snapshots\' + $Stamp + '\' + $f)) -Force | Out-Null
}

# --- copy ------------------------------------------------------------------
Say ''
Say '--- copying ---'
foreach ($f in $found) {
  $from = Join-Path $RepoRoot $f
  foreach ($to in @((Join-Path $Dest $f), (Join-Path $Dest ('snapshots\' + $Stamp + '\' + $f)))) {
    # /E copy subdirs including empty ones; never delete anything on the target
    & robocopy $from $to /E /NFL /NDL /NJH /NJS /NP /R:1 /W:1 | Out-Null
    $code = $LASTEXITCODE
    # robocopy: 0-7 mean success, >=8 means failure
    $ok = $code -lt 8
    $mark = if ($ok) { '[ OK ]' } else { '[FAIL]' }
    Say ("  " + $mark + " " + $f + "  ->  " + $to.Replace($Dest, '.')) $(if ($ok) { 'Gray' } else { 'Red' })
    if (-not $ok) { Say ("         robocopy exit code " + $code) 'Red' }
  }
}

# --- verify: file count and total bytes must match -------------------------
Say ''
Say '--- verify ---'
$allGood = $true
foreach ($f in $found) {
  $a = Get-ChildItem (Join-Path $RepoRoot $f) -Recurse -File -ErrorAction SilentlyContinue
  $b = Get-ChildItem (Join-Path $Dest $f)     -Recurse -File -ErrorAction SilentlyContinue
  $sa = ($a | Measure-Object Length -Sum).Sum
  $sb = ($b | Measure-Object Length -Sum).Sum
  $same = ($a.Count -eq $b.Count) -and ($sa -eq $sb)
  if (-not $same) { $allGood = $false }
  Say ("  " + $(if ($same) { '[ OK ]' } else { '[FAIL]' }) + " " + $f.PadRight(22) +
       " src " + $a.Count + " files / " + $sa + " bytes" +
       "   backup " + $b.Count + " files / " + $sb + " bytes") $(if ($same) { 'Gray' } else { 'Red' })
}

# --- note file -------------------------------------------------------------
$note = @()
$note += '# Project memory backup'
$note += ''
$note += ('Last run: ' + (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'))
$note += ('Source  : ' + $RepoRoot)
$note += ''
$note += '## What is here'
$note += ''
$note += '| Path | What |'
$note += '| --- | --- |'
$note += '| `.project-notes/` | Knowledge docs: architecture, pitfalls, conventions, todo |'
$note += '| `.dsh-project-memory/` | Local memory store: insights (with triggers) + code/doc index |'
$note += '| `snapshots/<date>/` | Point-in-time copies, so a bad edit can be rolled back |'
$note += ''
$note += '## How to restore'
$note += ''
$note += 'Copy the two folders back into the blog project root:'
$note += ''
$note += '```'
$note += 'robocopy "' + $Dest + '\.project-notes"      "' + $RepoRoot + '\.project-notes" /E'
$note += 'robocopy "' + $Dest + '\.dsh-project-memory" "' + $RepoRoot + '\.dsh-project-memory" /E'
$note += '```'
$note += ''
$note += 'They are both gitignored, so they never travel with the repo -- this backup is the only copy outside D:.'
$note += ''
$note += '## To refresh'
$note += ''
$note += 'Double-click `backup-memory.cmd` in the blog project root, or run:'
$note += ''
$note += '```'
$note += 'powershell -ExecutionPolicy Bypass -File tools\backup-memory.ps1'
$note += '```'
[System.IO.File]::WriteAllText((Join-Path $Dest 'README.md'), ($note -join "`r`n"), (New-Object System.Text.UTF8Encoding $false))
Say ''
Say ("  wrote " + (Join-Path $Dest 'README.md'))

Say ''
if ($allGood) { Say ' RESULT: backup OK' 'Green' } else { Say ' RESULT: backup has problems (see FAIL above)' 'Red' }
Say ''
if (-not $allGood) { exit 1 }
