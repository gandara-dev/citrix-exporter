// Page data that must stay in sync with files outside site/. The Node suite
// checks each preset against scenarios/*.json, the version against the module
// manifest, and the `for` periods against monitoring/alerts.yml.

export const VERSION = '0.2.0';

export const PRESETS = Object.freeze([
  {
    id: 'normal-day',
    label: 'Normal day',
    file: null,
    description: 'Load follows the daily curve; VDAs occasionally drop off and come back.',
    scenario: {},
  },
  {
    id: 'monday-morning',
    label: 'Monday morning',
    file: 'monday-morning.json',
    description: 'Logon storm: near full load, four Engineering VDAs unregistered, logons 12 s slower.',
    scenario: {
      loadPercent: 95,
      disconnectedPercent: 5,
      unregisteredVdas: { 'Engineering Desktops': 4 },
      logonSlowdownSeconds: 12,
    },
  },
  {
    id: 'slow-logons',
    label: 'Slow logons',
    file: 'slow-logons.json',
    description: 'Every logon takes 35 s longer, as with a slow profile or GPO phase.',
    scenario: { logonSlowdownSeconds: 35 },
  },
  {
    id: 'vda-registration-outage',
    label: 'VDA registration outage',
    file: 'vda-registration-outage.json',
    description: 'Twelve Finance and three Engineering VDAs lose registration, as after a controller DNS change.',
    scenario: { unregisteredVdas: { 'Finance Apps': 12, 'Engineering Desktops': 3 } },
  },
  {
    id: 'license-exhaustion',
    label: 'License exhaustion',
    file: 'license-exhaustion.json',
    description: 'Full load against smaller license pools.',
    scenario: { loadPercent: 100, licenseTotals: { MPS_ENT_CCU: 35, XDT_ENT_UD: 60 } },
  },
  {
    id: 'broker-outage',
    label: 'Broker outage',
    file: 'broker-outage.json',
    description: 'The Broker SDK call fails on every scrape; the exporter stays up and omits Citrix data.',
    scenario: { brokerDown: true },
  },
]);

// The `for` period of each rule in monitoring/alerts.yml.
export const ALERT_FOR = Object.freeze({
  CitrixExporterCollectionFailing: '5m',
  CitrixVdasUnregistered: '10m',
  CitrixLicensesNearlyExhausted: '15m',
  CitrixSlowLogons: '15m',
});
