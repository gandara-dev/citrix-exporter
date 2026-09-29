# Synthetic Citrix site used by -Simulation and by the Metrics Playground page.
#
# Every value is computed with integer arithmetic from the scenario and the
# collection minute, so site/lib/playground.js reproduces the output byte for
# byte. The names are fictional. Keep both implementations and the fixtures in
# tests/fixtures in sync.

$script:SyntheticGroups = @(
    [pscustomobject]@{ DeliveryGroup = 'Finance Apps'; Catalog = 'MCS Windows 11'; ProvisioningType = 'MCS'; Machines = 40; License = 'MPS_ENT_CCU'; Seed = 1 }
    [pscustomobject]@{ DeliveryGroup = 'Engineering Desktops'; Catalog = 'MCS Engineering'; ProvisioningType = 'MCS'; Machines = 60; License = 'XDT_ENT_UD'; Seed = 2 }
    [pscustomobject]@{ DeliveryGroup = 'Remote PCs'; Catalog = 'Physical Devices'; ProvisioningType = 'Manual'; Machines = 10; License = 'XDT_ENT_UD'; Seed = 3 }
)

# Percent of registered VDAs in use at the start of each UTC hour.
$script:SyntheticLoadCurve = @(4, 3, 3, 3, 4, 8, 20, 45, 70, 85, 90, 92, 88, 90, 92, 88, 80, 60, 35, 20, 12, 8, 6, 5)

$script:SyntheticDefaults = [ordered]@{
    loadPercent = $null
    disconnectedPercent = 15
    logonSlowdownSeconds = 0
    unregisteredVdas = $null
    licenseTotals = [ordered]@{ MPS_ENT_CCU = 50; XDT_ENT_UD = 80 }
    brokerDown = $false
    licensingDown = $false
}

function Get-SyntheticScenarioValue {
    param($Scenario, [string]$Name)

    if ($null -ne $Scenario) {
        if ($Scenario -is [System.Collections.IDictionary]) {
            if ($Scenario.Contains($Name)) { return , $Scenario[$Name] }
        }
        elseif ($null -ne $Scenario.PSObject.Properties[$Name]) {
            return , $Scenario.$Name
        }
    }
    return , $script:SyntheticDefaults[$Name]
}

function Get-SyntheticMapValue {
    param($Map, [string]$Key)

    if ($null -eq $Map) { return $null }
    if ($Map -is [System.Collections.IDictionary]) {
        if ($Map.Contains($Key)) { return $Map[$Key] }
        return $null
    }
    $property = $Map.PSObject.Properties[$Key]
    if ($null -eq $property) { return $null }
    return $property.Value
}

function Assert-SyntheticInteger {
    param($Value, [string]$Name, [long]$Minimum, [long]$Maximum)

    $isInteger = ($Value -is [int]) -or ($Value -is [long]) -or ($Value -is [int16]) -or ($Value -is [byte])
    if (-not $isInteger -or $Value -lt $Minimum -or $Value -gt $Maximum) {
        throw "Scenario value '$Name' must be a whole number from $Minimum to $Maximum."
    }
    return [long]$Value
}

function Get-SyntheticJitter {
    param([long]$Minute, [long]$Seed)
    return (($Minute * 7919 + $Seed * 104729) % 101) - 50
}

function Get-SimulatedCitrixSnapshot {
    param(
        [ValidateSet('Broker', 'Licensing')]
        [string[]]$InjectFailureSource = @(),

        $Scenario,

        [DateTimeOffset]$At = [DateTimeOffset]::UtcNow
    )

    $brokerDown = [bool](Get-SyntheticScenarioValue $Scenario 'brokerDown')
    $licensingDown = [bool](Get-SyntheticScenarioValue $Scenario 'licensingDown')
    if ($brokerDown -or $InjectFailureSource -contains 'Broker') {
        throw 'Injected Broker collection failure.'
    }

    $loadOverride = Get-SyntheticScenarioValue $Scenario 'loadPercent'
    if ($null -ne $loadOverride) {
        $loadOverride = Assert-SyntheticInteger $loadOverride 'loadPercent' 0 100
    }
    $disconnectedPercent = Assert-SyntheticInteger (Get-SyntheticScenarioValue $Scenario 'disconnectedPercent') 'disconnectedPercent' 0 100
    $slowdown = Assert-SyntheticInteger (Get-SyntheticScenarioValue $Scenario 'logonSlowdownSeconds') 'logonSlowdownSeconds' 0 600
    $unregisteredMap = Get-SyntheticScenarioValue $Scenario 'unregisteredVdas'
    $licenseTotals = Get-SyntheticScenarioValue $Scenario 'licenseTotals'

    $minute = [long][Math]::Floor($At.ToUnixTimeSeconds() / 60)
    $hour = [int]([Math]::Floor($minute / 60) % 24)
    $minuteOfHour = [int]($minute % 60)
    $baseLoad = if ($null -ne $loadOverride) {
        $loadOverride * 60
    }
    else {
        $script:SyntheticLoadCurve[$hour] * (60 - $minuteOfHour) +
            $script:SyntheticLoadCurve[($hour + 1) % 24] * $minuteOfHour
    }

    $machines = [System.Collections.Generic.List[object]]::new()
    $sessions = [System.Collections.Generic.List[object]]::new()
    $catalogs = [System.Collections.Generic.List[object]]::new()
    $inUse = @{}

    foreach ($group in $script:SyntheticGroups) {
        $override = Get-SyntheticMapValue $unregisteredMap $group.DeliveryGroup
        if ($null -ne $override) {
            $unregistered = Assert-SyntheticInteger $override "unregisteredVdas.$($group.DeliveryGroup)" 0 $group.Machines
        }
        else {
            $pick = ($minute * 31 + $group.Seed * 17) % 23
            $unregistered = if ($pick -eq 0) { 2 } elseif ($pick -lt 3) { 1 } else { 0 }
        }
        $registered = $group.Machines - $unregistered

        for ($index = 0; $index -lt $group.Machines; $index++) {
            $state = if ($index -lt $registered) { 'Registered' } else { 'Unregistered' }
            $machines.Add([pscustomobject]@{
                DeliveryGroup = $group.DeliveryGroup
                Catalog = $group.Catalog
                RegistrationState = $state
            })
        }

        $load = $baseLoad
        if ($null -eq $loadOverride) {
            $load = [Math]::Min(6000, [Math]::Max(0, $baseLoad + (Get-SyntheticJitter $minute $group.Seed) * 6))
        }
        $sessionCount = [long][Math]::Floor(($registered * $load + 3000) / 6000)
        $disconnected = [long][Math]::Floor(($sessionCount * $disconnectedPercent + 50) / 100)
        $logonTenths = 85 + $group.Seed * 10 + [long][Math]::Floor($load / 200) +
            ((($minute * 13 + $group.Seed * 7) % 21) - 10) + $slowdown * 10
        $logonSeconds = [Math]::Max(10, $logonTenths) / 10

        for ($index = 0; $index -lt $sessionCount; $index++) {
            $state = if ($index -lt $sessionCount - $disconnected) { 'Active' } else { 'Disconnected' }
            $sessions.Add([pscustomobject]@{
                DeliveryGroup = $group.DeliveryGroup
                State = $state
                Protocol = 'HDX'
                LogonDurationSeconds = $logonSeconds
            })
        }

        $catalogs.Add([pscustomobject]@{
            Name = $group.Catalog
            ProvisioningType = $group.ProvisioningType
            MachineCount = $group.Machines
        })
        $inUse[$group.License] = [long]$inUse[$group.License] + $sessionCount
    }

    if ($licensingDown -or $InjectFailureSource -contains 'Licensing') {
        throw 'Injected Licensing collection failure.'
    }

    $licenses = foreach ($feature in @('MPS_ENT_CCU', 'XDT_ENT_UD')) {
        $total = Get-SyntheticMapValue $licenseTotals $feature
        if ($null -eq $total) {
            $total = $script:SyntheticDefaults.licenseTotals[$feature]
        }
        $total = Assert-SyntheticInteger $total "licenseTotals.$feature" 0 100000
        [pscustomobject]@{
            Feature = $feature
            Total = $total
            InUse = [Math]::Min($total, [long]$inUse[$feature])
        }
    }

    return [pscustomobject]@{
        CollectedAt = $At
        Machines = $machines.ToArray()
        Sessions = $sessions.ToArray()
        Catalogs = $catalogs.ToArray()
        Licenses = @($licenses)
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
