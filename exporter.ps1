[CmdletBinding()]
param(
    [string]$ListenAddress = '127.0.0.1',
    [int]$Port = 9187,
    [switch]$Simulation,
    [ValidateSet('Broker', 'Licensing')]
    [string[]]$InjectFailureSource = @(),
    [string]$AdminAddress,
    [string]$LmstatPath,
    [string]$LicenseServer,
    [string]$ScenarioPath
)

$ErrorActionPreference = 'Stop'
$modulePath = Join-Path $PSScriptRoot 'src/CitrixExporter/CitrixExporter.psd1'
Import-Module $modulePath -Force

$parameters = @{
    ListenAddress = $ListenAddress
    Port = $Port
    Simulation = $Simulation
    InjectFailureSource = $InjectFailureSource
    AdminAddress = $AdminAddress
    LmstatPath = $LmstatPath
    LicenseServer = $LicenseServer
    ScenarioPath = $ScenarioPath
}
Start-CitrixExporter @parameters
