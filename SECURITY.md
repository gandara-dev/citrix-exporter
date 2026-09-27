# Security Policy

## Supported versions

Security fixes are applied to the latest released minor version. This project is
currently pre-1.0; review the changelog before upgrading because operational
interfaces may still evolve.

## Reporting a vulnerability

Do not open a public issue for a suspected vulnerability. Use GitHub Private
Vulnerability Reporting for this repository when available. If that channel is
not enabled, contact the maintainer through the private contact method listed on
the GitHub profile and include only the minimum information needed to reproduce
the issue.

Do not include real credentials, customer names, hostnames, session data,
license files, or unredacted logs. A useful report contains:

- affected version or commit;
- deployment mode and operating system;
- a synthetic reproduction;
- expected and observed behavior;
- impact and any known workaround.

## Security boundaries

- The exporter implements no authentication or TLS.
- The HTTP listener exposes operational inventory aggregates.
- The process inherits the service identity's Citrix SDK and filesystem access.
- `lmstat.exe` is executed from an operator-supplied local path.
- Warning logs can contain upstream exception messages.
- The Compose stack enables anonymous Grafana viewing for local demonstration.

Bind to loopback or a protected management interface. Use an authenticated TLS
reverse proxy for remote access, apply least-privilege Citrix delegation, and
protect process logs as operational data.

## Secret handling

The exporter has no credential parameters and does not persist secrets. Establish
Citrix authentication through the supported SDK environment and service identity.
Never place passwords, tokens, customer evidence, or production exports in the
repository, command line, Compose file, issues, or test fixtures.
