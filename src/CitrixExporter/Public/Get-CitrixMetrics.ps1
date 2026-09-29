function Get-CitrixMetric {
    [CmdletBinding()]
    param(
        [switch]$Simulation,

        [ValidateSet('Broker', 'Licensing')]
        [string[]]$InjectFailureSource = @(),

        [string]$AdminAddress,

        [string]$LmstatPath,

        [string]$LicenseServer,

        $Scenario,

        [Nullable[DateTimeOffset]]$At
    )

    $snapshotParameters = @{
        Simulation = $Simulation
        InjectFailureSource = $InjectFailureSource
        AdminAddress = $AdminAddress
        LmstatPath = $LmstatPath
        LicenseServer = $LicenseServer
        Scenario = $Scenario
        At = $At
    }
    $snapshot = Get-CitrixMetricSnapshot @snapshotParameters
    return ConvertTo-CitrixPrometheusText -Snapshot $snapshot
}
