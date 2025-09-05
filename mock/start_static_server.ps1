
param(
  [string]$SiteDir = "C:\draftboard",
  [int]$Port = 5172
)

if (-not (Test-Path -LiteralPath $SiteDir)) {
  Write-Error "SiteDir not found: $SiteDir"
  exit 1
}

# Try 'py' first (Windows launcher), then 'python'
$python = $null
try { & py -V *> $null; if ($LASTEXITCODE -eq 0) { $python = "py" } } catch {}
if (-not $python) { try { & python -V *> $null; if ($LASTEXITCODE -eq 0) { $python = "python" } } catch {} }

if (-not $python) {
  Write-Error "Python not found. Install Python (Microsoft Store is fine) and try again."
  exit 1
}

Write-Host "Serving $SiteDir on http://localhost:$Port ... (Ctrl+C to stop)"
Push-Location -LiteralPath $SiteDir
& $python -m http.server $Port
Pop-Location
