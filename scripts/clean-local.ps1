param(
  [switch]$Force
)

$ErrorActionPreference = "Stop"

function Format-ByteSize {
  param([long]$Bytes)

  if ($Bytes -ge 1GB) { return "{0:N2} GB" -f ($Bytes / 1GB) }
  if ($Bytes -ge 1MB) { return "{0:N2} MB" -f ($Bytes / 1MB) }
  if ($Bytes -ge 1KB) { return "{0:N2} KB" -f ($Bytes / 1KB) }
  return "$Bytes B"
}

$projectRoot = [System.IO.Path]::GetFullPath((Split-Path -Parent $PSScriptRoot)).TrimEnd("\")
$relativeTargets = @(
  ".wrangler",                    # Wrangler local state, including local D1 data
  "frontend\node_modules\.vite", # Vite dependency cache
  "frontend\dist",               # Frontend build output
  "node_modules\.cache",         # Optional root package cache
  "frontend\node_modules\.cache" # Optional frontend package cache
)

$targets = foreach ($relativePath in $relativeTargets) {
  $fullPath = [System.IO.Path]::GetFullPath((Join-Path $projectRoot $relativePath))
  if (-not $fullPath.StartsWith($projectRoot + "\", [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Refusing to clean a path outside the project: $fullPath"
  }

  [PSCustomObject]@{
    RelativePath = $relativePath
    FullPath = $fullPath
  }
}

Write-Host "DNSHE Manager local cleanup" -ForegroundColor Cyan
Write-Host "Project: $projectRoot"
Write-Host "Remote Cloudflare D1 will not be modified." -ForegroundColor Green
Write-Host "Local D1 data under .wrangler will be permanently deleted." -ForegroundColor Yellow
Write-Host ""

if (-not $Force) {
  $confirmation = Read-Host "Type CLEAN to continue"
  if ($confirmation -cne "CLEAN") {
    Write-Host "Cleanup cancelled."
    exit 0
  }
}

$removedCount = 0
$removedBytes = 0L

foreach ($target in $targets) {
  if (-not (Test-Path -LiteralPath $target.FullPath)) {
    Write-Host "[skip]   $($target.RelativePath)"
    continue
  }

  $size = (Get-ChildItem -LiteralPath $target.FullPath -Recurse -Force -File -ErrorAction SilentlyContinue |
    Measure-Object -Property Length -Sum).Sum
  if ($null -eq $size) { $size = 0L }

  try {
    Remove-Item -LiteralPath $target.FullPath -Recurse -Force
  } catch {
    throw "Failed to remove $($target.RelativePath). Stop local dev servers and try again. $($_.Exception.Message)"
  }

  if (Test-Path -LiteralPath $target.FullPath) {
    throw "Cleanup verification failed: $($target.FullPath) still exists."
  }

  $removedCount++
  $removedBytes += [long]$size
  Write-Host "[removed] $($target.RelativePath) ($(Format-ByteSize ([long]$size)))" -ForegroundColor DarkGray
}

Write-Host ""
Write-Host "Cleanup complete: $removedCount target(s), $(Format-ByteSize $removedBytes) removed." -ForegroundColor Green
