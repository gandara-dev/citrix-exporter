function ConvertTo-PrometheusLabelValue {
    param([AllowEmptyString()][string]$Value)

    return $Value.Replace('\', '\\').Replace("`n", '\n').Replace('"', '\"')
}

function ConvertTo-PrometheusNumber {
    param([double]$Value)

    return $Value.ToString('0.###############', [System.Globalization.CultureInfo]::InvariantCulture)
}

function Format-PrometheusSample {
    param(
        [Parameter(Mandatory)][string]$Name,
        [Parameter(Mandatory)][System.Collections.IDictionary]$Labels,
        [Parameter(Mandatory)][double]$Value
    )

    $labelText = ''
    if ($Labels.Count -gt 0) {
        $pairs = foreach ($key in $Labels.Keys) {
            "$key=`"$(ConvertTo-PrometheusLabelValue -Value ([string]$Labels[$key]))`""
        }
        $labelText = "{$($pairs -join ',')}"
    }
    return "$Name$labelText $(ConvertTo-PrometheusNumber -Value $Value)"
}

function ConvertTo-CitrixPrometheusText {
    param([Parameter(Mandatory)][psobject]$Snapshot)

    $lines = [System.Collections.Generic.List[string]]::new()

    $lines.Add('# HELP citrix_vdas Number of VDAs by delivery group and registration state.')
    $lines.Add('# TYPE citrix_vdas gauge')
    foreach ($group in $Snapshot.Machines | Group-Object DeliveryGroup, RegistrationState | Sort-Object Name) {
        $first = $group.Group[0]
        $lines.Add((Format-PrometheusSample -Name 'citrix_vdas' -Labels ([ordered]@{
            delivery_group = $first.DeliveryGroup
            registration_state = $first.RegistrationState
        }) -Value $group.Count))
    }

    $lines.Add('# HELP citrix_sessions Number of Citrix sessions by delivery group, state, and protocol.')
    $lines.Add('# TYPE citrix_sessions gauge')
    foreach ($group in $Snapshot.Sessions | Group-Object DeliveryGroup, State, Protocol | Sort-Object Name) {
        $first = $group.Group[0]
        $lines.Add((Format-PrometheusSample -Name 'citrix_sessions' -Labels ([ordered]@{
            delivery_group = $first.DeliveryGroup
            state = $first.State
            protocol = $first.Protocol
        }) -Value $group.Count))
    }

    $lines.Add('# HELP citrix_logon_duration_seconds Average session logon duration by delivery group.')
    $lines.Add('# TYPE citrix_logon_duration_seconds gauge')
    foreach ($group in $Snapshot.Sessions | Group-Object DeliveryGroup | Sort-Object Name) {
        $average = [Math]::Round(($group.Group | Measure-Object LogonDurationSeconds -Average).Average, 3)
        $lines.Add((Format-PrometheusSample -Name 'citrix_logon_duration_seconds' -Labels ([ordered]@{
            delivery_group = $group.Name
        }) -Value $average))
    }

    $lines.Add('# HELP citrix_licenses Number of licenses issued by feature.')
    $lines.Add('# TYPE citrix_licenses gauge')
    $lines.Add('# HELP citrix_licenses_in_use Number of licenses currently in use by feature.')
    $lines.Add('# TYPE citrix_licenses_in_use gauge')
    foreach ($license in $Snapshot.Licenses | Sort-Object Feature) {
        $labels = [ordered]@{ feature = $license.Feature }
        $lines.Add((Format-PrometheusSample -Name 'citrix_licenses' -Labels $labels -Value $license.Total))
        $lines.Add((Format-PrometheusSample -Name 'citrix_licenses_in_use' -Labels $labels -Value $license.InUse))
    }

    $lines.Add('# HELP citrix_mcs_catalog_machines Number of machines in each MCS catalog.')
    $lines.Add('# TYPE citrix_mcs_catalog_machines gauge')
    foreach ($catalog in $Snapshot.Catalogs | Where-Object ProvisioningType -eq 'MCS' | Sort-Object Name) {
        $lines.Add((Format-PrometheusSample -Name 'citrix_mcs_catalog_machines' -Labels ([ordered]@{
            catalog = $catalog.Name
        }) -Value $catalog.MachineCount))
    }

    return ($lines -join "`n") + "`n"
}

function Get-CitrixExporterSelfMetric {
    param(
        [Parameter(Mandatory)][bool]$Success,
        [Parameter(Mandatory)][double]$DurationSeconds,
        [Parameter(Mandatory)][int]$ErrorCount,
        [Parameter(Mandatory)][string]$Mode
    )

    $successValue = if ($Success) { 1 } else { 0 }
    $lines = @(
        '# HELP citrix_exporter_scrape_success Whether the last collection succeeded.'
        '# TYPE citrix_exporter_scrape_success gauge'
        "citrix_exporter_scrape_success $successValue"
        '# HELP citrix_exporter_scrape_duration_seconds Time spent collecting Citrix metrics.'
        '# TYPE citrix_exporter_scrape_duration_seconds gauge'
        "citrix_exporter_scrape_duration_seconds $(ConvertTo-PrometheusNumber -Value $DurationSeconds)"
        '# HELP citrix_exporter_scrape_errors_total Total number of failed collections since startup.'
        '# TYPE citrix_exporter_scrape_errors_total counter'
        "citrix_exporter_scrape_errors_total $ErrorCount"
        '# HELP citrix_exporter_build_info Exporter build and operating mode information.'
        '# TYPE citrix_exporter_build_info gauge'
        "citrix_exporter_build_info{version=`"$script:ExporterVersion`",mode=`"$Mode`"} 1"
    )
    return ($lines -join "`n") + "`n"
}
