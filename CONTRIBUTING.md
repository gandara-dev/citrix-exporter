# Contributing

Contributions should preserve the exporter's small operational surface and its
ability to run without Citrix infrastructure.

## Development workflow

1. Create a focused branch from `main`.
2. Keep all examples and fixtures synthetic.
3. Add or update Pester tests for behavioral changes.
4. Run unit tests, PSScriptAnalyzer, and the Compose smoke test.
5. Update the metrics reference and changelog when the public contract changes.
6. Open a pull request explaining the operator-visible behavior and validation.

Use English for code, documentation, issues, and commit messages.

## Metric changes

Metric names, types, label names, and units are public API. Before adding a
metric, confirm that:

- it represents an actionable operational signal;
- its labels have bounded cardinality;
- it uses a base unit and Prometheus naming conventions;
- it does not expose machine names, usernames, session IDs, IP addresses, or
  other unnecessary identifiers;
- its absence and failure behavior are documented and tested.

Breaking telemetry changes require explicit migration notes and appropriate
semantic versioning.

## Pull request checklist

- [ ] No production or customer data is included.
- [ ] Unit tests pass on PowerShell 7.
- [ ] PSScriptAnalyzer reports no warnings or errors.
- [ ] Prometheus exposition passes `promtool check metrics`.
- [ ] The Compose smoke test passes when container behavior changes.
- [ ] Documentation and `CHANGELOG.md` reflect operator-visible changes.
- [ ] Generated SVG diagrams match their versioned Mermaid sources.

Security reports must follow `SECURITY.md`, not the public issue tracker.
