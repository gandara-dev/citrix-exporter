function Get-CitrixMetricSnapshot {
    [CmdletBinding()]
    param(
        [switch]$Simulation,

        [ValidateSet('Broker', 'Licensing')]
        [string[]]$InjectFailureSource = @(),

        [string]$AdminAddress,

        [string]$LmstatPath,

        [string]$LicenseServer
    )

    if ($Simulation) {
        return Get-SimulatedCitrixSnapshot -InjectFailureSource $InjectFailureSource
    }

    if ($InjectFailureSource.Count -gt 0) {
        throw 'InjectFailureSource can only be used with -Simulation.'
    }

    return Get-RealCitrixSnapshot -AdminAddress $AdminAddress -LmstatPath $LmstatPath -LicenseServer $LicenseServer
}
