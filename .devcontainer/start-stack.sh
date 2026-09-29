#!/usr/bin/env bash
# Starts the exporter, Prometheus, and Grafana with the synthetic Citrix site.
# In GitHub Codespaces, Grafana is told its forwarded address so the panels
# can query Prometheus through it.
set -euo pipefail

if [ -n "${CODESPACE_NAME:-}" ] && [ -n "${GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN:-}" ]; then
  export GRAFANA_ROOT_URL="https://${CODESPACE_NAME}-3000.${GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN}/"
fi

# Docker-in-Docker can take a few seconds to accept connections after start.
for _ in $(seq 1 30); do
  docker info >/dev/null 2>&1 && break
  sleep 2
done

docker compose up --build --detach --wait --wait-timeout 300

cat <<'EOF'

The synthetic Citrix monitoring stack is running:
  Grafana dashboard   port 3000 (opens automatically; see the Ports tab)
  Prometheus          port 9090
  Exporter /metrics   port 9187

Replay an incident, then watch the dashboard and the alerts react:
  EXPORTER_SCENARIO=vda-registration-outage.json docker compose up --detach exporter
EOF
