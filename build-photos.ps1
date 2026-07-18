<#
  build-photos.ps1
  Windows-native equivalent of build-photos.js — no Node.js required.
  Reads every image in images/chroma/, extracts colour data, auto-detects
  what tags it can, and writes photos.json.

  Run:  powershell -File build-photos.ps1
        (or just: .\build-photos.ps1  from an already-open PowerShell)

  Re-running is safe: any tags you have already added in photos.json are
  PRESERVED. New photos get auto tags only.
#>

Add-Type -AssemblyName System.Drawing

$root       = $PSScriptRoot
$chromaDir  = Join-Path $root 'images\chroma'
$thumbDir   = Join-Path $chromaDir 'thumbs'
$outFile    = Join-Path $root 'photos.json'
$exts       = @('.jpg', '.jpeg', '.png', '.webp')
$thumbWidth = 900   # display size in the grid; full image kept for lightbox

if (-not (Test-Path $chromaDir)) {
  Write-Error "No images/chroma/ folder found. Create it and add photos."
  exit 1
}

function ConvertTo-Hsl {
  param($r, $g, $b)
  $rf = $r / 255.0; $gf = $g / 255.0; $bf = $b / 255.0
  $max = [Math]::Max($rf, [Math]::Max($gf, $bf))
  $min = [Math]::Min($rf, [Math]::Min($gf, $bf))
  $l = ($max + $min) / 2
  $h = 0.0; $s = 0.0
  if ($max -ne $min) {
    $d = $max - $min
    $s = if ($l -gt 0.5) { $d / (2 - $max - $min) } else { $d / ($max + $min) }
    if ($max -eq $rf)      { $h = (($gf - $bf) / $d) + $(if ($gf -lt $bf) { 6 } else { 0 }) }
    elseif ($max -eq $gf)  { $h = (($bf - $rf) / $d) + 2 }
    else                   { $h = (($rf - $gf) / $d) + 4 }
    $h *= 60
  }
  return [PSCustomObject]@{ h = $h; s = $s; l = $l }
}

function Get-Thumbnail {
  param($srcImage, $size)
  $bmp = New-Object System.Drawing.Bitmap $size, $size
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.PixelOffsetMode  = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $g.DrawImage($srcImage, 0, 0, $size, $size)
  $g.Dispose()
  return $bmp
}

# Sample a small thumbnail grid and return BOTH the true average colour
# (mean of every sampled pixel) and the peak saturation found. Averaging in
# code is correct; a 1x1 DrawImage in System.Drawing does NOT average and
# collapses most photos to a near-black pixel (the old bug).
function Get-ColourStats {
  param($srcImage, $size = 32)
  $bmp = Get-Thumbnail $srcImage $size
  $rSum = 0.0; $gSum = 0.0; $bSum = 0.0; $n = 0; $peak = 0.0
  for ($y = 0; $y -lt $size; $y++) {
    for ($x = 0; $x -lt $size; $x++) {
      $px = $bmp.GetPixel($x, $y)
      $rSum += $px.R; $gSum += $px.G; $bSum += $px.B; $n++
      $hsl = ConvertTo-Hsl $px.R $px.G $px.B
      if ($hsl.s -gt $peak) { $peak = $hsl.s }
    }
  }
  $bmp.Dispose()
  return [PSCustomObject]@{
    r = [Math]::Round($rSum / $n)
    g = [Math]::Round($gSum / $n)
    b = [Math]::Round($bSum / $n)
    peak = $peak
  }
}

# Save a width-constrained JPEG thumbnail. Returns the thumb's web path,
# or the original src if the image is already small enough.
function Save-Thumbnail {
  param($srcImage, $name, $src)
  if ($srcImage.Width -le $thumbWidth) { return $src }
  $ratio = $thumbWidth / $srcImage.Width
  $tw = $thumbWidth
  $th = [int][Math]::Round($srcImage.Height * $ratio)
  $bmp = New-Object System.Drawing.Bitmap $tw, $th
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.DrawImage($srcImage, 0, 0, $tw, $th)
  $g.Dispose()
  $baseName = [System.IO.Path]::GetFileNameWithoutExtension($name) + '.jpg'
  $outPath = Join-Path $thumbDir $baseName
  # JPEG at ~78% quality
  $enc = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() |
    Where-Object { $_.MimeType -eq 'image/jpeg' }
  $qual = New-Object System.Drawing.Imaging.EncoderParameters 1
  $qual.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter(
    [System.Drawing.Imaging.Encoder]::Quality, [long]78)
  $bmp.Save($outPath, $enc, $qual)
  $bmp.Dispose()
  return 'images/chroma/thumbs/' + $baseName
}

if (-not (Test-Path $thumbDir)) { New-Item -ItemType Directory -Path $thumbDir | Out-Null }

# ---- load existing manifest, to preserve manual tags ----
$existing = @{}
if (Test-Path $outFile) {
  try {
    $prev = Get-Content $outFile -Raw | ConvertFrom-Json
    foreach ($p in $prev.photos) { $existing[$p.src] = $p }
    Write-Host "Found existing photos.json - preserving manual tags for $($prev.photos.Count) photos."
  } catch {
    Write-Warning "Could not parse existing photos.json, starting fresh."
  }
}

$files = Get-ChildItem $chromaDir -File |
  Where-Object { $exts -contains $_.Extension.ToLower() } |
  Sort-Object Name

if (-not $files) {
  Write-Error "No images found in images/chroma/."
  exit 1
}

$photos = @()
foreach ($f in $files) {
  $src = 'images/chroma/' + $f.Name
  try {
    $img = [System.Drawing.Image]::FromFile($f.FullName)
    $w = $img.Width; $h = $img.Height

    # true average colour + peak saturation from a 32x32 sample grid
    $stats = Get-ColourStats $img 32
    $peak = $stats.peak

    # web-sized thumbnail the grid will actually load
    $thumb = Save-Thumbnail $img $f.Name $src

    $img.Dispose()

    $hsl = ConvertTo-Hsl $stats.r $stats.g $stats.b

    # Auto tags. Thresholds kept conservative so real photography isn't
    # over-tagged. 'night' also requires the image not be vivid (a dark but
    # saturated sunset shouldn't read as night).
    $auto = @()
    if ($peak -lt 0.10)                        { $auto += 'black & white' }
    if ($hsl.l -lt 0.18 -and $peak -lt 0.45)   { $auto += 'night' }
    if ($hsl.l -gt 0.78)                        { $auto += 'bright' }

    $manualTags = @()
    $alt = ''
    if ($existing.ContainsKey($src)) {
      $prevPhoto = $existing[$src]
      $prevAuto = @()
      if ($prevPhoto.PSObject.Properties['_auto']) { $prevAuto = @($prevPhoto._auto) }
      if ($prevPhoto.PSObject.Properties['tags']) {
        $manualTags = @($prevPhoto.tags | Where-Object { $prevAuto -notcontains $_ })
      }
      if ($prevPhoto.PSObject.Properties['alt']) { $alt = $prevPhoto.alt }
    }
    $tags = @($auto + $manualTags | Select-Object -Unique)

    $photos += [PSCustomObject][ordered]@{
      src     = $src
      thumb   = $thumb
      w       = $w
      h       = $h
      hue     = [Math]::Round($hsl.h)
      light   = [Math]::Round($hsl.l, 3)
      sat     = [Math]::Round($hsl.s, 3)
      peakSat = [Math]::Round($peak, 3)
      bw      = ($peak -lt 0.12)
      alt     = $alt
      tags    = $tags
      _auto   = $auto
    }
    Write-Host -NoNewline "."
  } catch {
    Write-Warning "`nSkipped $($f.Name): $_"
  }
}

# ---- rainbow sort: hue bands, dark->light within each ----
# Greyscale (bw) photos have no meaningful hue, so they form their own
# band at the end, sorted dark->light.
$photos = $photos | Sort-Object `
  @{ Expression = { [int]$_.bw } }, `
  @{ Expression = { if ($_.bw) { $_.light } else { $_.hue } } }, `
  @{ Expression = { $_.light } }

# ---- collect the full tag vocabulary for the filter UI ----
$vocab = @($photos | ForEach-Object { $_.tags } | Select-Object -Unique | Sort-Object)

$out = [ordered]@{
  generated = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ss.fffZ")
  count     = $photos.Count
  tags      = $vocab
  photos    = $photos
}

$json = $out | ConvertTo-Json -Depth 6
# write without a BOM — a leading BOM breaks JSON.parse() in the browser
[System.IO.File]::WriteAllText($outFile, $json, (New-Object System.Text.UTF8Encoding($false)))

Write-Host "`n`nWrote $outFile"
Write-Host "  $($photos.Count) photos, sorted rainbow-by-hue."
Write-Host "  Tags in use: $($vocab -join ', ')"
Write-Host "`nNext: open photos.json and add tags like `"sky`", `"people`","
Write-Host "`"event`", `"animals`" to the `"tags`" array of any photo."
Write-Host "Re-run anytime - your manual tags are kept."
