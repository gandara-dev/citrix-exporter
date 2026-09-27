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
        $metrics = Get-CitrixMetric -Simulation

        $metrics | Should -Match 'citrix_vdas\{delivery_group="Finance Apps",registration_state="Unregistered"\} 1'
        $metrics | Should -Match 'citrix_sessions\{delivery_group="Engineering Desktops",state="Active",protocol="HDX"\} 2'
        $metrics | Should -Match 'citrix_logon_duration_seconds\{delivery_group="Finance Apps"\}'
        $metrics | Should -Match 'citrix_licenses_in_use\{feature="XDT_ENT_UD"\} 184'
        $metrics | Should -Match 'citrix_mcs_catalog_machines\{catalog="MCS Engineering"\} 4'
        $metrics | Should -Not -Match 'Physical Devices.*citrix_mcs_catalog'
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
