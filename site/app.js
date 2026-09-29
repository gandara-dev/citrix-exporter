import {
  DEFAULTS,
  GROUPS,
  ScenarioError,
  evaluateAlerts,
  scrape,
  syntheticSnapshot,
} from './lib/playground.js';
import { ALERT_FOR, PRESETS, VERSION } from './lib/presets.js';

const $ = (id) => document.getElementById(id);
const FEATURES = ['MPS_ENT_CCU', 'XDT_ENT_UD'];
const TOTAL_VDAS = GROUPS.reduce((sum, group) => sum + group.machines, 0);
const SCRAPE_INTERVAL_MS = 5000;
const REPLAY_INTERVAL_MS = 350;
const STEP_MINUTES = 10;
const SVG = 'http://www.w3.org/2000/svg';
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const initialState = () => ({
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
  ...initialState(),
  clock: 'replay', // live | replay | pinned
  minuteOfDay: 360,
  preset: 'normal-day',
  tab: 'sessions',
  showComments: false,
  errorCount: 0,
};

let previousValues = null;

// ------------------------------------------------------------------ helpers

const escapeHtml = (text) => String(text)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const pad = (number) => String(number).padStart(2, '0');
const clockText = (minute) => `${pad(Math.floor(minute / 60) % 24)}:${pad(minute % 60)}`;
const color = (index) => `var(--s${index + 1})`;
const swatch = (index) => `<span class="swatch" style="background:${color(index)}"></span>`;
const dayStart = (date) => Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
const minuteOf = (date) => date.getUTCHours() * 60 + date.getUTCMinutes();

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

  Object.assign(state, initialState());
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
  for (const preset of PRESETS) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = preset.label;
    button.title = preset.description;
    button.dataset.preset = preset.id;
    button.addEventListener('click', () => {
      applyScenario(structuredClone(preset.scenario), preset.id);
      update();
    });
    $('presets').appendChild(button);
  }

  GROUPS.forEach((group, index) => {
    const row = document.createElement('div');
    row.className = 'ctl';
    row.dataset.group = group.deliveryGroup;
    const id = `vda-${index}`;
    row.innerHTML = `
      <div class="ctl-head"><label for="${id}">${swatch(index)}${escapeHtml(group.deliveryGroup)}</label><output></output><button type="button" class="auto" title="Random drop-offs that recover on their own">auto</button></div>
      <input type="range" id="${id}" min="0" max="${group.machines}">`;
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
  $('broker-down').addEventListener('change', (event) => {
    state.brokerDown = event.target.checked;
    edited();
  });
  $('licensing-down').addEventListener('change', (event) => {
    state.licensingDown = event.target.checked;
    edited();
  });
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
    state.clock = 'live';
    update();
  });

  $('clock-live').addEventListener('click', () => setClock('live'));
  $('clock-replay').addEventListener('click', () => setClock(state.clock === 'replay' ? 'pinned' : 'replay'));
  $('time').addEventListener('input', (event) => {
    state.clock = 'pinned';
    state.minuteOfDay = Number(event.target.value);
    update();
  });

  for (const tab of ['sessions', 'logon']) {
    $(`tab-${tab}`).addEventListener('click', () => {
      state.tab = tab;
      update();
    });
  }
  $('show-comments').addEventListener('change', (event) => {
    state.showComments = event.target.checked;
    update();
  });

  $('copy-metrics').addEventListener('click', async (event) => {
    const button = event.currentTarget;
    try {
      await navigator.clipboard.writeText(lastResult.text);
      button.textContent = 'Copied';
    } catch {
      button.textContent = 'Failed';
    }
    setTimeout(() => { button.textContent = 'Copy'; }, 1200);
  });
  $('download-scenario').addEventListener('click', () => {
    const blob = new Blob([`${JSON.stringify(currentScenario(), null, 2)}\n`], { type: 'application/json' });
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

function syncControls() {
  for (const button of $('presets').children) {
    button.setAttribute('aria-pressed', String(button.dataset.preset === state.preset));
  }
  const at = currentTime();
  $('clock-live').setAttribute('aria-pressed', String(state.clock === 'live'));
  $('clock-replay').setAttribute('aria-pressed', String(state.clock === 'replay'));
  $('clock-replay').textContent = state.clock === 'replay' ? 'Pause' : 'Replay day';
  $('time').value = Math.floor(minuteOf(at) / STEP_MINUTES) * STEP_MINUTES;
  $('time-out').textContent = `${clockText(minuteOf(at))} UTC`;

  $('load').value = state.load;
  $('load-out').textContent = state.followCurve ? '' : `${state.load}%`;
  $('load-auto').setAttribute('aria-pressed', String(state.followCurve));
  // An imported file may exceed the slider range; widen it instead of clamping.
  $('slowdown').max = Math.max(120, state.slowdown);
  $('slowdown').value = state.slowdown;
  $('slow-out').textContent = state.slowdown ? `+${state.slowdown} s` : 'none';

  for (const row of $('vda-controls').children) {
    const count = state.unregistered[row.dataset.group];
    row.querySelector('input').value = count ?? 0;
    row.querySelector('output').textContent = count === null ? '' : String(count);
    row.querySelector('.auto').setAttribute('aria-pressed', String(count === null));
  }
  for (const feature of FEATURES) {
    const input = $(`lic-${feature}`);
    if (document.activeElement !== input) input.value = state.licenses[feature];
  }
  $('broker-down').checked = state.brokerDown;
  $('licensing-down').checked = state.licensingDown;
  $('tab-sessions').setAttribute('aria-selected', String(state.tab === 'sessions'));
  $('tab-logon').setAttribute('aria-selected', String(state.tab === 'logon'));
}

// ------------------------------------------------------------------ history

let historyCache = { key: null, points: null };

// One collection every ten minutes of the current UTC day.
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

function groupStats(snapshot) {
  return GROUPS.map((group) => {
    const machines = snapshot.machines.filter((item) => item.deliveryGroup === group.deliveryGroup);
    const sessions = snapshot.sessions.filter((item) => item.deliveryGroup === group.deliveryGroup);
    const registered = machines.filter((item) => item.registrationState === 'Registered').length;
    return {
      name: group.deliveryGroup,
      machines: machines.length,
      registered,
      sessions: sessions.length,
      disconnected: sessions.filter((item) => item.state === 'Disconnected').length,
      logon: sessions.length ? sessions.reduce((sum, item) => sum + item.logonDurationSeconds, 0) / sessions.length : null,
    };
  });
}

// ------------------------------------------------------------------- chart

function niceMax(value) {
  if (value <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  for (const step of [1, 2, 2.5, 5, 10]) if (step * magnitude >= value) return step * magnitude;
  return 10 * magnitude;
}

function drawChart(points, nowMinute) {
  const stacked = state.tab === 'sessions';
  const threshold = stacked ? null : 30;
  const width = 640;
  const height = 230;
  const m = { top: 10, right: 8, bottom: 22, left: 34 };
  const plotW = width - m.left - m.right;
  const plotH = height - m.top - m.bottom;
  const series = points.map((point) => ({
    minute: point.minute,
    values: point.snapshot && groupStats(point.snapshot).map((group) => (stacked ? group.sessions : group.logon)),
  }));

  let maximum = threshold ? threshold * 1.2 : 0;
  for (const point of series) {
    if (!point.values) continue;
    const values = point.values.map((value) => value ?? 0);
    maximum = Math.max(maximum, stacked ? values.reduce((a, b) => a + b, 0) : Math.max(...values));
  }
  const yMax = niceMax(maximum * 1.05);
  const x = (minute) => m.left + (minute / 1440) * plotW;
  const y = (value) => m.top + plotH - (value / yMax) * plotH;

  const root = svg('svg', {
    viewBox: `0 0 ${width} ${height}`,
    role: 'img',
    'aria-label': stacked ? 'Sessions per delivery group over the UTC day' : 'Average logon duration per delivery group over the UTC day',
  });
  for (let tick = 0; tick <= 4; tick += 1) {
    const value = (yMax / 4) * tick;
    svg('line', { class: 'gridline', x1: m.left, x2: width - m.right, y1: y(value), y2: y(value) }, root);
    svg('text', { class: 'axis', x: m.left - 6, y: y(value) + 3.5, 'text-anchor': 'end' }, root)
      .textContent = Number.isInteger(value) ? value : value.toFixed(1);
  }
  for (let hour = 0; hour <= 24; hour += 3) {
    svg('text', { class: 'axis', x: x(hour * 60), y: height - 5, 'text-anchor': hour === 0 ? 'start' : hour === 24 ? 'end' : 'middle' }, root)
      .textContent = `${pad(hour)}h`;
  }

  if (!series.some((point) => point.values)) {
    svg('rect', { class: 'hatch', x: m.left, y: m.top, width: plotW, height: plotH, rx: 4 }, root);
    svg('text', { class: 'nodata', x: m.left + plotW / 2, y: m.top + plotH / 2, 'text-anchor': 'middle' }, root)
      .textContent = 'No data — collection is failing';
  } else if (stacked) {
    const base = series.map(() => 0);
    GROUPS.forEach((group, index) => {
      const top = series.map((point, i) => base[i] + (point.values?.[index] ?? 0));
      const upper = series.map((point, i) => `${x(point.minute).toFixed(1)},${y(top[i]).toFixed(1)}`);
      const lower = series.map((point, i) => `${x(point.minute).toFixed(1)},${y(base[i]).toFixed(1)}`).reverse();
      svg('path', { class: 'area', d: `M${upper.join('L')}L${lower.join('L')}Z`, fill: color(index) }, root);
      top.forEach((value, i) => { base[i] = value; });
    });
  } else {
    GROUPS.forEach((group, index) => {
      let d = '';
      let pen = false;
      for (const point of series) {
        const value = point.values?.[index];
        if (value === null || value === undefined) { pen = false; continue; }
        d += `${pen ? 'L' : 'M'}${x(point.minute).toFixed(1)},${y(value).toFixed(1)}`;
        pen = true;
      }
      if (d) svg('path', { class: 'line', d, stroke: color(index) }, root);
    });
    svg('line', { class: 'threshold', x1: m.left, x2: width - m.right, y1: y(threshold), y2: y(threshold) }, root);
  }

  svg('line', { class: 'now', x1: x(nowMinute), x2: x(nowMinute), y1: m.top, y2: m.top + plotH }, root);
  svg('circle', { class: 'now-dot', cx: x(nowMinute), cy: m.top, r: 2.5 }, root);

  const crosshair = svg('line', { class: 'crosshair', y1: m.top, y2: m.top + plotH, visibility: 'hidden' }, root);
  const dots = GROUPS.map((group, index) => svg('circle', { class: 'dot', r: 4, fill: color(index), visibility: 'hidden' }, root));
  const hit = svg('rect', { class: 'hit', x: m.left, y: m.top, width: plotW, height: plotH }, root);
  const nearest = (event) => {
    const box = root.getBoundingClientRect();
    const minute = (((event.clientX - box.left) / box.width) * width - m.left) / plotW * 1440;
    return series[Math.round(Math.min(1440, Math.max(0, minute)) / STEP_MINUTES)];
  };
  const tooltip = $('tooltip');
  hit.addEventListener('pointermove', (event) => {
    const point = nearest(event);
    crosshair.setAttribute('x1', x(point.minute));
    crosshair.setAttribute('x2', x(point.minute));
    crosshair.setAttribute('visibility', 'visible');
    let running = 0;
    const rows = GROUPS.map((group, index) => {
      const value = point.values?.[index];
      if (value === null || value === undefined) {
        dots[index].setAttribute('visibility', 'hidden');
        return `<div class="t-row">${swatch(index)}${escapeHtml(group.deliveryGroup)}<b>—</b></div>`;
      }
      running += value;
      dots[index].setAttribute('cx', x(point.minute));
      dots[index].setAttribute('cy', y(stacked ? running : value));
      dots[index].setAttribute('visibility', 'visible');
      return `<div class="t-row">${swatch(index)}${escapeHtml(group.deliveryGroup)}<b>${stacked ? value : `${value.toFixed(1)} s`}</b></div>`;
    });
    tooltip.innerHTML = `<div class="t-head">${clockText(point.minute)} UTC · click to pin</div>${rows.join('')}`;
    tooltip.hidden = false;
    tooltip.style.left = `${Math.max(8, Math.min(window.innerWidth - tooltip.offsetWidth - 8, event.clientX + 14))}px`;
    tooltip.style.top = `${Math.max(8, event.clientY - tooltip.offsetHeight - 10)}px`;
  });
  hit.addEventListener('pointerleave', () => {
    crosshair.setAttribute('visibility', 'hidden');
    dots.forEach((dot) => dot.setAttribute('visibility', 'hidden'));
    tooltip.hidden = true;
  });
  hit.addEventListener('click', (event) => {
    state.clock = 'pinned';
    state.minuteOfDay = Math.min(1430, nearest(event).minute);
    update();
  });

  $('chart').replaceChildren(root);
  $('legend').innerHTML = GROUPS.map((group, index) => `<span>${swatch(index)}${escapeHtml(group.deliveryGroup)}</span>`).join('')
    + (threshold ? '<span><i class="thr"></i>alert at 30 s</span>' : '');
}

// ------------------------------------------------------------------ outputs

// Numbers ease to their new value so a change is visible, not just a swap.
function tween(element, target, format) {
  const from = element._value ?? target;
  element._value = target;
  if (reducedMotion || from === target || target === null) {
    element.innerHTML = format(target);
    return;
  }
  const started = performance.now();
  const step = (now) => {
    const progress = Math.min(1, (now - started) / 350);
    const eased = 1 - (1 - progress) ** 3;
    element.innerHTML = format(progress === 1 ? target : from + (target - from) * eased);
    if (progress < 1 && element._value === target) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

function renderKpis(result) {
  const container = $('kpis');
  if (!container.children.length) {
    container.innerHTML = ['sessions', 'vdas', 'logon', 'licenses']
      .map((key) => `<div class="kpi" id="kpi-${key}"><dt></dt><dd></dd></div>`).join('');
  }
  const set = (key, label, value, format, tone = '', extra = '') => {
    const tile = $(`kpi-${key}`);
    tile.className = `kpi ${tone}`;
    tile.querySelector('dt').textContent = label;
    const dd = tile.querySelector('dd');
    if (value === null) {
      dd._value = null;
      dd.innerHTML = '—';
    } else {
      tween(dd, value, format);
    }
    let bars = tile.querySelector('.bars');
    if (extra) {
      if (!bars) { bars = document.createElement('div'); bars.className = 'bars'; tile.appendChild(bars); }
      bars.innerHTML = extra;
    } else {
      bars?.remove();
    }
  };

  const snapshot = result.snapshot;
  if (!snapshot) {
    for (const [key, label] of [['sessions', 'Sessions'], ['vdas', 'Registered VDAs'], ['logon', 'Slowest logon'], ['licenses', 'Peak license use']]) {
      set(key, label, null, String, 'off');
    }
    return;
  }
  const groups = groupStats(snapshot);
  const registered = groups.reduce((sum, group) => sum + group.registered, 0);
  const logons = groups.map((group) => group.logon).filter((value) => value !== null);
  const slowest = logons.length ? Math.max(...logons) : null;
  const ratios = snapshot.licenses.map((license) => ({ ...license, ratio: license.total ? license.inUse / license.total : 0 }));
  const peak = Math.max(...ratios.map((license) => license.ratio));
  const tone = (value, warn, crit) => (value > crit ? 'crit' : value > warn ? 'warn' : '');

  set('sessions', 'Sessions', snapshot.sessions.length, (v) => Math.round(v));
  set('vdas', 'Registered VDAs', registered, (v) => `${Math.round(v)}<small>/${TOTAL_VDAS}</small>`,
    registered < TOTAL_VDAS * 0.95 ? 'warn' : '');
  set('logon', 'Slowest logon', slowest, (v) => `${v.toFixed(1)}<small> s</small>`, tone(slowest ?? 0, 30, 60));
  set('licenses', 'Peak license use', Math.round(peak * 100), (v) => `${Math.round(v)}<small>%</small>`, tone(peak, 0.9, 0.99),
    ratios.map((license) => {
      const cls = tone(license.ratio, 0.75, 0.9);
      return `<div><span>${license.feature.split('_').pop()}</span><span class="meter ${cls}"><i style="width:${Math.min(1, license.ratio) * 100}%"></i></span></div>`;
    }).join(''));
}

function renderStatus(result, alerts) {
  const chips = [];
  if (result.success) chips.push('<span class="chip ok">● Collecting</span>');
  if (!alerts.length) chips.push('<span class="chip ok">No alerts</span>');
  for (const alert of alerts) {
    const cls = alert.severity === 'critical' ? 'crit' : 'warn';
    const target = alert.target === 'exporter' ? '' : ` · ${escapeHtml(alert.target)}`;
    chips.push(`<span class="chip ${cls}" title="${escapeHtml(alert.detail)}. Prometheus fires this after the condition holds for ${ALERT_FOR[alert.alert]}.">`
      + `<b>${alert.alert}</b>${target} <small>${escapeHtml(alert.detail)}</small></span>`);
  }
  $('status').innerHTML = chips.join('');
}

function renderGroups(snapshot) {
  const head = '<thead><tr><th>Delivery group</th><th>VDAs registered</th><th class="r">Sessions</th><th class="r opt">Disconnected</th><th class="r">Avg logon</th></tr></thead>';
  if (!snapshot) {
    $('groups').innerHTML = `${head}<tbody><tr><td colspan="5" class="empty">No Citrix data while collection fails. The exporter still answers with its own metrics →</td></tr></tbody>`;
    return;
  }
  const rows = groupStats(snapshot).map((group, index) => {
    const share = group.registered / group.machines;
    const warn = (group.machines - group.registered) / group.machines > 0.05;
    const slow = group.logon !== null && group.logon > 30;
    return `<tr>
      <td><span class="name">${swatch(index)}${escapeHtml(group.name)}</span></td>
      <td><span class="vda ${warn ? 'warn' : ''}"><span>${group.registered}/${group.machines}</span><span class="meter ${warn ? 'warn' : ''}"><i style="width:${share * 100}%"></i></span></span></td>
      <td class="r">${group.sessions}</td>
      <td class="r opt">${group.disconnected}</td>
      <td class="r ${slow ? 'warn' : ''}">${group.logon === null ? '—' : `${group.logon.toFixed(1)} s`}</td>
    </tr>`;
  });
  $('groups').innerHTML = `${head}<tbody>${rows.join('')}</tbody>`;
}

function renderMetrics(result) {
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
  $('metrics').innerHTML = html.join('');
  const status = $('term-status');
  status.textContent = result.success ? '200' : '200 · scrape failed';
  status.title = `${values.size} samples`;
  status.className = `code ${result.success ? 'ok' : ''}`;
}

// ------------------------------------------------------------------ update

let lastResult = null;

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
  lastResult = result;

  syncControls();
  renderStatus(result, evaluateAlerts(result));
  renderKpis(result);
  renderGroups(result.snapshot);
  renderMetrics(result);
  drawChart(dayHistory(scenario, at), minuteOf(at));
}

buildControls();
update();
setInterval(() => { if (state.clock === 'live') update(); }, SCRAPE_INTERVAL_MS);
setInterval(() => {
  if (state.clock !== 'replay') return;
  state.minuteOfDay = (state.minuteOfDay + STEP_MINUTES) % 1440;
  update();
}, REPLAY_INTERVAL_MS);
