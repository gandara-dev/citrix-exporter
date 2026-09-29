// Browser port of the Citrix Exporter synthetic site and Prometheus renderer.
//
// It mirrors Get-SimulatedCitrixSnapshot, ConvertTo-CitrixPrometheusText, and
// Get-CitrixExporterSelfMetric. Every value is integer arithmetic on the
// scenario and the collection minute, and the Node suite asserts the output
// byte for byte against fixtures generated from the PowerShell module.

export const GROUPS = Object.freeze([
  { deliveryGroup: 'Finance Apps', catalog: 'MCS Windows 11', provisioningType: 'MCS', machines: 40, license: 'MPS_ENT_CCU', seed: 1 },
  { deliveryGroup: 'Engineering Desktops', catalog: 'MCS Engineering', provisioningType: 'MCS', machines: 60, license: 'XDT_ENT_UD', seed: 2 },
  { deliveryGroup: 'Remote PCs', catalog: 'Physical Devices', provisioningType: 'Manual', machines: 10, license: 'XDT_ENT_UD', seed: 3 },
]);

export const LOAD_CURVE = Object.freeze([4, 3, 3, 3, 4, 8, 20, 45, 70, 85, 90, 92, 88, 90, 92, 88, 80, 60, 35, 20, 12, 8, 6, 5]);

export const DEFAULTS = Object.freeze({
  loadPercent: null,
  disconnectedPercent: 15,
  logonSlowdownSeconds: 0,
  unregisteredVdas: null,
  licenseTotals: { MPS_ENT_CCU: 50, XDT_ENT_UD: 80 },
  brokerDown: false,
  licensingDown: false,
});

// Thresholds from monitoring/alerts.yml; the Node suite checks they match.
export const ALERT_THRESHOLDS = Object.freeze({
  unregisteredRatio: 0.05,
  licenseRatio: 0.9,
  logonSeconds: 30,
});

export class ScenarioError extends Error {}
export class CollectionError extends Error {}

const value = (scenario, name) => (scenario && Object.hasOwn(scenario, name) ? scenario[name] : DEFAULTS[name]);
const mapValue = (map, key) => (map && Object.hasOwn(map, key) ? map[key] : null);

function integer(input, name, minimum, maximum) {
  if (!Number.isInteger(input) || input < minimum || input > maximum) {
    throw new ScenarioError(`Scenario value '${name}' must be a whole number from ${minimum} to ${maximum}.`);
  }
  return input;
}

const jitter = (minute, seed) => ((minute * 7919 + seed * 104729) % 101) - 50;

export function syntheticSnapshot(scenario = null, at = new Date()) {
  if (value(scenario, 'brokerDown')) {
    throw new CollectionError('Injected Broker collection failure.');
  }
  let loadOverride = value(scenario, 'loadPercent');
  if (loadOverride !== null && loadOverride !== undefined) {
    loadOverride = integer(loadOverride, 'loadPercent', 0, 100);
  } else {
    loadOverride = null;
  }
  const disconnectedPercent = integer(value(scenario, 'disconnectedPercent'), 'disconnectedPercent', 0, 100);
  const slowdown = integer(value(scenario, 'logonSlowdownSeconds'), 'logonSlowdownSeconds', 0, 600);
  const unregisteredMap = value(scenario, 'unregisteredVdas');
  const licenseTotals = value(scenario, 'licenseTotals');

  const minute = Math.floor(Math.floor(at.getTime() / 1000) / 60);
  const hour = Math.floor(minute / 60) % 24;
  const minuteOfHour = minute % 60;
  const baseLoad = loadOverride !== null
    ? loadOverride * 60
    : LOAD_CURVE[hour] * (60 - minuteOfHour) + LOAD_CURVE[(hour + 1) % 24] * minuteOfHour;

  const machines = [];
  const sessions = [];
  const catalogs = [];
  const inUse = {};

  for (const group of GROUPS) {
    const override = mapValue(unregisteredMap, group.deliveryGroup);
    let unregistered;
    if (override !== null) {
      unregistered = integer(override, `unregisteredVdas.${group.deliveryGroup}`, 0, group.machines);
    } else {
      const pick = (minute * 31 + group.seed * 17) % 23;
      unregistered = pick === 0 ? 2 : pick < 3 ? 1 : 0;
    }
    const registered = group.machines - unregistered;
    for (let index = 0; index < group.machines; index += 1) {
      machines.push({
        deliveryGroup: group.deliveryGroup,
        catalog: group.catalog,
        registrationState: index < registered ? 'Registered' : 'Unregistered',
      });
    }

    const load = loadOverride !== null
      ? baseLoad
      : Math.min(6000, Math.max(0, baseLoad + jitter(minute, group.seed) * 6));
    const sessionCount = Math.floor((registered * load + 3000) / 6000);
    const disconnected = Math.floor((sessionCount * disconnectedPercent + 50) / 100);
    const logonTenths = 85 + group.seed * 10 + Math.floor(load / 200)
      + (((minute * 13 + group.seed * 7) % 21) - 10) + slowdown * 10;
    const logonSeconds = Math.max(10, logonTenths) / 10;
    for (let index = 0; index < sessionCount; index += 1) {
      sessions.push({
        deliveryGroup: group.deliveryGroup,
        state: index < sessionCount - disconnected ? 'Active' : 'Disconnected',
        protocol: 'HDX',
        logonDurationSeconds: logonSeconds,
      });
    }
    catalogs.push({ name: group.catalog, provisioningType: group.provisioningType, machineCount: group.machines });
    inUse[group.license] = (inUse[group.license] || 0) + sessionCount;
  }

  if (value(scenario, 'licensingDown')) {
    throw new CollectionError('Injected Licensing collection failure.');
  }

  const licenses = ['MPS_ENT_CCU', 'XDT_ENT_UD'].map((feature) => {
    let total = mapValue(licenseTotals, feature);
    if (total === null) total = DEFAULTS.licenseTotals[feature];
    total = integer(total, `licenseTotals.${feature}`, 0, 100000);
    return { feature, total, inUse: Math.min(total, inUse[feature] || 0) };
  });

  return { collectedAt: at, machines, sessions, catalogs, licenses };
}

// --------------------------------------------------------------- rendering

const labelValue = (text) => String(text).replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/"/g, '\\"');

function sample(name, labels, number) {
  const entries = Object.entries(labels);
  const labelText = entries.length
    ? `{${entries.map(([key, text]) => `${key}="${labelValue(text)}"`).join(',')}}`
    : '';
  return `${name}${labelText} ${formatNumber(number)}`;
}

export function formatNumber(number) {
  return String(number);
}

function groupBy(items, keyOf) {
  const groups = new Map();
  for (const item of items) {
    const key = keyOf(item);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  }
  return [...groups].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
}

export function toPrometheusText(snapshot) {
  const lines = [
    '# HELP citrix_vdas Number of VDAs by delivery group and registration state.',
    '# TYPE citrix_vdas gauge',
  ];
  for (const [, group] of groupBy(snapshot.machines, (item) => `${item.deliveryGroup}, ${item.registrationState}`)) {
    lines.push(sample('citrix_vdas', {
      delivery_group: group[0].deliveryGroup,
      registration_state: group[0].registrationState,
    }, group.length));
  }

  lines.push('# HELP citrix_sessions Number of Citrix sessions by delivery group, state, and protocol.');
  lines.push('# TYPE citrix_sessions gauge');
  for (const [, group] of groupBy(snapshot.sessions, (item) => `${item.deliveryGroup}, ${item.state}, ${item.protocol}`)) {
    lines.push(sample('citrix_sessions', {
      delivery_group: group[0].deliveryGroup,
      state: group[0].state,
      protocol: group[0].protocol,
    }, group.length));
  }

  lines.push('# HELP citrix_logon_duration_seconds Average session logon duration by delivery group.');
  lines.push('# TYPE citrix_logon_duration_seconds gauge');
  for (const [name, group] of groupBy(snapshot.sessions, (item) => item.deliveryGroup)) {
    let sum = 0;
    for (const item of group) sum += item.logonDurationSeconds;
    lines.push(sample('citrix_logon_duration_seconds', { delivery_group: name }, Math.round((sum / group.length) * 1000) / 1000));
  }

  lines.push('# HELP citrix_licenses Number of licenses issued by feature.');
  lines.push('# TYPE citrix_licenses gauge');
  lines.push('# HELP citrix_licenses_in_use Number of licenses currently in use by feature.');
  lines.push('# TYPE citrix_licenses_in_use gauge');
  for (const license of [...snapshot.licenses].sort((a, b) => (a.feature < b.feature ? -1 : 1))) {
    lines.push(sample('citrix_licenses', { feature: license.feature }, license.total));
    lines.push(sample('citrix_licenses_in_use', { feature: license.feature }, license.inUse));
  }

  lines.push('# HELP citrix_mcs_catalog_machines Number of machines in each MCS catalog.');
  lines.push('# TYPE citrix_mcs_catalog_machines gauge');
  for (const catalog of snapshot.catalogs.filter((item) => item.provisioningType === 'MCS')
    .sort((a, b) => (a.name < b.name ? -1 : 1))) {
    lines.push(sample('citrix_mcs_catalog_machines', { catalog: catalog.name }, catalog.machineCount));
  }
  return `${lines.join('\n')}\n`;
}

export function selfMetrics({ success, durationSeconds, errorCount, mode, version }) {
  return [
    '# HELP citrix_exporter_scrape_success Whether the last collection succeeded.',
    '# TYPE citrix_exporter_scrape_success gauge',
    `citrix_exporter_scrape_success ${success ? 1 : 0}`,
    '# HELP citrix_exporter_scrape_duration_seconds Time spent collecting Citrix metrics.',
    '# TYPE citrix_exporter_scrape_duration_seconds gauge',
    `citrix_exporter_scrape_duration_seconds ${formatNumber(durationSeconds)}`,
    '# HELP citrix_exporter_scrape_errors_total Total number of failed collections since startup.',
    '# TYPE citrix_exporter_scrape_errors_total counter',
    `citrix_exporter_scrape_errors_total ${errorCount}`,
    '# HELP citrix_exporter_build_info Exporter build and operating mode information.',
    '# TYPE citrix_exporter_build_info gauge',
    `citrix_exporter_build_info{version="${version}",mode="${mode}"} 1`,
  ].join('\n') + '\n';
}

// Mirrors the exporter's /metrics response: data metrics only on success.
export function scrape(scenario, at, { version, errorCount = 0, durationSeconds = 0.042 } = {}) {
  try {
    const snapshot = syntheticSnapshot(scenario, at);
    return {
      success: true,
      snapshot,
      text: selfMetrics({ success: true, durationSeconds, errorCount, mode: 'simulation', version }) + toPrometheusText(snapshot),
    };
  } catch (error) {
    if (!(error instanceof CollectionError)) throw error;
    return {
      success: false,
      error: error.message,
      snapshot: null,
      text: selfMetrics({ success: false, durationSeconds, errorCount: errorCount + 1, mode: 'simulation', version }),
    };
  }
}

// Instant evaluation of the alert expressions in monitoring/alerts.yml.
// Prometheus also requires each condition to hold for the rule's `for` period.
export function evaluateAlerts(result) {
  const alerts = [];
  if (!result.success) {
    alerts.push({ alert: 'CitrixExporterCollectionFailing', severity: 'critical', target: 'exporter', detail: result.error });
    return alerts;
  }
  const { snapshot } = result;
  for (const group of GROUPS) {
    const all = snapshot.machines.filter((item) => item.deliveryGroup === group.deliveryGroup);
    const unregistered = all.filter((item) => item.registrationState === 'Unregistered').length;
    if (all.length && unregistered / all.length > ALERT_THRESHOLDS.unregisteredRatio) {
      alerts.push({
        alert: 'CitrixVdasUnregistered', severity: 'warning', target: group.deliveryGroup,
        detail: `${unregistered} of ${all.length} VDAs unregistered`,
      });
    }
  }
  for (const license of snapshot.licenses) {
    if (license.total > 0 && license.inUse / license.total > ALERT_THRESHOLDS.licenseRatio) {
      alerts.push({
        alert: 'CitrixLicensesNearlyExhausted', severity: 'warning', target: license.feature,
        detail: `${license.inUse} of ${license.total} in use`,
      });
    }
  }
  for (const group of GROUPS) {
    const sessions = snapshot.sessions.filter((item) => item.deliveryGroup === group.deliveryGroup);
    if (!sessions.length) continue;
    const average = sessions.reduce((sum, item) => sum + item.logonDurationSeconds, 0) / sessions.length;
    if (average > ALERT_THRESHOLDS.logonSeconds) {
      alerts.push({
        alert: 'CitrixSlowLogons', severity: 'warning', target: group.deliveryGroup,
        detail: `average logon ${Math.round(average * 10) / 10} s`,
      });
    }
  }
  return alerts;
}
