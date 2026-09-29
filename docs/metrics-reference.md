# Metrics Reference

Citrix Exporter emits Prometheus text exposition format `0.0.4`. Citrix values
are regenerated on every successful `/metrics` request; exporter self-metrics
are generated for every request, including failed collections.

## Citrix metrics

### `citrix_vdas`

Gauge containing the current machine count grouped by `delivery_group` and
`registration_state`. It is derived from `Get-BrokerMachine`.

```promql
sum(citrix_vdas{registration_state="Unregistered"})
```

### `citrix_sessions`

Gauge containing the current session count grouped by `delivery_group`, `state`,
and `protocol`. It is derived from `Get-BrokerSession`.

```promql
sum by (state) (citrix_sessions)
```

### `citrix_logon_duration_seconds`

Gauge containing the arithmetic mean of `BrokeringDuration` plus
`EstablishmentDuration` for sessions in each delivery group, converted from
milliseconds to seconds. It describes the current Broker session snapshot; it
is not a histogram and does not represent historical percentiles.

```promql
max(citrix_logon_duration_seconds)
```

### `citrix_licenses`

Gauge containing the number of licenses issued per `feature`. It exists only
when both licensing arguments are configured and the feature appears in
`lmstat -a` output.

### `citrix_licenses_in_use`

Gauge containing current license checkouts per `feature`, parsed from the same
`lmstat` aggregate line.

```promql
citrix_licenses_in_use / citrix_licenses
```

### `citrix_mcs_catalog_machines`

Gauge containing the current machine count per `catalog`. Only catalogs whose
Broker SDK `ProvisioningType` is `MCS` are emitted.

## Exporter self-metrics

### `citrix_exporter_scrape_success`

Gauge set to `1` when the most recent collection and rendering operation
succeeded, otherwise `0`. A value of `0` is returned with HTTP 200 so Prometheus
can ingest the failure signal.

### `citrix_exporter_scrape_duration_seconds`

Gauge measuring wall-clock time spent collecting and rendering the most recent
snapshot.

### `citrix_exporter_scrape_errors_total`

Counter incremented after every failed collection. It resets when the exporter
process restarts.

### `citrix_exporter_build_info`

Constant gauge with value `1` and two labels:

- `version`: module contract version;
- `mode`: `simulation` or `production`.

## No-data behavior

The exporter does not manufacture zero-valued series for absent Citrix objects.
If a delivery group, state, feature, or catalog is absent from the snapshot, its
series is absent. Use PromQL aggregation and explicit defaults only when that
matches the intended alert semantics.

Licensing series are absent when licensing collection is not configured. That
is different from a failed collection, which sets
`citrix_exporter_scrape_success` to `0` and suppresses all Citrix series for that
request.

## Alert rules

[`monitoring/alerts.yml`](../monitoring/alerts.yml) ships four example rules,
covered by `promtool` unit tests in `monitoring/alerts.test.yml`:

| Alert | Condition | `for` |
|---|---|---|
| `CitrixExporterCollectionFailing` | `citrix_exporter_scrape_success == 0` | 5m |
| `CitrixVdasUnregistered` | more than 5% of a delivery group's VDAs unregistered | 10m |
| `CitrixLicensesNearlyExhausted` | more than 90% of a feature's licenses in use | 15m |
| `CitrixSlowLogons` | average logon above 30 s in a delivery group | 15m |

Tune thresholds, `for` durations, and routing to the environment. The rules are
a starting point, not production alert policy.

## Compatibility policy

Metric names, types, label names, and units form the public telemetry contract.
A breaking change requires a new major version or an explicitly documented
migration. New metrics or new values for an existing bounded label are additive.
