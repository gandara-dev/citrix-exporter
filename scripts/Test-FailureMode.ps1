[CmdletBinding()]
param(
    [ValidateRange(1, 60)][int]$Attempts = 15,
    [ValidateRange(1, 30)][int]$RetryDelaySeconds = 2,
    [ValidateRange(1024, 65535)][int]$Port = 9188
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$containerName = 'citrix-exporter-failure-test'

$imageId = (& docker compose images --quiet exporter).Trim()
if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($imageId)) {
    throw 'Build the Compose exporter image before running the failure-mode test.'
}

& docker rm --force $containerName 2>$null | Out-Null
& docker run --rm --detach `
    --name $containerName `
    --publish "${Port}:9187" `
    $imageId `
    -ListenAddress 0.0.0.0 `
    -Port 9187 `
    -Simulation `
    -InjectFailureSource Broker | Out-Null
if ($LASTEXITCODE -ne 0) {
    throw 'Could not start the failure-mode exporter container.'
}

try {
    $response = $null
    for ($attempt = 1; $attempt -le $Attempts; $attempt++) {
        try {
            $response = Invoke-WebRequest `
                -Uri "http://127.0.0.1:$Port/metrics" `
                -TimeoutSec 5
            break
        }
        catch {
            if ($attempt -eq $Attempts) { throw }
            Start-Sleep -Seconds $RetryDelaySeconds
        }
    }

    if ($response.StatusCode -ne 200) {
        throw "Expected HTTP 200, received $($response.StatusCode)."
    }
    if ($response.Content -notmatch '(?m)^citrix_exporter_scrape_success 0$') {
        throw 'The exporter did not publish scrape_success 0.'
    }
    if ($response.Content -notmatch '(?m)^citrix_exporter_scrape_errors_total 1$') {
        throw 'The exporter did not increment its error counter.'
    }
    if ($response.Content -match '(?m)^citrix_(vdas|sessions|licenses|mcs_catalog)') {
        throw 'Citrix data metrics must be omitted after a failed collection.'
    }

    $health = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/health" -TimeoutSec 5
    if ($health.status -ne 'ok') {
        throw "Unexpected liveness status: $($health.status)"
    }

    [pscustomobject]@{
        HttpStatus = $response.StatusCode
        Health = $health.status
        ScrapeSuccess = 0
        ErrorCounter = 1
        CitrixDataOmitted = $true
    }
}
finally {
    & docker rm --force $containerName 2>$null | Out-Null
}
