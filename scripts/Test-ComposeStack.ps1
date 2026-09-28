[CmdletBinding()]
param(
    [ValidateRange(1, 60)][int]$Attempts = 15,
    [ValidateRange(1, 30)][int]$RetryDelaySeconds = 2
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Invoke-WithRetry {
    param(
        [Parameter(Mandatory)][string]$Description,
        [Parameter(Mandatory)][scriptblock]$Operation,
        [Parameter(Mandatory)][int]$MaxAttempts,
        [Parameter(Mandatory)][int]$DelaySeconds
    )

    $lastError = $null
    for ($attempt = 1; $attempt -le $MaxAttempts; $attempt++) {
        try {
            return & $Operation
        }
        catch {
            $lastError = $_
            if ($attempt -lt $MaxAttempts) {
                Start-Sleep -Seconds $DelaySeconds
            }
        }
    }

    throw "$Description failed after $MaxAttempts attempts: $($lastError.Exception.Message)"
}

$retryParameters = @{
    MaxAttempts = $Attempts
    DelaySeconds = $RetryDelaySeconds
}

$landing = Invoke-WithRetry -Description 'Exporter landing page' @retryParameters -Operation {
    $response = Invoke-WebRequest -Uri 'http://localhost:9187/' -TimeoutSec 5
    if ($response.StatusCode -ne 200 -or $response.Content -notmatch 'Citrix Exporter') {
        throw 'Unexpected landing-page response.'
    }
    $response
}

$health = Invoke-WithRetry -Description 'Exporter health endpoint' @retryParameters -Operation {
    $response = Invoke-RestMethod -Uri 'http://localhost:9187/health' -TimeoutSec 5
    if ($response.status -ne 'ok') {
        throw "Unexpected health status: $($response.status)"
    }
    $response
}

$metrics = Invoke-WithRetry -Description 'Exporter metrics endpoint' @retryParameters -Operation {
    $content = (Invoke-WebRequest -Uri 'http://localhost:9187/metrics' -TimeoutSec 10).Content
    if ($content -notmatch '(?m)^citrix_exporter_scrape_success 1$') {
        throw 'The synthetic Citrix collection did not succeed.'
    }
    $content
}

# Fetch and validate inside the Compose network. Piping a multiline .NET string
# from Windows PowerShell adds a trailing CRLF that promtool interprets as an
# invalid metric line.
& docker compose exec -T prometheus sh -c `
    'wget -qO- http://exporter:9187/metrics | promtool check metrics'
if ($LASTEXITCODE -ne 0) {
    throw "promtool rejected the exporter exposition (exit code $LASTEXITCODE)."
}

$prometheus = Invoke-WithRetry -Description 'Prometheus target query' @retryParameters -Operation {
    $response = Invoke-RestMethod `
        -Uri 'http://localhost:9090/api/v1/query?query=up%7Bjob%3D%22citrix-exporter%22%7D' `
        -TimeoutSec 5
    if ($response.status -ne 'success' -or
        @($response.data.result).Count -eq 0 -or
        $response.data.result[0].value[1] -ne '1') {
        throw 'Prometheus has not recorded the exporter target as up.'
    }
    $response
}

$dashboard = Invoke-WithRetry -Description 'Grafana dashboard lookup' @retryParameters -Operation {
    $response = Invoke-RestMethod `
        -Uri 'http://localhost:3000/api/search?query=Citrix' `
        -TimeoutSec 5
    $match = $response |
        Where-Object {
            $_.PSObject.Properties.Name -contains 'uid' -and
            $_.uid -eq 'citrix-vdi-overview'
        } |
        Select-Object -First 1
    if ($null -eq $match) {
        throw 'The Citrix VDI Overview dashboard is not provisioned.'
    }
    $match
}

[pscustomobject]@{
    Exporter = if ($landing.StatusCode -eq 200) { 'Healthy' } else { 'Failed' }
    Health = $health.status
    Metrics = 'Valid'
    MetricLines = @($metrics -split "`n").Count
    PrometheusTarget = $prometheus.data.result[0].value[1]
    GrafanaDashboard = $dashboard.uid
}
