# Testing Guide

The test strategy separates deterministic module behavior from the containerized
monitoring path. No production Citrix infrastructure is required by CI.

## Unit tests

Requirements: PowerShell 7.2 or newer and Pester 5.7.1.

```powershell
Install-Module Pester -RequiredVersion 5.7.1 -Scope CurrentUser -Force -SkipPublisherCheck
Invoke-Pester -Path ./tests/CitrixExporter.Tests.ps1 -CI -Output Detailed
```

The suite verifies:

- all synthetic Citrix metric families;
- Broker and Licensing failure injection;
- Prometheus label escaping and number formatting behavior;
- `lmstat` aggregate parsing;
- correct gauge naming without reserved `_total` suffixes;
- mapping from mocked Broker SDK objects into the public metric contract.

The global Broker command stubs exist only so the module can resolve commands
during tests. Pester module mocks provide all returned objects; no Controller is
contacted.

## Static analysis

```powershell
Install-Module PSScriptAnalyzer -RequiredVersion 1.24.0 -Scope CurrentUser -Force
$findings = @(Invoke-ScriptAnalyzer -Path . -Recurse -Severity Warning,Error)
$findings | Format-Table -AutoSize
if ($findings.Count -gt 0) { throw 'PSScriptAnalyzer reported findings.' }
```

Workflow syntax is checked with `actionlint`. Mermaid sources are rendered with
the official Mermaid CLI image pinned by digest.

## Compose smoke test

Requirements: Docker with the Compose plugin and free local ports `9187`, `9090`,
and `3000`.

```powershell
docker compose config --quiet
docker compose up --build --detach --wait --wait-timeout 180

./scripts/Test-ComposeStack.ps1 | Format-List
```

Validate the exposition with the `promtool` included in the Prometheus container:

```powershell
docker compose exec -T prometheus sh -c `
  'wget -qO- http://exporter:9187/metrics | promtool check metrics'
```

The request and `promtool` process run inside the Compose network. Do not pipe
the multiline `.Content` string from Windows PowerShell directly to `promtool`:
PowerShell appends a trailing CRLF record that older `promtool` parsers reject
as an invalid metric name. The acceptance script uses the portable form above
and also checks the landing page, health endpoint, Prometheus target, and
provisioned Grafana dashboard.

Always stop the stack after testing:

```powershell
docker compose down --volumes
```

If a smoke test fails, collect `docker compose ps` and
`docker compose logs --no-color` before teardown.

## Controlled failure test

Run the automated failure-mode acceptance test after the Compose image has been
built:

```powershell
./scripts/Test-FailureMode.ps1 | Format-List
```

The `/metrics` response must remain HTTP 200, set
`citrix_exporter_scrape_success` to `0`, increment
`citrix_exporter_scrape_errors_total`, and omit Citrix metric families.

## Manual Citrix smoke test

This test is intentionally excluded from public CI because it requires a Citrix
site. Use a non-production Controller and a read-only identity:

1. Run each required Broker command directly with `-MaxRecordCount 1`.
2. Start the exporter on loopback with an explicit `-AdminAddress`.
3. Scrape once and compare aggregate counts with approved SDK queries.
4. Confirm that no machine name, username, session ID, or IP address appears in
   the exposition.
5. Stop the exporter and preserve only sanitized test evidence.

Do not use customer data in issues, fixtures, screenshots, or CI artifacts.
