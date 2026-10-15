param([switch]$NoBrowser)
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
$nodeCommand = Get-Command node -ErrorAction Stop
$npmCommand = Get-Command npm.cmd -ErrorAction Stop
$appUrl = 'http://127.0.0.1:4173'
$alreadyRunning = $false
try {
    $response = Invoke-WebRequest -Uri $appUrl -UseBasicParsing -TimeoutSec 2
    $alreadyRunning = $response.Content -match 'Luminol Academy'
} catch { }
if (-not $alreadyRunning) {
    if (-not (Test-Path -LiteralPath (Join-Path $PSScriptRoot 'node_modules'))) {
        & $npmCommand.Source ci --no-fund --no-audit
        if ($LASTEXITCODE -ne 0) { throw 'Dependency installation failed.' }
    }
    if (-not (Test-Path -LiteralPath (Join-Path $PSScriptRoot 'dist\index.html'))) {
        & $npmCommand.Source run build
        if ($LASTEXITCODE -ne 0) { throw 'Build failed.' }
    }
    $runtimeDirectory = Join-Path $PSScriptRoot 'data'
    New-Item -ItemType Directory -Force -Path $runtimeDirectory | Out-Null
    $serverProcess = Start-Process -FilePath $nodeCommand.Source -ArgumentList @('server/index.mjs') -WorkingDirectory $PSScriptRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $runtimeDirectory 'server.log') -RedirectStandardError (Join-Path $runtimeDirectory 'server-error.log') -PassThru
    $serverProcess.Id | Set-Content -LiteralPath (Join-Path $runtimeDirectory 'server.pid')
    $ready = $false
    for ($attempt = 0; $attempt -lt 30; $attempt++) {
        try {
            $response = Invoke-WebRequest -Uri $appUrl -UseBasicParsing -TimeoutSec 1
            if ($response.Content -match 'Luminol Academy') { $ready = $true; break }
        } catch { }
        Start-Sleep -Milliseconds 300
    }
    if (-not $ready) { throw 'The server did not start. Check data/server-error.log or whether port 4173 is already in use.' }
}
Write-Output "Luminol Academy is ready at $appUrl"
if (-not $NoBrowser) { Start-Process $appUrl }
