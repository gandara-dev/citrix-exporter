function Get-CitrixMetricSnapshot {
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

    if ($Simulation) {
        $parameters = @{ InjectFailureSource = $InjectFailureSource; Scenario = $Scenario }
        if ($null -ne $At) {
            $parameters.At = $At
        }
        return Get-SimulatedCitrixSnapshot @parameters
    }

    if ($InjectFailureSource.Count -gt 0) {
        throw 'InjectFailureSource can only be used with -Simulation.'
    }
    if ($null -ne $Scenario -or $null -ne $At) {
        throw 'Scenario and At can only be used with -Simulation.'
    }

    return Get-RealCitrixSnapshot -AdminAddress $AdminAddress -LmstatPath $LmstatPath -LicenseServer $LicenseServer
}
