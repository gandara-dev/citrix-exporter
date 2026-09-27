function Get-SimulatedCitrixSnapshot {
    param(
        [ValidateSet('Broker', 'Licensing')]
        [string[]]$InjectFailureSource = @()
    )

    if ($InjectFailureSource -contains 'Broker') {
        throw 'Injected Broker collection failure.'
    }

    $machines = @(
        [pscustomobject]@{ DeliveryGroup = 'Finance Apps'; Catalog = 'MCS Windows 11'; RegistrationState = 'Registered' }
        [pscustomobject]@{ DeliveryGroup = 'Finance Apps'; Catalog = 'MCS Windows 11'; RegistrationState = 'Registered' }
        [pscustomobject]@{ DeliveryGroup = 'Finance Apps'; Catalog = 'MCS Windows 11'; RegistrationState = 'Unregistered' }
        [pscustomobject]@{ DeliveryGroup = 'Engineering Desktops'; Catalog = 'MCS Engineering'; RegistrationState = 'Registered' }
        [pscustomobject]@{ DeliveryGroup = 'Engineering Desktops'; Catalog = 'MCS Engineering'; RegistrationState = 'Registered' }
        [pscustomobject]@{ DeliveryGroup = 'Engineering Desktops'; Catalog = 'MCS Engineering'; RegistrationState = 'Registered' }
        [pscustomobject]@{ DeliveryGroup = 'Engineering Desktops'; Catalog = 'MCS Engineering'; RegistrationState = 'Unregistered' }
        [pscustomobject]@{ DeliveryGroup = 'Remote PCs'; Catalog = 'Physical Devices'; RegistrationState = 'Registered' }
    )

    $sessions = @(
        [pscustomobject]@{ DeliveryGroup = 'Finance Apps'; State = 'Active'; Protocol = 'HDX'; LogonDurationSeconds = 8.4 }
        [pscustomobject]@{ DeliveryGroup = 'Finance Apps'; State = 'Active'; Protocol = 'HDX'; LogonDurationSeconds = 11.7 }
        [pscustomobject]@{ DeliveryGroup = 'Finance Apps'; State = 'Disconnected'; Protocol = 'HDX'; LogonDurationSeconds = 9.2 }
        [pscustomobject]@{ DeliveryGroup = 'Engineering Desktops'; State = 'Active'; Protocol = 'HDX'; LogonDurationSeconds = 14.1 }
        [pscustomobject]@{ DeliveryGroup = 'Engineering Desktops'; State = 'Active'; Protocol = 'HDX'; LogonDurationSeconds = 12.3 }
        [pscustomobject]@{ DeliveryGroup = 'Engineering Desktops'; State = 'Disconnected'; Protocol = 'HDX'; LogonDurationSeconds = 16.8 }
    )

    $catalogs = @(
        [pscustomobject]@{ Name = 'MCS Windows 11'; ProvisioningType = 'MCS'; MachineCount = 3 }
        [pscustomobject]@{ Name = 'MCS Engineering'; ProvisioningType = 'MCS'; MachineCount = 4 }
        [pscustomobject]@{ Name = 'Physical Devices'; ProvisioningType = 'Manual'; MachineCount = 1 }
    )

    if ($InjectFailureSource -contains 'Licensing') {
        throw 'Injected Licensing collection failure.'
    }

    $licenses = @(
        [pscustomobject]@{ Feature = 'XDT_ENT_UD'; Total = 250; InUse = 184 }
        [pscustomobject]@{ Feature = 'MPS_ENT_CCU'; Total = 100; InUse = 61 }
    )

    return [pscustomobject]@{
        CollectedAt = [DateTimeOffset]::UtcNow
        Machines = $machines
        Sessions = $sessions
        Catalogs = $catalogs
        Licenses = $licenses
    }
}

function ConvertFrom-LmstatOutput {
    param(
        [Parameter(Mandatory)]
        [AllowEmptyString()]
        [string]$Output
    )

    $licenses = [System.Collections.Generic.List[object]]::new()
    $pattern = 'Users of (?<feature>[^:]+):\s+\(Total of (?<total>\d+) licenses? issued;\s+Total of (?<used>\d+) licenses? in use\)'
    foreach ($match in [regex]::Matches($Output, $pattern, [System.Text.RegularExpressions.RegexOptions]::IgnoreCase)) {
        $licenses.Add([pscustomobject]@{
            Feature = $match.Groups['feature'].Value.Trim()
            Total = [int]$match.Groups['total'].Value
            InUse = [int]$match.Groups['used'].Value
        })
    }
    return $licenses.ToArray()
}

function Get-RealCitrixSnapshot {
    param(
        [string]$AdminAddress,
        [string]$LmstatPath,
        [string]$LicenseServer
    )

    if (-not [string]::IsNullOrWhiteSpace($LicenseServer) -and [string]::IsNullOrWhiteSpace($LmstatPath)) {
        throw 'LmstatPath is required when LicenseServer is provided.'
    }

    foreach ($commandName in 'Get-BrokerMachine', 'Get-BrokerSession', 'Get-BrokerCatalog') {
        if (-not (Get-Command -Name $commandName -ErrorAction SilentlyContinue)) {
            throw "Citrix Broker SDK command '$commandName' is not available. Install the Citrix Virtual Apps and Desktops SDK or use -Simulation."
        }
    }

    $commonParameters = @{ ErrorAction = 'Stop'; MaxRecordCount = 100000 }
    if (-not [string]::IsNullOrWhiteSpace($AdminAddress)) {
        $commonParameters.AdminAddress = $AdminAddress
    }

    $brokerMachines = @(Get-BrokerMachine @commonParameters)
    $brokerSessions = @(Get-BrokerSession @commonParameters)
    $brokerCatalogs = @(Get-BrokerCatalog @commonParameters)

    $machines = @(
        foreach ($machine in $brokerMachines) {
            [pscustomobject]@{
                DeliveryGroup = if ($machine.DesktopGroupName) { [string]$machine.DesktopGroupName } else { 'Unassigned' }
                Catalog = [string]$machine.CatalogName
                RegistrationState = [string]$machine.RegistrationState
            }
        }
    )

    $sessions = @(
        foreach ($session in $brokerSessions) {
            $durationMilliseconds = [double]$session.BrokeringDuration + [double]$session.EstablishmentDuration
            [pscustomobject]@{
                DeliveryGroup = if ($session.DesktopGroupName) { [string]$session.DesktopGroupName } else { 'Unassigned' }
                State = [string]$session.SessionState
                Protocol = if ($session.Protocol) { [string]$session.Protocol } else { 'Unknown' }
                LogonDurationSeconds = $durationMilliseconds / 1000
            }
        }
    )

    $catalogs = @(
        foreach ($catalog in $brokerCatalogs) {
            [pscustomobject]@{
                Name = [string]$catalog.Name
                ProvisioningType = [string]$catalog.ProvisioningType
                MachineCount = @($machines | Where-Object Catalog -eq $catalog.Name).Count
            }
        }
    )

    $licenses = @()
    if (-not [string]::IsNullOrWhiteSpace($LmstatPath)) {
        if (-not (Test-Path -LiteralPath $LmstatPath -PathType Leaf)) {
            throw "lmstat executable was not found at '$LmstatPath'."
        }
        if ([string]::IsNullOrWhiteSpace($LicenseServer)) {
            throw 'LicenseServer is required when LmstatPath is provided.'
        }

        $lmstatOutput = & $LmstatPath -a -c "@$LicenseServer" -t 5 2>&1 | Out-String
        if ($LASTEXITCODE -ne 0) {
            throw "lmstat exited with code $LASTEXITCODE."
        }
        $licenses = @(ConvertFrom-LmstatOutput -Output $lmstatOutput)
    }

    return [pscustomobject]@{
        CollectedAt = [DateTimeOffset]::UtcNow
        Machines = $machines
        Sessions = $sessions
        Catalogs = $catalogs
        Licenses = $licenses
    }
}
