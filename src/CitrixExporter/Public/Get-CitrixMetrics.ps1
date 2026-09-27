function Get-CitrixMetric {
    [CmdletBinding()]
    param(
        [switch]$Simulation,

        [ValidateSet('Broker', 'Licensing')]
        [string[]]$InjectFailureSource = @(),

        [string]$AdminAddress,

        [string]$LmstatPath,

        [string]$LicenseServer
    )

    $snapshotParameters = @{
        Simulation = $Simulation
        InjectFailureSource = $InjectFailureSource
        AdminAddress = $AdminAddress
        LmstatPath = $LmstatPath
        LicenseServer = $LicenseServer
    }
    $snapshot = Get-CitrixMetricSnapshot @snapshotParameters
    return ConvertTo-CitrixPrometheusText -Snapshot $snapshot
}
