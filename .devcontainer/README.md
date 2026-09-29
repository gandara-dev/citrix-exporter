# Citrix Exporter in Codespaces

This codespace runs the real stack with the synthetic Citrix site: the
PowerShell exporter, Prometheus with the alert rules, and Grafana with the
provisioned dashboard. The first start builds the exporter image and takes one
or two minutes.

| Port | Service |
|---|---|
| 3000 | Grafana, opens on the Citrix VDI Overview dashboard |
| 9090 | Prometheus (Alerts page: `/alerts`) |
| 9187 | Exporter (`/metrics`, `/health`) |

Open them from the **Ports** tab.

## Replay an incident

The files in `scenarios/` describe synthetic incidents. Restart only the
exporter with one of them; Prometheus and Grafana keep their history, so you
see the change on the graphs and the alert go from pending to firing.

```bash
EXPORTER_SCENARIO=vda-registration-outage.json docker compose up --detach exporter
EXPORTER_SCENARIO=slow-logons.json docker compose up --detach exporter
EXPORTER_SCENARIO=broker-outage.json docker compose up --detach exporter
docker compose up --detach exporter   # back to a normal day
```

## Run the checks

```bash
pwsh ./scripts/Test-ComposeStack.ps1
pwsh -c "Install-Module Pester -RequiredVersion 5.7.1 -Force -SkipPublisherCheck; Invoke-Pester ./tests"
```

Everything is fictional. Stop the codespace when you are done so it does not
use your Codespaces quota.
