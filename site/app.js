import {
  DEFAULTS,
  GROUPS,
  ScenarioError,
  evaluateAlerts,
  scrape,
  syntheticSnapshot,
} from './lib/playground.js';
import { ALERT_RULES, PRESETS, VERSION } from './lib/presets.js';

const $ = (id) => document.getElementById(id);
const FEATURES = ['MPS_ENT_CCU', 'XDT_ENT_UD'];
const SCRAPE_INTERVAL_MS = 5000;
const REPLAY_INTERVAL_MS = 400;
const STEP_MINUTES = 10;
const MAX_FOR_MINUTES = 15;
const SVG = 'http://www.w3.org/2000/svg';

const blankSite = () => ({
  followCurve: true,
  load: 60,
  disconnected: DEFAULTS.disconnectedPercent,
  slowdown: DEFAULTS.logonSlowdownSeconds,
  unregistered: Object.fromEntries(GROUPS.map((group) => [group.deliveryGroup, null])),
  licenses: { ...DEFAULTS.licenseTotals },
  brokerDown: false,
  licensingDown: false,
});

const state = {
  ...blankSite(),
  clock: 'replay', // live | replay | pinned
  minuteOfDay: 7 * 60,
  preset: 'normal-day',
  panel: 'sessions',
  showComments: false,
  errorCount: 0,
};

let previousValues = null;
let lastText = '';

// ------------------------------------------------------------------ helpers

const escapeHtml = (text) => String(text)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const pad = (number) => String(number).padStart(2, '0');
const clockText = (minute) => `${pad(Math.floor(minute / 60) % 24)}:${pad(minute % 60)}`;
const dayStart = (date) => Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
const minuteOf = (date) => date.getUTCHours() * 60 + date.getUTCMinutes();
const swatch = (colorVar) => `<span class="swatch" style="background:var(${colorVar})"></span>`;

function svg(tag, attributes, parent) {
  const element = document.createElementNS(SVG, tag);
  for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, value);
  parent?.appendChild(element);
  return element;
}

function currentTime() {
  if (state.clock === 'live') return new Date();
  return new Date(dayStart(new Date()) + state.minuteOfDay * 60000);
}

// Same shape as scenarios/*.json: only values that differ from the defaults.
function currentScenario() {
  const scenario = {};
  if (!state.followCurve) scenario.loadPercent = state.load;
  if (state.disconnected !== DEFAULTS.disconnectedPercent) scenario.disconnectedPercent = state.disconnected;
  const unregistered = Object.fromEntries(Object.entries(state.unregistered).filter(([, count]) => count !== null));
  if (Object.keys(unregistered).length) scenario.unregisteredVdas = unregistered;
  if (state.slowdown !== DEFAULTS.logonSlowdownSeconds) scenario.logonSlowdownSeconds = state.slowdown;
  if (FEATURES.some((feature) => state.licenses[feature] !== DEFAULTS.licenseTotals[feature])) {
    scenario.licenseTotals = { ...state.licenses };
  }
  if (state.brokerDown) scenario.brokerDown = true;
  if (state.licensingDown) scenario.licensingDown = true;
  return scenario;
}

// Validates like the exporter does at startup, then loads the values.
function applyScenario(scenario, presetId = null) {
  if (scenario === null || typeof scenario !== 'object' || Array.isArray(scenario)) {
    throw new ScenarioError('A scenario file must contain a JSON object.');
  }
  const { brokerDown, licensingDown, ...values } = scenario;
  syntheticSnapshot(values, new Date());

  Object.assign(state, blankSite());
  if (values.loadPercent !== undefined && values.loadPercent !== null) {
    state.followCurve = false;
    state.load = values.loadPercent;
  }
  state.disconnected = values.disconnectedPercent ?? DEFAULTS.disconnectedPercent;
  state.slowdown = values.logonSlowdownSeconds ?? DEFAULTS.logonSlowdownSeconds;
  for (const group of GROUPS) {
    const count = values.unregisteredVdas?.[group.deliveryGroup];
    if (count !== undefined && count !== null) state.unregistered[group.deliveryGroup] = count;
  }
  for (const feature of FEATURES) {
    state.licenses[feature] = values.licenseTotals?.[feature] ?? DEFAULTS.licenseTotals[feature];
  }
  state.brokerDown = Boolean(brokerDown);
  state.licensingDown = Boolean(licensingDown);
  state.preset = presetId;
}

function showError(message) {
  $('scenario-error').textContent = message;
  $('scenario-error').classList.add('show');
}

// ----------------------------------------------------------------- controls

function buildControls() {
  const select = $('preset');
  for (const preset of PRESETS) {
    select.add(new Option(preset.label, preset.id));
  }
  select.add(new Option('custom', 'custom'));
  select.addEventListener('change', () => {
    const preset = PRESETS.find((item) => item.id === select.value);
    if (!preset) return;
    applyScenario(structuredClone(preset.scenario), preset.id);
    update();
  });

  GROUPS.forEach((group, index) => {
    const row = document.createElement('div');
    row.className = 'row';
    row.dataset.group = group.deliveryGroup;
    row.innerHTML = `
      <label for="vda-${index}">${swatch(`--s${index + 1}`)}${escapeHtml(group.deliveryGroup)}</label>
      <output></output>
      <button type="button" class="auto" title="Random drop-offs that recover on their own">auto</button>
      <input type="range" id="vda-${index}" min="0" max="${group.machines}">`;
    row.querySelector('input').addEventListener('input', (event) => {
      state.unregistered[group.deliveryGroup] = Number(event.target.value);
      edited();
    });
    row.querySelector('.auto').addEventListener('click', () => {
      state.unregistered[group.deliveryGroup] = null;
      edited();
    });
    $('vda-controls').appendChild(row);
  });

  $('load').addEventListener('input', (event) => {
    state.followCurve = false;
    state.load = Number(event.target.value);
    edited();
  });
  $('load-auto').addEventListener('click', () => {
    state.followCurve = true;
    edited();
  });
  $('slowdown').addEventListener('input', (event) => {
    state.slowdown = Number(event.target.value);
    edited();
  });
  for (const [id, key] of [['broker-down', 'brokerDown'], ['licensing-down', 'licensingDown']]) {
    $(id).addEventListener('change', (event) => {
      state[key] = event.target.checked;
      edited();
    });
  }
  for (const feature of FEATURES) {
    const input = $(`lic-${feature}`);
    input.addEventListener('change', () => {
      const number = Number(input.value);
      if (input.value.trim() === '' || !Number.isInteger(number) || number < 0 || number > 100000) {
        showError(`${feature} must be a whole number from 0 to 100000.`);
        input.value = state.licenses[feature];
        return;
      }
      state.licenses[feature] = number;
      edited();
    });
  }
  $('reset').addEventListener('click', () => {
    applyScenario({}, 'normal-day');
    update();
  });

  $('clock-live').addEventListener('click', () => setClock('live'));
  $('clock-replay').addEventListener('click', () => setClock(state.clock === 'replay' ? 'pinned' : 'replay'));
  $('time').addEventListener('input', (event) => {
    state.clock = 'pinned';
    state.minuteOfDay = Number(event.target.value);
    update();
  });
  $('panel-select').addEventListener('change', (event) => {
    state.panel = event.target.value;
    update();
  });
  $('show-comments').addEventListener('change', (event) => {
    state.showComments = event.target.checked;
    update();
  });

  $('copy-metrics').addEventListener('click', async (event) => {
    const button = event.currentTarget;
    try {
      await navigator.clipboard.writeText(lastText);
      button.textContent = 'copied';
    } catch {
      button.textContent = 'failed';
    }
    setTimeout(() => { button.textContent = 'copy'; }, 1200);
  });
  $('download-scenario').addEventListener('click', () => {
    const blob = new Blob([$('scenario-json').textContent], { type: 'application/json' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = 'scenario.json';
    link.click();
    URL.revokeObjectURL(link.href);
  });
  $('open-file').addEventListener('change', async (event) => {
    const [file] = event.target.files;
    event.target.value = '';
    if (!file) return;
    try {
      applyScenario(JSON.parse(await file.text()));
      update();
    } catch (error) {
      showError(`${file.name}: ${error.message}`);
    }
  });
}

function edited() {
  state.preset = null;
  update();
}

function setClock(mode) {
  if (state.clock === 'live' && mode !== 'live') {
    state.minuteOfDay = Math.floor(minuteOf(new Date()) / STEP_MINUTES) * STEP_MINUTES;
  }
  state.clock = mode;
  update();
}

function syncControls(at) {
  $('preset').value = state.preset ?? 'custom';
  $('clock-live').setAttribute('aria-pressed', String(state.clock === 'live'));
  $('clock-replay').setAttribute('aria-pressed', String(state.clock === 'replay'));
  $('clock-replay').textContent = state.clock === 'replay' ? 'pause' : 'replay day';
  $('time').value = Math.floor(minuteOf(at) / STEP_MINUTES) * STEP_MINUTES;
  $('time-out').textContent = `${clockText(minuteOf(at))} UTC`;

  $('load').value = state.load;
  $('load-out').textContent = state.followCurve ? 'daily curve' : `${state.load}%`;
  $('load-auto').setAttribute('aria-pressed', String(state.followCurve));
  // An imported file may exceed the slider range; widen it instead of clamping.
  $('slowdown').max = Math.max(120, state.slowdown);
  $('slowdown').value = state.slowdown;
  $('slow-out').textContent = `+${state.slowdown} s`;

  for (const row of $('vda-controls').children) {
    const count = state.unregistered[row.dataset.group];
    row.querySelector('input').value = count ?? 0;
    row.querySelector('output').textContent = count === null ? 'random' : String(count);
    row.querySelector('.auto').setAttribute('aria-pressed', String(count === null));
  }
  for (const feature of FEATURES) {
    const input = $(`lic-${feature}`);
    if (document.activeElement !== input) input.value = state.licenses[feature];
  }
  $('broker-down').checked = state.brokerDown;
  $('licensing-down').checked = state.licensingDown;
}

// ------------------------------------------------------------------ shell

function renderShell(result) {
  const values = new Map();
  const html = [];
  for (const line of result.text.trimEnd().split('\n')) {
    if (line.startsWith('#')) {
      if (state.showComments) html.push(`<span class="c">${escapeHtml(line)}</span>`);
      continue;
    }
    const split = line.lastIndexOf(' ');
    const key = line.slice(0, split);
    const value = line.slice(split + 1);
    values.set(key, value);
    const changed = previousValues && previousValues.get(key) !== value;
    const brace = key.indexOf('{');
    const name = brace < 0 ? key : key.slice(0, brace);
    const labels = brace < 0 ? '' : `<span class="l">${escapeHtml(key.slice(brace))}</span>`;
    html.push(`<span${changed ? ' class="chg"' : ''}>${escapeHtml(name)}${labels} <span class="v">${escapeHtml(value)}</span></span>`);
  }
  previousValues = values;
  lastText = result.text;
  $('metrics').innerHTML = html.join('');
}

// ------------------------------------------------------------------ alerts

// Prometheus semantics at one-minute resolution: a rule is pending while its
// condition holds and firing once it has held for the rule's `for` period.
// Earlier minutes are evaluated with the current scenario.
function alertStates(scenario, at) {
  const history = [];
  for (let back = 0; back <= MAX_FOR_MINUTES; back += 1) {
    const result = scrape(scenario, new Date(at.getTime() - back * 60000), { version: VERSION });
    history.push(new Map(evaluateAlerts(result).map((alert) => [`${alert.alert}|${alert.target}`, alert])));
  }
  return ALERT_RULES.map((rule) => {
    const active = [];
    for (const [key, alert] of history[0]) {
      if (alert.alert !== rule.name) continue;
      let held = 0;
      while (held + 1 < history.length && history[held + 1].has(key)) held += 1;
      active.push({ ...alert, held, firing: held >= rule.forMinutes });
    }
    const status = active.some((item) => item.firing) ? 'firing' : active.length ? 'pending' : 'inactive';
    return { ...rule, status, active };
  });
}

function renderRules(rules) {
  $('rules').innerHTML = rules.map((rule) => {
    const active = rule.active.map((item) => {
      const since = item.held >= MAX_FOR_MINUTES ? `≥${MAX_FOR_MINUTES}m` : item.held ? `${item.held}m` : "<1m";
      const target = item.target === 'exporter' ? '' : `${escapeHtml(item.target)} `;
      return `<div class="${item.firing ? 'firing' : 'pending'}">${target}<span>${escapeHtml(item.detail)} · for ${since}</span></div>`;
    }).join('');
    return `<li>
      <div class="head"><span class="state ${rule.status}">${rule.status}</span><span class="rname">${rule.name}</span><span class="for">for ${rule.forMinutes}m</span></div>
      <div class="expr">${escapeHtml(rule.expr)}</div>
      ${active ? `<div class="active">${active}</div>` : ''}
    </li>`;
  }).join('');
}

// ------------------------------------------------------------------ grafana panel

let historyCache = { key: null, points: null };

function dayHistory(scenario, at) {
  const start = dayStart(at);
  const key = `${start}|${JSON.stringify(scenario)}`;
  if (historyCache.key === key) return historyCache.points;
  const points = [];
  for (let minute = 0; minute <= 1440; minute += STEP_MINUTES) {
    let snapshot = null;
    try {
      snapshot = syntheticSnapshot(scenario, new Date(start + minute * 60000));
    } catch (error) {
      if (error instanceof ScenarioError) throw error;
    }
    points.push({ minute, snapshot });
  }
  historyCache = { key, points };
  return points;
}

const byGroup = (snapshot, reduce) => GROUPS.map((group) => reduce(
  snapshot.machines.filter((item) => item.deliveryGroup === group.deliveryGroup),
  snapshot.sessions.filter((item) => item.deliveryGroup === group.deliveryGroup),
));
const groupSeries = GROUPS.map((group, index) => ({ name: group.deliveryGroup, color: `--s${index + 1}` }));

const PANELS = {
  sessions: {
    series: groupSeries,
    stacked: true,
    format: (value) => String(Math.round(value)),
    values: (snapshot) => byGroup(snapshot, (machines, sessions) => sessions.length),
  },
  logon: {
    series: groupSeries,
    threshold: 30,
    format: (value) => `${value.toFixed(1)} s`,
    values: (snapshot) => byGroup(snapshot, (machines, sessions) => (sessions.length
      ? sessions.reduce((sum, item) => sum + item.logonDurationSeconds, 0) / sessions.length
      : null)),
  },
  licenses: {
    series: FEATURES.map((feature, index) => ({ name: feature, color: `--s${index + 1}` })),
    threshold: 90,
    yMax: 100,
    format: (value) => `${Math.round(value)}%`,
    values: (snapshot) => FEATURES.map((feature) => {
      const license = snapshot.licenses.find((item) => item.feature === feature);
      return license.total ? (license.inUse / license.total) * 100 : 0;
    }),
  },
  unregistered: {
    series: groupSeries,
    format: (value) => String(Math.round(value)),
    values: (snapshot) => byGroup(snapshot, (machines) => machines.filter((item) => item.registrationState === 'Unregistered').length),
  },
};

function niceMax(value) {
  if (value <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  for (const step of [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) if (step * magnitude >= value) return step * magnitude;
  return 10 * magnitude;
}

function renderPanel(history, now, nowMinute) {
  const panel = PANELS[state.panel];
  const points = history.map((point) => ({ minute: point.minute, values: point.snapshot && panel.values(point.snapshot) }));
  const current = now.snapshot && panel.values(now.snapshot);
  const width = 460;
  const height = 210;
  const m = { top: 6, right: 6, bottom: 20, left: 38 };
  const plotW = width - m.left - m.right;
  const plotH = height - m.top - m.bottom;

  let maximum = panel.threshold ? panel.threshold * 1.15 : 0;
  for (const point of points) {
    if (!point.values) continue;
    const values = point.values.map((value) => value ?? 0);
    maximum = Math.max(maximum, panel.stacked ? values.reduce((a, b) => a + b, 0) : Math.max(...values));
  }
  const yMax = panel.yMax ?? niceMax(maximum * 1.05);
  const x = (minute) => m.left + (minute / 1440) * plotW;
  const y = (value) => m.top + plotH - (Math.min(value, yMax) / yMax) * plotH;

  const hasData = points.some((point) => point.values);
  const root = svg('svg', { viewBox: `0 0 ${width} ${height}`, role: 'img', 'aria-label': $('panel-select').selectedOptions[0].text });
  for (let tick = 0; tick <= 4; tick += 1) {
    const value = (yMax / 4) * tick;
    svg('line', { class: 'grid', x1: m.left, x2: width - m.right, y1: y(value), y2: y(value) }, root);
    if (hasData) svg('text', { class: 'axis', x: m.left - 5, y: y(value) + 3.5, 'text-anchor': 'end' }, root).textContent = panel.format(value);
  }
  for (let hour = 0; hour <= 24; hour += 6) {
    svg('text', { class: 'axis', x: x(hour * 60), y: height - 4, 'text-anchor': hour === 0 ? 'start' : hour === 24 ? 'end' : 'middle' }, root)
      .textContent = `${pad(hour % 24)}:00`;
  }

  if (!hasData) {
    svg('text', { class: 'nodata', x: m.left + plotW / 2, y: m.top + plotH / 2, 'text-anchor': 'middle' }, root).textContent = 'No data';
  } else {
    const base = points.map(() => 0);
    panel.series.forEach((series, index) => {
      let d = '';
      let pen = false;
      const tops = [];
      for (const [i, point] of points.entries()) {
        const raw = point.values?.[index];
        if (raw === null || raw === undefined) { pen = false; tops.push(null); continue; }
        const value = panel.stacked ? base[i] + raw : raw;
        tops.push(value);
        d += `${pen ? 'L' : 'M'}${x(point.minute).toFixed(1)},${y(value).toFixed(1)}`;
        pen = true;
      }
      if (panel.stacked) {
        const lower = points.map((point, i) => `${x(point.minute).toFixed(1)},${y(base[i]).toFixed(1)}`).reverse();
        svg('path', { class: 'area', d: `${d}L${lower.join('L')}Z`, fill: `var(${series.color})`, stroke: `var(${series.color})` }, root);
        tops.forEach((value, i) => { if (value !== null) base[i] = value; });
      } else if (d) {
        svg('path', { class: 'line', d, stroke: `var(${series.color})` }, root);
      }
    });
    if (panel.threshold) {
      svg('line', { class: 'threshold', x1: m.left, x2: width - m.right, y1: y(panel.threshold), y2: y(panel.threshold) }, root);
    }
  }
  svg('line', { class: 'now', x1: x(nowMinute), x2: x(nowMinute), y1: m.top, y2: m.top + plotH }, root);

  const cross = svg('line', { class: 'cross', y1: m.top, y2: m.top + plotH, visibility: 'hidden' }, root);
  const hit = svg('rect', { class: 'hit', x: m.left, y: m.top, width: plotW, height: plotH }, root);
  const tooltip = $('tooltip');
  const nearest = (event) => {
    const box = root.getBoundingClientRect();
    const minute = ((((event.clientX - box.left) / box.width) * width - m.left) / plotW) * 1440;
    return points[Math.round(Math.min(1440, Math.max(0, minute)) / STEP_MINUTES)];
  };
  hit.addEventListener('pointermove', (event) => {
    const point = nearest(event);
    cross.setAttribute('x1', x(point.minute));
    cross.setAttribute('x2', x(point.minute));
    cross.setAttribute('visibility', 'visible');
    const rows = panel.series.map((series, index) => {
      const value = point.values?.[index];
      return `<div class="t-row">${swatch(series.color)}${escapeHtml(series.name)}<b>${value === null || value === undefined ? '—' : panel.format(value)}</b></div>`;
    }).join('');
    tooltip.innerHTML = `<div class="t-head">${clockText(point.minute)} UTC · click to pin</div>${rows}`;
    tooltip.hidden = false;
    tooltip.style.left = `${Math.max(8, Math.min(window.innerWidth - tooltip.offsetWidth - 8, event.clientX + 12))}px`;
    tooltip.style.top = `${Math.max(8, event.clientY - tooltip.offsetHeight - 10)}px`;
  });
  hit.addEventListener('pointerleave', () => {
    cross.setAttribute('visibility', 'hidden');
    tooltip.hidden = true;
  });
  hit.addEventListener('click', (event) => {
    state.clock = 'pinned';
    state.minuteOfDay = Math.min(1430, nearest(event).minute);
    update();
  });
  $('chart').replaceChildren(root);

  const rows = panel.series.map((series, index) => {
    const values = points.map((point) => point.values?.[index]).filter((value) => value !== null && value !== undefined);
    const last = current?.[index];
    return `<tr><td><span class="name">${swatch(series.color)}${escapeHtml(series.name)}</span></td>
      <td>${last === null || last === undefined ? '—' : panel.format(last)}</td>
      <td>${values.length ? panel.format(Math.max(...values)) : '—'}</td></tr>`;
  }).join('');
  $('legend').innerHTML = `<thead><tr><th></th><th>now</th><th>max today</th></tr></thead><tbody>${rows}</tbody>`;
}

// ------------------------------------------------------------------ update

function update() {
  $('scenario-error').classList.remove('show');
  const scenario = currentScenario();
  const at = currentTime();
  let result;
  try {
    result = scrape(scenario, at, { version: VERSION, errorCount: state.errorCount });
  } catch (error) {
    showError(error.message);
    return;
  }
  if (!result.success) state.errorCount += 1;

  syncControls(at);
  $('scenario-json').textContent = `${JSON.stringify(scenario, null, 2)}\n`;
  renderShell(result);
  renderRules(alertStates(scenario, at));
  renderPanel(dayHistory(scenario, at), result, minuteOf(at));
}

buildControls();
update();
setInterval(() => { if (state.clock === 'live') update(); }, SCRAPE_INTERVAL_MS);
setInterval(() => {
  if (state.clock !== 'replay') return;
  state.minuteOfDay = (state.minuteOfDay + STEP_MINUTES) % 1440;
  update();
}, REPLAY_INTERVAL_MS);
