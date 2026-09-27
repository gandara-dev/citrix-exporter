[CmdletBinding()]
param(
    [string]$ExporterUri = 'http://127.0.0.1:9187/metrics',
    [string]$OutputPath = (Join-Path $PSScriptRoot 'demo.cast')
)

$ErrorActionPreference = 'Stop'
$metrics = (Invoke-WebRequest -Uri $ExporterUri -TimeoutSec 10).Content

function Find-MetricLine {
    param([Parameter(Mandatory)][string]$Pattern)

    return @($metrics -split "`n" | Where-Object { $_ -match $Pattern })
}

$esc = [char]27
$green = "$esc[32m"
$yellow = "$esc[33m"
$cyan = "$esc[36m"
$dim = "$esc[2m"
$reset = "$esc[0m"
$events = [System.Collections.Generic.List[string]]::new()
$time = 0.0

function Add-DemoFrame {
    param([double]$Delay, [string]$Text)

    $script:time += $Delay
    $events.Add((@($script:time, 'o', $Text) | ConvertTo-Json -Compress))
}

$header = [ordered]@{
    version = 2
    width = 112
    height = 28
    timestamp = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
    env = [ordered]@{ SHELL = 'pwsh'; TERM = 'xterm-256color' }
    title = 'Citrix Exporter demo'
} | ConvertTo-Json -Compress

Add-DemoFrame 0.0 "${cyan}CITRIX EXPORTER${reset}  ${dim}Prometheus metrics without a Citrix lab${reset}`r`n`r`n"
Add-DemoFrame 0.6 "${yellow}PS>${reset} docker compose up --build --detach --wait`r`n"
Add-DemoFrame 0.5 "${green}[+] exporter    Healthy${reset}`r`n"
Add-DemoFrame 0.2 "${green}[+] prometheus  Healthy${reset}`r`n"
Add-DemoFrame 0.2 "${green}[+] grafana     Healthy${reset}`r`n`r`n"
Add-DemoFrame 0.6 "${yellow}PS>${reset} Invoke-WebRequest http://localhost:9187/metrics`r`n"

foreach ($line in Find-MetricLine '^citrix_exporter_scrape_success ') {
    Add-DemoFrame 0.2 "${green}$line${reset}`r`n"
}
foreach ($line in Find-MetricLine '^citrix_vdas\{.*Unregistered') {
    Add-DemoFrame 0.2 "$line`r`n"
}
foreach ($line in Find-MetricLine '^citrix_sessions\{.*state="Active"') {
    Add-DemoFrame 0.2 "$line`r`n"
}
foreach ($line in Find-MetricLine '^citrix_licenses_in_use') {
    Add-DemoFrame 0.2 "$line`r`n"
}
foreach ($line in Find-MetricLine '^citrix_mcs_catalog_machines\{') {
    Add-DemoFrame 0.2 "$line`r`n"
}

Add-DemoFrame 0.8 "`r`n${cyan}Prometheus${reset}  http://localhost:9090  ${green}target UP${reset}`r`n"
Add-DemoFrame 0.4 "${cyan}Grafana${reset}     http://localhost:3000  ${green}dashboard provisioned${reset}`r`n"
Add-DemoFrame 1.8 "`r`n${dim}All names and values are synthetic.${reset}`r`n"

$outputDirectory = Split-Path -Parent $OutputPath
if ($outputDirectory) {
    New-Item -ItemType Directory -Path $outputDirectory -Force | Out-Null
}
@($header) + $events | Set-Content -LiteralPath $OutputPath -Encoding utf8NoBOM
Write-Output "Created asciinema recording: $OutputPath"
