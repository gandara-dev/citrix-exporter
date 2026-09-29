function Write-CitrixHttpResponse {
    param(
        [Parameter(Mandatory)][System.Net.Sockets.NetworkStream]$Stream,
        [Parameter(Mandatory)][int]$StatusCode,
        [Parameter(Mandatory)][string]$ContentType,
        [Parameter(Mandatory)][string]$Body
    )

    $statusText = switch ($StatusCode) {
        200 { 'OK' }
        404 { 'Not Found' }
        405 { 'Method Not Allowed' }
        default { 'Internal Server Error' }
    }
    $bodyBytes = [System.Text.Encoding]::UTF8.GetBytes($Body)
    $header = "HTTP/1.1 $StatusCode $statusText`r`nContent-Type: $ContentType`r`nContent-Length: $($bodyBytes.Length)`r`nConnection: close`r`n`r`n"
    $headerBytes = [System.Text.Encoding]::ASCII.GetBytes($header)
    $Stream.Write($headerBytes, 0, $headerBytes.Length)
    $Stream.Write($bodyBytes, 0, $bodyBytes.Length)
    $Stream.Flush()
}

function Start-CitrixExporter {
    [CmdletBinding(SupportsShouldProcess)]
    param(
        [string]$ListenAddress = '127.0.0.1',

        [ValidateRange(1, 65535)]
        [int]$Port = 9187,

        [switch]$Simulation,

        [ValidateSet('Broker', 'Licensing')]
        [string[]]$InjectFailureSource = @(),

        [string]$AdminAddress,

        [string]$LmstatPath,

        [string]$LicenseServer,

        [string]$ScenarioPath,

        [ValidateRange(0, [int]::MaxValue)]
        [int]$MaxRequests = 0
    )

    $scenario = $null
    if (-not [string]::IsNullOrWhiteSpace($ScenarioPath)) {
        if (-not $Simulation) {
            throw 'ScenarioPath can only be used with -Simulation.'
        }
        $scenario = Get-Content -LiteralPath $ScenarioPath -Raw | ConvertFrom-Json
        # Validate the values once at startup so a bad file fails fast; the
        # failure switches are honored on every scrape instead.
        $probe = $scenario | Select-Object -Property * -ExcludeProperty brokerDown, licensingDown
        $null = Get-SimulatedCitrixSnapshot -Scenario $probe
    }

    if (-not $PSCmdlet.ShouldProcess("${ListenAddress}:$Port", 'Start Citrix Exporter listener')) {
        return
    }

    $ipAddress = [System.Net.IPAddress]::Parse($ListenAddress)
    $listener = [System.Net.Sockets.TcpListener]::new($ipAddress, $Port)
    $errorCount = 0
    $requestCount = 0
    $mode = if ($Simulation) { 'simulation' } else { 'production' }

    $listener.Start()
    Write-Information "Citrix Exporter listening on http://${ListenAddress}:$Port in $mode mode." -InformationAction Continue

    try {
        while ($MaxRequests -eq 0 -or $requestCount -lt $MaxRequests) {
            $client = $listener.AcceptTcpClient()
            $requestCount++
            $stream = $null
            $reader = $null
            try {
                $client.ReceiveTimeout = 5000
                $stream = $client.GetStream()
                $reader = [System.IO.StreamReader]::new($stream, [System.Text.Encoding]::ASCII, $false, 1024, $true)
                $requestLine = $reader.ReadLine()
                while (-not [string]::IsNullOrEmpty($reader.ReadLine())) { }

                $requestParts = @($requestLine -split ' ')
                if ($requestParts.Count -lt 2 -or $requestParts[0] -ne 'GET') {
                    Write-CitrixHttpResponse -Stream $stream -StatusCode 405 -ContentType 'text/plain; charset=utf-8' -Body "Method not allowed.`n"
                    continue
                }

                $path = $requestParts[1].Split('?')[0]
                switch ($path) {
                    '/' {
                        $body = @'
<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Citrix Exporter</title></head>
<body><h1>Citrix Exporter</h1><p><a href="/metrics">Metrics</a> | <a href="/health">Health</a></p></body></html>
'@
                        Write-CitrixHttpResponse -Stream $stream -StatusCode 200 -ContentType 'text/html; charset=utf-8' -Body $body
                    }
                    '/health' {
                        Write-CitrixHttpResponse -Stream $stream -StatusCode 200 -ContentType 'application/json; charset=utf-8' -Body "{`"status`":`"ok`",`"mode`":`"$mode`"}`n"
                    }
                    '/metrics' {
                        $timer = [System.Diagnostics.Stopwatch]::StartNew()
                        try {
                            $parameters = @{
                                Simulation = $Simulation
                                InjectFailureSource = $InjectFailureSource
                                AdminAddress = $AdminAddress
                                LmstatPath = $LmstatPath
                                LicenseServer = $LicenseServer
                                Scenario = $scenario
                            }
                            $metrics = Get-CitrixMetric @parameters
                            $timer.Stop()
                            $selfMetrics = Get-CitrixExporterSelfMetric -Success $true -DurationSeconds $timer.Elapsed.TotalSeconds -ErrorCount $errorCount -Mode $mode
                            Write-CitrixHttpResponse -Stream $stream -StatusCode 200 -ContentType 'text/plain; version=0.0.4; charset=utf-8' -Body ($selfMetrics + $metrics)
                        }
                        catch {
                            $timer.Stop()
                            $errorCount++
                            Write-Warning "Citrix metric collection failed: $($_.Exception.Message)"
                            $selfMetrics = Get-CitrixExporterSelfMetric -Success $false -DurationSeconds $timer.Elapsed.TotalSeconds -ErrorCount $errorCount -Mode $mode
                            Write-CitrixHttpResponse -Stream $stream -StatusCode 200 -ContentType 'text/plain; version=0.0.4; charset=utf-8' -Body $selfMetrics
                        }
                    }
                    default {
                        Write-CitrixHttpResponse -Stream $stream -StatusCode 404 -ContentType 'text/plain; charset=utf-8' -Body "Not found.`n"
                    }
                }
            }
            catch {
                Write-Warning "HTTP request handling failed: $($_.Exception.Message)"
                if ($null -ne $stream -and $stream.CanWrite) {
                    try {
                        Write-CitrixHttpResponse -Stream $stream -StatusCode 500 -ContentType 'text/plain; charset=utf-8' -Body "Internal server error.`n"
                    }
                    catch {
                        Write-Warning "Could not send the HTTP error response: $($_.Exception.Message)"
                    }
                }
            }
            finally {
                if ($null -ne $reader) { $reader.Dispose() }
                if ($null -ne $stream) { $stream.Dispose() }
                $client.Dispose()
            }
        }
    }
    finally {
        $listener.Stop()
    }
}
