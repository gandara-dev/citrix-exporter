# Changelog

All notable changes to this project are documented here.

## [0.1.1] - 2026-09-28

### Fixed

- Replaced the PowerShell-to-`promtool` text pipeline with an encoding-safe
  Compose-network validation command.
- Replaced a removed Citrix Licensing documentation URL with the current
  versioned command reference.

### Added

- Cross-platform `Test-ComposeStack.ps1` acceptance check for the exporter,
  health endpoint, Prometheus exposition and target, and Grafana dashboard.

## [0.1.0] - 2026-09-27

### Added

- Prometheus exporter for Citrix VDA, session, logon, licensing, and MCS catalog metrics.
- Synthetic environment with injectable Broker and Licensing failures.
- Cross-platform HTTP server implemented in PowerShell 7.
- Landing, health, and Prometheus metrics endpoints with resilient request handling.
- Docker Compose stack with Prometheus and a provisioned Grafana dashboard.
- Pester tests and GitHub Actions validation on Windows and Linux.
- Prometheus exposition validation, static architecture diagrams, and complete
  architecture, metrics, operations, testing, security, and contribution guides.
