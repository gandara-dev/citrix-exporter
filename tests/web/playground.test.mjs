// Asserts the Metrics Playground engine against fixtures generated from the
// PowerShell exporter, byte for byte.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import {
  ALERT_THRESHOLDS,
  evaluateAlerts,
  scrape,
  selfMetrics,
  syntheticSnapshot,
  toPrometheusText,
} from '../../site/lib/playground.js';
import { ALERT_RULES, PRESETS, VERSION } from '../../site/lib/presets.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (relative) => readFileSync(path.join(root, relative), 'utf8');
const fixtures = JSON.parse(read('tests/fixtures/playground-cases.json'));

for (const item of fixtures.cases) {
  test(`scenario: ${item.name}`, () => {
    const run = () => toPrometheusText(syntheticSnapshot(item.scenario, new Date(item.at)));
    if (item.error) {
      assert.throws(run, { message: item.error });
    } else {
      assert.equal(run(), item.text);
    }
  });
}

test('self metrics match the exporter', () => {
  assert.equal(
    selfMetrics({ success: true, durationSeconds: 0.042, errorCount: 0, mode: 'simulation', version: fixtures.version }),
    fixtures.selfMetrics,
  );
});

test('the page reports the module version', () => {
  const manifest = read('src/CitrixExporter/CitrixExporter.psd1');
  assert.match(manifest, new RegExp(`ModuleVersion = '${fixtures.version.replace(/\./g, '\\.')}'`));
  assert.equal(VERSION, fixtures.version);
});

test('every scenario file has a page preset with the same content', () => {
  const files = readdirSync(path.join(root, 'scenarios')).filter((name) => name.endsWith('.json')).sort();
  const presetFiles = PRESETS.map((preset) => preset.file).filter(Boolean).sort();
  assert.deepEqual(presetFiles, files);
  for (const preset of PRESETS.filter((item) => item.file)) {
    assert.deepEqual(preset.scenario, JSON.parse(read(`scenarios/${preset.file}`)), preset.file);
  }
});

test('every preset is a valid scenario', () => {
  for (const preset of PRESETS) {
    const result = scrape(preset.scenario, new Date('2026-09-28T09:00:00Z'), { version: VERSION });
    assert.equal(result.success, !preset.scenario.brokerDown, preset.id);
  }
});

test('the page shows the rules exactly as monitoring/alerts.yml defines them', () => {
  const rules = read('monitoring/alerts.yml');
  const parsed = Object.fromEntries([...rules.matchAll(/- alert: (\w+)[\s\S]*?for: (\d+)m/g)].map((match) => [match[1], Number(match[2])]));
  assert.deepEqual(parsed, Object.fromEntries(ALERT_RULES.map((rule) => [rule.name, rule.forMinutes])));
  const normalized = rules.replace(/\s+/g, ' ');
  for (const rule of ALERT_RULES) assert.ok(normalized.includes(`expr: ${rule.expr}`) || normalized.includes(`expr: >- ${rule.expr}`), rule.name);
});

test('alert thresholds match monitoring/alerts.yml', () => {
  const rules = read('monitoring/alerts.yml');
  assert.match(rules, new RegExp(`sum by \\(delivery_group\\) \\(citrix_vdas\\) > ${ALERT_THRESHOLDS.unregisteredRatio}\\b`));
  assert.match(rules, new RegExp(`citrix_licenses_in_use / citrix_licenses > ${ALERT_THRESHOLDS.licenseRatio}\\b`));
  assert.match(rules, new RegExp(`citrix_logon_duration_seconds > ${ALERT_THRESHOLDS.logonSeconds}\\b`));
});

test('a collection failure omits data metrics and fires the failure alert', () => {
  const result = scrape({ brokerDown: true }, new Date('2026-09-28T13:30:00Z'), { version: fixtures.version });
  assert.equal(result.success, false);
  assert.match(result.text, /^citrix_exporter_scrape_success 0$/m);
  assert.match(result.text, /^citrix_exporter_scrape_errors_total 1$/m);
  assert.doesNotMatch(result.text, /^citrix_(vdas|sessions|licenses|mcs_catalog)/m);
  assert.deepEqual(evaluateAlerts(result).map((alert) => alert.alert), ['CitrixExporterCollectionFailing']);
});

test('the stress scenario fires unregistered, license, and logon alerts', () => {
  const result = scrape({
    loadPercent: 100,
    unregisteredVdas: { 'Finance Apps': 8 },
    logonSlowdownSeconds: 30,
    licenseTotals: { XDT_ENT_UD: 60 },
  }, new Date('2026-09-28T13:30:00Z'), { version: fixtures.version });
  const fired = evaluateAlerts(result).map((alert) => `${alert.alert}:${alert.target}`);
  assert.ok(fired.includes('CitrixVdasUnregistered:Finance Apps'));
  assert.ok(fired.includes('CitrixLicensesNearlyExhausted:XDT_ENT_UD'));
  assert.ok(fired.includes('CitrixSlowLogons:Engineering Desktops'));
});

test('the default scenario at night fires nothing', () => {
  const result = scrape(null, new Date('2026-09-28T03:00:00Z'), { version: fixtures.version });
  assert.deepEqual(evaluateAlerts(result), []);
});
