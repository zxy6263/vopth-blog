<#
    compress-banner-video.ps1
    ---------------------------------------------------------------------------
    Compress a large wallpaper video into a web-banner-friendly mp4,
    and extract one frame as a poster image.

    WHY
      Wallpaper-site downloads are typically 4K 60fps at 20+ Mbps and 80-100 MB.
      That is far over Cloudflare's per-file limit, so deploying it as-is fails.
      A page banner also never needs 4K60. This script does the conversion.

    PROBLEMS THIS SCRIPT ALREADY HANDLES (all encountered for real)
      * Non-ASCII paths: the local ffmpeg is a 2013 build with poor Unicode path
        support, so the source is first copied to an ASCII-only temp directory.
      * Odd target height: proportional scaling can produce an odd height
        (3840x1450 -> 1920x725). H.264 with yuv420p requires BOTH dimensions to
        be even, otherwise encoding fails outright. Height is rounded down.
      * Old-ffmpeg flag differences: no -hide_banner, no scale=W:-2 (the "-2"
        convenience value did not exist in that build).

    USAGE
      # quick size estimate (encodes a short sample and extrapolates)
      powershell -File tools\compress-banner-video.ps1 -Source "D:\path\to\v.mp4" -Name archive-banner -Estimate

      # real encode
      powershell -File tools\compress-banner-video.ps1 -Source "D:\path\to\v.mp4" -Name archive-banner

      # keep only the first 30 seconds
      powershell -File tools\compress-banner-video.ps1 -Source "..." -Name xxx -Duration 30

    OUTPUT
      source/videos/<Name>.mp4            compressed video
      source/videos/<Name>-poster.jpg     poster frame (used as the banner placeholder)

    IMPORTANT - KEEP THIS FILE ASCII-ONLY
      Windows PowerShell 5.1 decodes BOM-less UTF-8 files as ANSI/GBK. Non-ASCII
      characters in this file would be mis-decoded and can produce stray quotes or
      parentheses that break the parser. Same rule as tools/check-site.ps1.
#>

param(
    [Parameter(Mandatory = $true)][string]$Source,
    [Parameter(Mandatory = $true)][string]$Name,

    [int]$Width = 1920,
    [int]$Fps = 30,
    [int]$Crf = 28,
    [double]$Duration = 0,      # 0 = keep the whole video
    [double]$PosterAt = 3,      # seconds into the video to grab the poster frame
    [int]$EstimateSeconds = 5,  # sample length used by -Estimate
    [switch]$Estimate           # only estimate, do not write the final files
)

$ErrorActionPreference = 'Stop'

# --------------------------------------------------------------------- helpers
function Find-Tool {
    param([string]$ToolName)
    $cmd = Get-Command $ToolName -ErrorAction SilentlyContinue
    if ($cmd) { return $cmd.Source }
    $candidates = @(
        "C:\Users\$env:USERNAME\AppData\Local\Programs\Python\Python310\Scripts\$ToolName.exe",
        "C:\Program Files\ffmpeg\bin\$ToolName.exe"
    )
    foreach ($c in $candidates) { if (Test-Path $c) { return $c } }
    throw "$ToolName not found. Install ffmpeg or add it to PATH."
}

function Invoke-Probe {
    param([string]$Ffprobe, [string]$File, [string]$Entry)
    $out = & $Ffprobe -v error -show_entries $Entry -of "default=noprint_wrappers=1:nokey=1" $File 2>$null
    return ($out | Select-Object -First 1)
}

# ----------------------------------------------------------------------- setup
$ffmpeg   = Find-Tool 'ffmpeg'
$ffprobe  = Find-Tool 'ffprobe'
$repoRoot = Split-Path -Parent $PSScriptRoot
$outDir   = Join-Path $repoRoot 'source\videos'

if (-not (Test-Path -LiteralPath $Source)) { throw "Source file not found: $Source" }
New-Item -ItemType Directory -Path $outDir -Force | Out-Null

$tmpDir = 'D:\video-tmp'
New-Item -ItemType Directory -Path $tmpDir -Force | Out-Null

Write-Host ''
Write-Host '=============================================================='
Write-Host ' compress-banner-video'
Write-Host " source : $Source"
Write-Host " name   : $Name"
Write-Host '=============================================================='
Write-Host ''

# ------------------------------------------- 1. copy to an ASCII-only path
$asciiSrc = Join-Path $tmpDir 'src.mp4'
Write-Host '[1/4] Copying source to an ASCII-only path...'
Copy-Item -LiteralPath $Source -Destination $asciiSrc -Force
$srcSize = (Get-Item $asciiSrc).Length
Write-Host ("      {0} MB" -f [math]::Round($srcSize / 1MB, 2))

# ----------------------------------------------------------- 2. probe source
Write-Host '[2/4] Probing source...'
$sw   = [int](Invoke-Probe $ffprobe $asciiSrc 'stream=width')
$sh   = [int](Invoke-Probe $ffprobe $asciiSrc 'stream=height')
$sdur = [double](Invoke-Probe $ffprobe $asciiSrc 'format=duration')
$srate = [string](Invoke-Probe $ffprobe $asciiSrc 'stream=r_frame_rate')
$sbit = [double](Invoke-Probe $ffprobe $asciiSrc 'format=bit_rate')

Write-Host ("      resolution : {0} x {1}" -f $sw, $sh)
Write-Host ("      duration   : {0} s" -f [math]::Round($sdur, 2))
Write-Host ("      framerate  : {0}" -f $srate)
Write-Host ("      bitrate    : {0} Mbps" -f [math]::Round($sbit / 1000000, 2))

# ------------------------------------------------- 3. compute even dimensions
$targetH = [double]($Width * $sh / $sw)
$evenH   = [int]([math]::Floor($targetH / 2) * 2)
Write-Host '[3/4] Target dimensions...'
Write-Host ("      {0} x {1}   (exact aspect would be {2}; rounded down to even)" -f $Width, $evenH, [math]::Round($targetH, 2))
if ([math]::Abs($targetH - $evenH) -gt 0) {
    Write-Host '      yuv420p requires even width AND height - this rounding is required.'
}

$scaleFilter = "scale=${Width}:${evenH},fps=${Fps}"
if ($Duration -gt 0) { $effDuration = [math]::Min($Duration, $sdur) } else { $effDuration = $sdur }

# --------------------------------------------------------------- estimate
if ($Estimate) {
    Write-Host '[4/4] ESTIMATE mode - encoding a sample...'
    $sampleOut = Join-Path $tmpDir 'sample.mp4'
    if (Test-Path $sampleOut) { Remove-Item $sampleOut -Force }

    $sampleLen = [math]::Min($EstimateSeconds, $sdur)
    # Sample from the MIDDLE of the video, not the start.
    # The opening seconds are often the calmest part, which makes the
    # extrapolation too optimistic - a real file projected 3.95 MB but encoded
    # to 5.48 MB (39% underestimate) when sampling from the beginning.
    $sampleStart = [math]::Max(0, [math]::Round(($sdur - $sampleLen) / 2, 1))
    $swatch = [System.Diagnostics.Stopwatch]::StartNew()
    & $ffmpeg -y -loglevel error -ss $sampleStart -i $asciiSrc -t $sampleLen -vf $scaleFilter -an -c:v libx264 -preset medium -crf $Crf -pix_fmt yuv420p $sampleOut 2>&1 | Out-Null
    $swatch.Stop()

    if (-not (Test-Path $sampleOut) -or (Get-Item $sampleOut).Length -lt 1000) {
        throw 'Sample encode failed - output missing or empty.'
    }

    $sampleSize = (Get-Item $sampleOut).Length
    $projected  = ($sampleSize / $sampleLen) * $effDuration

    Write-Host ''
    Write-Host '      --- ESTIMATE ---'
    Write-Host ("      sample          : {0} s -> {1} KB" -f $sampleLen, [math]::Round($sampleSize / 1KB, 0))
    Write-Host ("      effective rate  : {0} kbps" -f [math]::Round($sampleSize * 8 / 1000 / $sampleLen, 0))
    Write-Host ("      projected total : {0} MB  (for {1} s at crf {2})" -f [math]::Round($projected / 1MB, 2), [math]::Round($effDuration, 1), $Crf)
    Write-Host ("      encode time est : ~{0} s" -f [math]::Round($swatch.Elapsed.TotalSeconds * $effDuration / $sampleLen, 0))
    Write-Host ''
    if ($projected -gt 6MB) {
        Write-Host '      WARNING: that is heavy for a page banner.'
        Write-Host '      Consider -Duration 30 to trim, or a higher -Crf (e.g. 32).'
    }

    Remove-Item $sampleOut -Force -ErrorAction SilentlyContinue
    Remove-Item $asciiSrc -Force -ErrorAction SilentlyContinue
    if (Test-Path $tmpDir) {
        $left = Get-ChildItem $tmpDir -Force -ErrorAction SilentlyContinue
        if (-not $left) { Remove-Item $tmpDir -Force -ErrorAction SilentlyContinue }
    }
    exit 0
}

# ------------------------------------------------------------------ encode
Write-Host '[4/4] Encoding (this takes a while)...'
$finalOut  = Join-Path $outDir "$Name.mp4"
$posterOut = Join-Path $outDir "$Name-poster.jpg"
if (Test-Path $finalOut) { Remove-Item $finalOut -Force }

$encArgs = @('-y', '-loglevel', 'error', '-i', $asciiSrc)
if ($Duration -gt 0) { $encArgs += @('-t', "$effDuration") }
$encArgs += @('-vf', $scaleFilter, '-an', '-c:v', 'libx264', '-preset', 'medium',
              '-crf', "$Crf", '-pix_fmt', 'yuv420p', '-movflags', '+faststart', $finalOut)

$enc = [System.Diagnostics.Stopwatch]::StartNew()
& $ffmpeg @encArgs 2>&1 | Out-Null
$enc.Stop()

if (-not (Test-Path $finalOut) -or (Get-Item $finalOut).Length -lt 10000) {
    Remove-Item $asciiSrc -Force -ErrorAction SilentlyContinue
    throw 'Encode failed - output missing or too small.'
}

$finalSize = (Get-Item $finalOut).Length
Write-Host ("      encoded in {0} s" -f [math]::Round($enc.Elapsed.TotalSeconds, 1))

Write-Host '      extracting poster frame...'
& $ffmpeg -y -loglevel error -ss $PosterAt -i $asciiSrc -vframes 1 -vf "scale=${Width}:${evenH}" -q:v 3 $posterOut 2>&1 | Out-Null
if (-not (Test-Path $posterOut) -or (Get-Item $posterOut).Length -lt 1000) {
    Write-Host '      WARNING: poster extraction failed.'
}

# --------------------------------------------------------------- faststart
$bytes = [System.IO.File]::ReadAllBytes($finalOut)
$probeLen = [math]::Min(2000, $bytes.Length - 1)
$head = [System.Text.Encoding]::ASCII.GetString($bytes[0..$probeLen])
$faststart = $head -match 'moov'

# ------------------------------------------------------------------- summary
Write-Host ''
Write-Host '=============================================================='
Write-Host ' RESULT'
Write-Host '=============================================================='
Write-Host (" video : {0}" -f $finalOut)
Write-Host (" size  : {0} MB   (source {1} MB -> {2}% of original)" -f `
    [math]::Round($finalSize / 1MB, 2), `
    [math]::Round($srcSize / 1MB, 2), `
    [math]::Round($finalSize / $srcSize * 100, 1))
Write-Host (" poster: {0}" -f $posterOut)
Write-Host (" streamable (moov at head): {0}" -f $faststart)
Write-Host ''

# ------------------------------------------------------------------- cleanup
Remove-Item $asciiSrc -Force -ErrorAction SilentlyContinue
if (Test-Path $tmpDir) {
    $left = Get-ChildItem $tmpDir -Force -ErrorAction SilentlyContinue
    if (-not $left) { Remove-Item $tmpDir -Force -ErrorAction SilentlyContinue }
}
