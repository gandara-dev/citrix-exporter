# Release Verification

## Public release gate

Every change must pass:

- Pester tests on Windows and Linux for synthetic data, failure injection,
  Prometheus rendering, `lmstat` parsing, and mocked Broker SDK mappings;
- PSScriptAnalyzer, actionlint, JSON parsing, and Mermaid rendering;
- a clean Docker Compose build with the exporter, Prometheus, and Grafana;
- `promtool` validation of the live `/metrics` response;
- `promtool` syntax checks and unit tests for the alert rules, and a Prometheus
  query proving the four rules are loaded;
- Metrics Playground tests proving the browser engine matches the PowerShell
  module byte for byte on the shared fixtures;
- a Prometheus query proving the exporter target is up;
- Grafana API discovery of the provisioned `citrix-vdi-overview` dashboard;
- a degraded-mode run proving that a Broker failure keeps HTTP available,
  publishes `scrape_success 0`, increments the error counter, and omits Citrix
  data metrics.

Run the complete public stack check:

```powershell
docker compose up --build --detach --wait --wait-timeout 180
try {
    ./scripts/Test-ComposeStack.ps1 | Format-List
}
finally {
    docker compose down --volumes
}
```

The playground and scenario files exercise the same synthetic provider. They
demonstrate the output contract and alert logic; they are not evidence about a
real site.

## Environment acceptance gate

The synthetic provider cannot validate a specific Citrix site. Before rollout:

1. Install the Citrix Broker SDK on a supported Windows management host.
2. Run the three required Broker commands with the intended read-only identity.
3. Start the exporter on loopback with an explicit `-AdminAddress`.
4. Compare a small metric sample with approved Studio or SDK queries.
5. If licensing is enabled, validate `lmstat -a` separately and measure its
   impact before selecting a scrape interval.
6. Confirm that Prometheus reaches the protected endpoint through the intended
   TLS/authentication boundary.
7. Confirm no username, machine name, session ID, or IP address is exposed.

A passing public build validates the exporter contract and complete synthetic
monitoring stack. It does not certify permissions, SDK compatibility, latency,
or data accuracy for an untested Citrix site.
