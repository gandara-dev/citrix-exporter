@{
    RootModule = 'CitrixExporter.psm1'
    ModuleVersion = '0.2.0'
    GUID = '84a4af99-2e63-429c-9dc1-1089cdef361a'
    Author = 'Mateus Gandara'
    Description = 'Prometheus metrics exporter for Citrix Virtual Apps and Desktops.'
    PowerShellVersion = '7.2'
    FunctionsToExport = @(
        'Get-CitrixMetricSnapshot',
        'Get-CitrixMetric',
        'Start-CitrixExporter'
    )
    CmdletsToExport = @()
    VariablesToExport = @()
    AliasesToExport = @()
}
