param(
  [string]$SourceDir = "public/heroes/icons",
  [string]$OutDir = "public/heroes/chip-icons"
)

$ErrorActionPreference = "Stop"

Add-Type -AssemblyName System.Drawing

$canvasSize = 64
$targetMax = 58
$margin = 3
$alphaThreshold = 16

$overrides = @{
  "mo_and_krill.png" = @{ targetMax = 54; offsetX = -1.0; offsetY = 1.0 }
}

function Clamp([double]$Value, [double]$Min, [double]$Max) {
  if ($Max -lt $Min) {
    return $Min
  }
  return [Math]::Min([Math]::Max($Value, $Min), $Max)
}

$sourcePath = Resolve-Path -LiteralPath $SourceDir
$outputPath = New-Item -ItemType Directory -Force -Path $OutDir

Get-ChildItem -LiteralPath $sourcePath -Filter *.png | Sort-Object Name | ForEach-Object {
  $src = [System.Drawing.Bitmap]::FromFile($_.FullName)
  try {
    $minX = $src.Width
    $minY = $src.Height
    $maxX = -1
    $maxY = -1
    [double]$weightedX = 0
    [double]$weightedY = 0
    [double]$weightTotal = 0

    for ($y = 0; $y -lt $src.Height; $y++) {
      for ($x = 0; $x -lt $src.Width; $x++) {
        $pixel = $src.GetPixel($x, $y)
        if ($pixel.A -gt $alphaThreshold) {
          if ($x -lt $minX) { $minX = $x }
          if ($y -lt $minY) { $minY = $y }
          if ($x -gt $maxX) { $maxX = $x }
          if ($y -gt $maxY) { $maxY = $y }
          $weightedX += $x * $pixel.A
          $weightedY += $y * $pixel.A
          $weightTotal += $pixel.A
        }
      }
    }

    if ($maxX -lt 0) {
      return
    }

    $boundsW = $maxX - $minX + 1
    $boundsH = $maxY - $minY + 1
    $settings = $overrides[$_.Name]
    $fitMax = if ($settings -and $settings.targetMax) { [double]$settings.targetMax } else { [double]$targetMax }
    $offsetX = if ($settings -and $settings.offsetX) { [double]$settings.offsetX } else { 0.0 }
    $offsetY = if ($settings -and $settings.offsetY) { [double]$settings.offsetY } else { 0.0 }
    $scale = $fitMax / [Math]::Max($boundsW, $boundsH)
    $drawW = [Math]::Max(1, [int][Math]::Round($boundsW * $scale))
    $drawH = [Math]::Max(1, [int][Math]::Round($boundsH * $scale))
    $centroidX = ($weightedX / $weightTotal) - $minX
    $centroidY = ($weightedY / $weightTotal) - $minY
    $drawX = ($canvasSize / 2) + $offsetX - ($centroidX * $scale)
    $drawY = ($canvasSize / 2) + $offsetY - ($centroidY * $scale)
    $drawX = Clamp $drawX $margin ($canvasSize - $margin - $drawW)
    $drawY = Clamp $drawY $margin ($canvasSize - $margin - $drawH)

    $canvas = New-Object System.Drawing.Bitmap $canvasSize, $canvasSize, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    try {
      $graphics = [System.Drawing.Graphics]::FromImage($canvas)
      try {
        $graphics.Clear([System.Drawing.Color]::Transparent)
        $graphics.CompositingMode = [System.Drawing.Drawing2D.CompositingMode]::SourceOver
        $graphics.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
        $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
        $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
        $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality

        $dest = New-Object System.Drawing.Rectangle ([int][Math]::Round($drawX)), ([int][Math]::Round($drawY)), $drawW, $drawH
        $sourceRect = New-Object System.Drawing.Rectangle $minX, $minY, $boundsW, $boundsH
        $graphics.DrawImage($src, $dest, $sourceRect, [System.Drawing.GraphicsUnit]::Pixel)
      } finally {
        $graphics.Dispose()
      }

      $outFile = Join-Path $outputPath.FullName $_.Name
      $canvas.Save($outFile, [System.Drawing.Imaging.ImageFormat]::Png)
      Write-Host "Generated $($_.Name)"
    } finally {
      $canvas.Dispose()
    }
  } finally {
    $src.Dispose()
  }
}
