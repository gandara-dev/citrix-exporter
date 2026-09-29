BeforeAll {
    function global:Get-BrokerMachine {
        [CmdletBinding()]
        param([string]$AdminAddress, [int]$MaxRecordCount)
        [void]$AdminAddress
        [void]$MaxRecordCount
    }
    function global:Get-BrokerSession {
        [CmdletBinding()]
        param([string]$AdminAddress, [int]$MaxRecordCount)
        [void]$AdminAddress
        [void]$MaxRecordCount
    }
    function global:Get-BrokerCatalog {
        [CmdletBinding()]
        param([string]$AdminAddress, [int]$MaxRecordCount)
        [void]$AdminAddress
        [void]$MaxRecordCount
    }

    $modulePath = Join-Path $PSScriptRoot '../src/CitrixExporter/CitrixExporter.psd1'
    Import-Module $modulePath -Force
}

AfterAll {
    Remove-Item Function:/Get-BrokerMachine -ErrorAction SilentlyContinue
    Remove-Item Function:/Get-BrokerSession -ErrorAction SilentlyContinue
    Remove-Item Function:/Get-BrokerCatalog -ErrorAction SilentlyContinue
}

Describe 'Synthetic Citrix metrics' {
    It 'exports VDA, session, logon, license, and MCS metrics' {
        $at = [DateTimeOffset]::new(2026, 9, 28, 13, 30, 0, [TimeSpan]::Zero)
        $metrics = Get-CitrixMetric -Simulation -At $at

        $metrics | Should -Match 'citrix_vdas\{delivery_group="Engineering Desktops",registration_state="Unregistered"\} 1'
        $metrics | Should -Match 'citrix_sessions\{delivery_group="Engineering Desktops",state="Active",protocol="HDX"\} 44'
        $metrics | Should -Match 'citrix_logon_duration_seconds\{delivery_group="Finance Apps"\} 12\.1'
        $metrics | Should -Match 'citrix_licenses_in_use\{feature="XDT_ENT_UD"\} 61'
        $metrics | Should -Match 'citrix_mcs_catalog_machines\{catalog="MCS Engineering"\} 60'
        $metrics | Should -Not -Match 'Physical Devices.*citrix_mcs_catalog'
    }

    It 'follows the workday load curve' {
        $night = Get-CitrixMetricSnapshot -Simulation -At ([DateTimeOffset]::new(2026, 9, 28, 3, 0, 0, [TimeSpan]::Zero))
        $peak = Get-CitrixMetricSnapshot -Simulation -At ([DateTimeOffset]::new(2026, 9, 28, 13, 30, 0, [TimeSpan]::Zero))

        @($night.Sessions).Count | Should -BeLessThan 10
        @($peak.Sessions).Count | Should -BeGreaterThan 80
        @($peak.Machines).Count | Should -Be 110
    }

    It 'applies a scenario and caps license use at the pool size' {
        $scenario = [pscustomobject]@{
            loadPercent = 100
            unregisteredVdas = [pscustomobject]@{ 'Finance Apps' = 8 }
            logonSlowdownSeconds = 30
            licenseTotals = [pscustomobject]@{ XDT_ENT_UD = 60 }
        }
        $at = [DateTimeOffset]::new(2026, 9, 28, 13, 30, 0, [TimeSpan]::Zero)
        $metrics = Get-CitrixMetric -Simulation -Scenario $scenario -At $at

        $metrics | Should -Match 'citrix_vdas\{delivery_group="Finance Apps",registration_state="Unregistered"\} 8'
        $metrics | Should -Match 'citrix_licenses_in_use\{feature="XDT_ENT_UD"\} 60'
        $metrics | Should -Match 'citrix_logon_duration_seconds\{delivery_group="Engineering Desktops"\} 4\d\.\d'
    }

    It 'rejects an invalid scenario value' {
        { Get-CitrixMetric -Simulation -Scenario @{ loadPercent = 101 } } |
            Should -Throw "Scenario value 'loadPercent' must be a whole number from 0 to 100."
    }

    It 'accepts a scenario only in simulation mode' {
        { Get-CitrixMetricSnapshot -Scenario @{ loadPercent = 50 } } |
            Should -Throw 'Scenario and At can only be used with -Simulation.'
    }

    It 'uses only fictional environment names' {
        $metrics = Get-CitrixMetric -Simulation

        $metrics | Should -Match 'Finance Apps'
        $metrics | Should -Match 'Engineering Desktops'
    }

    It 'fails explicitly when a Broker failure is injected' {
        { Get-CitrixMetric -Simulation -InjectFailureSource Broker } |
            Should -Throw 'Injected Broker collection failure.'
    }

    It 'fails explicitly when a Licensing failure is injected' {
        { Get-CitrixMetric -Simulation -InjectFailureSource Licensing } |
            Should -Throw 'Injected Licensing collection failure.'
    }
}

Describe 'Prometheus rendering' {
    It 'keeps the build metric aligned with the module version' {
        $manifest = Test-ModuleManifest $modulePath
        $metrics = InModuleScope CitrixExporter {
            Get-CitrixExporterSelfMetric `
                -Success $true `
                -DurationSeconds 0.1 `
                -ErrorCount 0 `
                -Mode simulation
        }

        $metrics | Should -Match (
            'citrix_exporter_build_info\{version="' +
            [regex]::Escape([string]$manifest.Version) +
            '",mode="simulation"\} 1'
        )
    }

    It 'escapes special characters in labels' {
        InModuleScope CitrixExporter {
            $value = ConvertTo-PrometheusLabelValue -Value "group\`"one`nnext"
            $value | Should -Be 'group\\\"one\nnext'
        }
    }

    It 'parses Citrix lmstat feature usage' {
        InModuleScope CitrixExporter {
            $output = @'
Users of XDT_ENT_UD: (Total of 250 licenses issued; Total of 184 licenses in use)
Users of MPS_ENT_CCU: (Total of 100 licenses issued; Total of 61 licenses in use)
'@
            $licenses = @(ConvertFrom-LmstatOutput -Output $output)

            $licenses.Count | Should -Be 2
            $licenses[0].Feature | Should -Be 'XDT_ENT_UD'
            $licenses[0].Total | Should -Be 250
            $licenses[0].InUse | Should -Be 184
        }
    }

    It 'reserves the total suffix for counters' {
        $metrics = Get-CitrixMetric -Simulation
        $gaugeNames = @([regex]::Matches($metrics, '(?m)^# TYPE (?<name>\S+) gauge$') | ForEach-Object {
            $_.Groups['name'].Value
        })

        $gaugeNames | Should -Not -Contain 'citrix_vdas_total'
        $gaugeNames | Should -Not -Contain 'citrix_sessions_total'
        $gaugeNames | Should -Not -Contain 'citrix_licenses_total'
        $gaugeNames | Should -Not -Contain 'citrix_mcs_catalog_machines_total'
    }
}

Describe 'Citrix Broker SDK provider' {
    BeforeEach {
        Mock Get-BrokerMachine -ModuleName CitrixExporter {
            @(
                [pscustomobject]@{ DesktopGroupName = 'Synthetic Group'; CatalogName = 'Synthetic MCS'; RegistrationState = 'Registered' }
                [pscustomobject]@{ DesktopGroupName = 'Synthetic Group'; CatalogName = 'Synthetic MCS'; RegistrationState = 'Unregistered' }
            )
        }
        Mock Get-BrokerSession -ModuleName CitrixExporter {
            @(
                [pscustomobject]@{
                    DesktopGroupName = 'Synthetic Group'
                    SessionState = 'Active'
                    Protocol = 'HDX'
                    BrokeringDuration = 1200
                    EstablishmentDuration = 3800
                }
            )
        }
        Mock Get-BrokerCatalog -ModuleName CitrixExporter {
            @([pscustomobject]@{ Name = 'Synthetic MCS'; ProvisioningType = 'MCS' })
        }
    }

    It 'maps mocked Broker SDK objects into metrics' {
        $metrics = Get-CitrixMetric -AdminAddress 'ddc01.example.test'

        $metrics | Should -Match 'citrix_vdas\{delivery_group="Synthetic Group",registration_state="Registered"\} 1'
        $metrics | Should -Match 'citrix_logon_duration_seconds\{delivery_group="Synthetic Group"\} 5'
        $metrics | Should -Match 'citrix_mcs_catalog_machines\{catalog="Synthetic MCS"\} 2'
        Should -Invoke Get-BrokerMachine -ModuleName CitrixExporter -Times 1 -ParameterFilter {
            $AdminAddress -eq 'ddc01.example.test' -and $MaxRecordCount -eq 100000
        }
    }

    It 'requires an lmstat path when a license server is configured' {
        { Get-CitrixMetric -LicenseServer 'license01.example.test' } |
            Should -Throw 'LmstatPath is required when LicenseServer is provided.'
    }
}

Describe 'Metrics Playground contract' {
    It 'keeps the shared playground fixtures in sync with the module' {
        $generated = Join-Path $TestDrive 'playground-cases.json'
        & (Join-Path $PSScriptRoot 'Update-PlaygroundFixtures.ps1') -OutputPath $generated
        (Get-Content -LiteralPath $generated -Raw) -replace "`r`n", "`n" |
            Should -BeExactly ((Get-Content -LiteralPath (Join-Path $PSScriptRoot 'fixtures/playground-cases.json') -Raw) -replace "`r`n", "`n")
    }

    It 'ships the example scenarios in a valid format' {
        foreach ($file in Get-ChildItem -Path (Join-Path $PSScriptRoot '../scenarios') -Filter '*.json') {
            # Validate the values the way Start-CitrixExporter does at startup;
            # the failure switches only take effect on each scrape.
            $scenario = Get-Content -LiteralPath $file.FullName -Raw | ConvertFrom-Json |
                Select-Object -Property * -ExcludeProperty brokerDown, licensingDown
            { Get-CitrixMetricSnapshot -Simulation -Scenario $scenario -At ([DateTimeOffset]::UtcNow) } |
                Should -Not -Throw -Because $file.Name
        }
    }
}

