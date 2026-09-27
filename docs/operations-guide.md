# Operations Guide

This guide covers a production-oriented rollout. The Compose stack is a local
demonstration and must not be exposed unchanged to an untrusted network.

## Prerequisites

- A supported Windows management host with PowerShell 7.2 or newer.
- Citrix Virtual Apps and Desktops PowerShell SDK commands available to the
  exporter process.
- Network access from the host to the selected Delivery Controller.
- A dedicated service identity with read-only delegated Citrix permissions.
- Optional local access to `lmstat.exe` and network access to the License Server.
- A Prometheus server that can reach the protected exporter endpoint.

Validate the SDK before installing the exporter:

```powershell
Get-Command Get-BrokerMachine, Get-BrokerSession, Get-BrokerCatalog
Get-BrokerMachine -AdminAddress ddc01.example.test -MaxRecordCount 1
```

Use synthetic names in automation examples and documentation. Do not store
credentials, exported Citrix objects, or customer identifiers in this repository.

## Deployment model

Run one exporter process per Citrix site or independently monitored Broker
endpoint. Use an explicit `-AdminAddress` so the target is clear in process
configuration and operational records.

```powershell
pwsh -NoLogo -NoProfile -NonInteractive -File ./exporter.ps1 `
    -ListenAddress 127.0.0.1 `
    -Port 9187 `
    -AdminAddress ddc01.example.test
```

The project does not install a Windows service. Select an organization-approved
service wrapper or scheduled process manager, capture the PowerShell information
and warning streams, and configure restart policy outside the exporter.

## Network protection

The listener has no authentication or TLS. The safest default is loopback. If
Prometheus is remote, place a reverse proxy on the management host that:

- terminates TLS with an organization-managed certificate;
- authenticates or allowlists the Prometheus client;
- exposes only `/metrics` and optionally `/health`;
- applies request and connection timeouts;
- writes access logs without query secrets.

Do not publish ports `9187`, `9090`, or `3000` directly to the internet. The
anonymous Grafana configuration in `compose.yml` is for local demonstration only.

## Prometheus configuration

Start conservatively. Collection is synchronous, and Citrix documents that
`lmstat -a` can create significant activity in larger environments.

```yaml
scrape_configs:
  - job_name: citrix-exporter
    scrape_interval: 60s
    scrape_timeout: 30s
    static_configs:
      - targets: ["exporter-host.example.test:9187"]
        labels:
          citrix_site: "example-site"
```

Environment or site labels belong in Prometheus target configuration, not in
the exporter. Measure collection duration before reducing the interval.

## Licensing collection

Licensing metrics are opt-in:

```powershell
pwsh ./exporter.ps1 `
    -ListenAddress 127.0.0.1 `
    -AdminAddress ddc01.example.test `
    -LmstatPath 'C:\Program Files (x86)\Citrix\Licensing\LS\lmstat.exe' `
    -LicenseServer license01.example.test
```

Both licensing arguments are required together. Restrict filesystem execute
permission on the configured binary. The exporter does not invoke a shell, but
operators still control which executable path the service account can run.

## Validation

After deployment, verify each layer:

```powershell
(Invoke-RestMethod http://127.0.0.1:9187/health).status
$metrics = Invoke-WebRequest http://127.0.0.1:9187/metrics |
    Select-Object -ExpandProperty Content
$metrics | Select-String 'citrix_exporter_scrape_success 1'
$metrics | Select-String '^citrix_vdas'
```

From Prometheus, confirm `up{job="citrix-exporter"} == 1` and
`citrix_exporter_scrape_success == 1`. Then compare a small sample of totals with
Citrix Studio or an approved SDK query before relying on alerts.

## Monitoring the exporter

At minimum, alert separately on:

- `up == 0`: exporter or network path unavailable;
- `citrix_exporter_scrape_success == 0`: upstream collection failed;
- sustained scrape duration approaching `scrape_timeout`;
- growth in `citrix_exporter_scrape_errors_total`.

The `/health` route is a liveness probe. It intentionally does not query Citrix
and must not be treated as end-to-end collection health.

## Troubleshooting

### Broker commands are unavailable

Install the Citrix Virtual Apps and Desktops PowerShell SDK on the host and
verify it is visible to PowerShell 7. The exporter fails the scrape explicitly
when a required command cannot be resolved.

### Collection returns access denied

Run a single read-only Broker command under the same service identity. Correct
Citrix delegated permissions; do not grant broad administrator access merely to
make the exporter work.

### Licensing series are absent

Confirm that both licensing parameters were supplied and that `lmstat -a`
prints aggregate `Users of ...` lines. An unconfigured licensing collector
correctly emits no licensing series.

### Prometheus reports `up == 1` but Citrix metrics disappear

Inspect `citrix_exporter_scrape_success` and process warning logs. HTTP 200 on a
failed collection is intentional so Prometheus can ingest exporter self-metrics.

### Scrapes time out

Compare `citrix_exporter_scrape_duration_seconds` with Prometheus
`scrape_timeout`. Increase the interval, investigate Broker latency, or disable
licensing collection. The exporter serves requests sequentially.

## Upgrade and rollback

1. Read `CHANGELOG.md` and the metrics compatibility notes.
2. Validate the new revision in simulation mode.
3. Run the test suite and a non-production Citrix smoke test.
4. Replace the exporter files as one versioned unit and restart the process.
5. Confirm self-metrics, Citrix metrics, and dashboard queries.

Rollback means restoring the previous repository tag and restarting the
process. Prometheus retains historical series, but renamed or removed metrics
require dashboard and alert-rule rollback as well.
