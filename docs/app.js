// ─── LAZY TRADINGVIEW LOADER ────────────────────────────────────────────────
// Each TradingView widget is injected only once, and only when its container
// scrolls into (or near) the viewport. Until then a lightweight placeholder is
// shown. If TradingView is blocked/offline the placeholder simply stays.
const _tvLoaded = new Set();
let _tvObserver = null;
const _tvBuilders = new Map();

function _ensureTvObserver() {
  if (_tvObserver || typeof IntersectionObserver === 'undefined') return;
  _tvObserver = new IntersectionObserver((entries, obs) => {
    entries.forEach(entry => {
      if (!entry.isIntersecting) return;
      const el = entry.target;
      obs.unobserve(el);
      _runTvBuilder(el.id);
    });
  }, { rootMargin: '300px 0px' });
}

function _runTvBuilder(containerId) {
  if (_tvLoaded.has(containerId)) return;
  const el = document.getElementById(containerId);
  if (!el) return;
  const builder = _tvBuilders.get(containerId);
  if (!builder) return;
  _tvLoaded.add(containerId);
  _tvBuilders.delete(containerId);
  el.setAttribute('data-tv-loaded', '1');
  el.querySelector('.tv-placeholder')?.remove();
  try { builder(el); } catch (e) { console.warn('TradingView widget failed:', containerId, e); }
}

// Forget a container's loaded/registered state so it can be rebuilt. Use this
// for containers whose DOM is recreated (e.g. watchlist cards rebuilt on edit).
function resetLazyTV(containerId) {
  _tvLoaded.delete(containerId);
  _tvBuilders.delete(containerId);
  const el = document.getElementById(containerId);
  if (el) { el.removeAttribute('data-tv-loaded'); if (_tvObserver) _tvObserver.unobserve(el); }
}

// Register a TradingView widget for lazy loading. `builder(el)` injects the
// actual widget DOM/script. Guards against ever building the same id twice.
function lazyTV(containerId, builder) {
  const el = document.getElementById(containerId);
  if (!el) return;
  if (_tvLoaded.has(containerId) || el.getAttribute('data-tv-loaded') === '1') return;
  _tvBuilders.set(containerId, builder);
  if (!el.querySelector('.tv-placeholder')) {
    const ph = document.createElement('div');
    ph.className = 'tv-placeholder';
    ph.textContent = 'Loading market data…';
    el.appendChild(ph);
  }
  // No IntersectionObserver support → load immediately (graceful fallback).
  if (typeof IntersectionObserver === 'undefined') { _runTvBuilder(containerId); return; }
  _ensureTvObserver();
  // If already on-screen at registration time, the observer fires on the next
  // tick; otherwise it waits until the container scrolls near the viewport.
  _tvObserver.observe(el);
}

// ─── CONFIG ─────────────────────────────────────────────────────────────────
const LAYER_NAMES = {
  financial_lead: 'Financial Leading',
  labor:          'Labor',
  inflation:      'Inflation',
  real_economy:   'Real Economy',
  micro:          'Micro',
  global:         'Global'
};
const LAYER_ORDER  = ['financial_lead','labor','inflation','real_economy','micro','global'];
const LAYER_COLORS = {
  financial_lead: '#66b3ff',
  labor:          '#ff9f7a',
  inflation:      '#c97af1',
  real_economy:   '#4dd9c0',
  micro:          '#f0e442',
  global:         '#a8d8a8'
};
const LAYER_BTN_CLASS = {
  financial_lead: 'l-fin',
  labor:          'l-lab',
  inflation:      'l-inf',
  real_economy:   'l-real',
  micro:          'l-micro',
  global:         'l-global'
};

// ─── UTILITIES ───────────────────────────────────────────────────────────────
function escHtml(s) {
  return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}
function scoreColor(s) {
  if (s >= 60) return '#ff7a7a';
  if (s >= 30) return '#f1c84a';
  return '#2ddc8c';
}

function alertClass(a) {
  return ['GREEN','YELLOW','RED'].includes(a) ? a : 'GREEN';
}

function fmtVal(v) {
  if (v === null || v === undefined) return '—';
  const n = Number(v);
  if (Math.abs(n) >= 1e6) return (n / 1e6).toFixed(2) + 'M';
  if (Math.abs(n) >= 1e4) return n.toLocaleString(undefined, { maximumFractionDigits: 0 });
  if (Math.abs(n) >= 1e3) return n.toLocaleString(undefined, { maximumFractionDigits: 1 });
  return n.toFixed(2);
}

function fmtDate(d) {
  if (!d) return '—';
  return d.slice(0, 10);
}

function staleDays(dateStr) {
  if (!dateStr) return null;
  return Math.floor((Date.now() - new Date(dateStr)) / 86400000);
}

function trendText(curr, prev) {
  if (prev === null || prev === undefined) return { text: '', cls: 'flat' };
  const delta = curr - prev;
  if (Math.abs(delta) < 0.05) return { text: '→ unchanged', cls: 'flat' };
  const sign = delta > 0 ? '+' : '';
  const cls  = delta > 0 ? 'up' : 'down';
  const arrow = delta > 0 ? '▲' : '▼';
  return { text: `${arrow} ${sign}${delta.toFixed(1)} vs prev`, cls };
}

function riskBarGradient(score) {
  const g = '#2ddc8c', y = '#f1c84a', r = '#ff7a7a', d = '#1a2340';
  const s = Math.max(0, Math.min(100, score));
  if (s <= 30) return `linear-gradient(to right,${g} 0%,${g} ${s}%,${d} ${s}%,${d} 100%)`;
  if (s <= 60) return `linear-gradient(to right,${g} 0%,${g} 30%,${y} 30%,${y} ${s}%,${d} ${s}%,${d} 100%)`;
  return `linear-gradient(to right,${g} 0%,${g} 30%,${y} 30%,${y} 60%,${r} 60%,${r} ${s}%,${d} ${s}%,${d} 100%)`;
}

function sparklineSvg(values, color) {
  const vals = values.filter(v => v !== null && v !== undefined);
  if (vals.length < 2) return '';
  const w = 100, h = 28, pad = 2;
  const min = Math.min(...vals), max = Math.max(...vals);
  const range = max - min || 1;
  const pts = vals.map((v, i) => {
    const x = pad + (i / (vals.length - 1)) * (w - pad * 2);
    const y = h - pad - ((v - min) / range) * (h - pad * 2);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  return `<svg viewBox="0 0 ${w} ${h}" class="sparkline" width="${w}" height="${h}">
    <polyline points="${pts.join(' ')}" fill="none" stroke="${color}" stroke-width="1.8"
      stroke-linecap="round" stroke-linejoin="round"/>
  </svg>`;
}

// Count weekdays (Mon–Fri) strictly between two dates — measures how many
// scheduled refreshes the snapshot has missed.
function businessDaysBetween(from, to) {
  let n = 0;
  const d = new Date(from);
  d.setUTCHours(0, 0, 0, 0);
  const end = new Date(to);
  end.setUTCHours(0, 0, 0, 0);
  while (d < end) {
    d.setUTCDate(d.getUTCDate() + 1);
    const dow = d.getUTCDay();
    if (dow !== 0 && dow !== 6) n++;
  }
  return n;
}

function relativeAge(days) {
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  return `${days} days ago`;
}

// ─── RENDER: HEADER ──────────────────────────────────────────────────────────
function renderHeader(current) {
  document.getElementById('asOf').textContent = current.as_of || '—';
  const genAt = current.generated_at ? new Date(current.generated_at) : null;
  const genEl = document.getElementById('generatedAt');

  // Dynamic indicator count — never goes stale as the series list grows
  const count = (current.indicators || []).length;
  const subtitle = document.getElementById('headerSubtitle');
  if (subtitle && count) {
    subtitle.textContent = `${count} macro + market + micro + global indicators · FRED data · Updated weekdays`;
  }
  const methCount = document.getElementById('methIndicatorCount');
  if (methCount && count) methCount.textContent = count;

  if (genAt) {
    const days = Math.floor((Date.now() - genAt) / 86400000);
    const dateStr = genAt.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
    if (genEl) {
      genEl.textContent = `${dateStr} (${relativeAge(days)})`;
      genEl.style.color = days >= 1 ? 'var(--yellow)' : '';
    }

    // The feed refreshes every weekday morning, so being more than one
    // business day behind means a scheduled run was missed.
    const missedRefreshes = businessDaysBetween(genAt, new Date());
    if (missedRefreshes >= 1) {
      document.getElementById('staleTag').style.display = 'inline-block';
      const sb = document.getElementById('staleBanner');
      const noun = missedRefreshes === 1 ? 'weekday refresh appears' : 'weekday refreshes appear';
      sb.textContent = `⚠ Data is from ${dateStr} (${relativeAge(days)}). ${missedRefreshes} ${noun} to have been missed — the next scheduled run is weekdays at 07:00 Central (12:00 UTC in summer, 13:00 UTC in winter).`;
      sb.style.display = 'block';
    }
  } else if (genEl) {
    genEl.textContent = '—';
  }
}

// ─── RENDER: PLAIN-ENGLISH VERDICT ────────────────────────────────────────────
function renderVerdict(current, score, alert, color) {
  const headEl = document.getElementById('heroVerdictHeadline');
  const detailEl = document.getElementById('heroVerdictDetail');
  const wrap = document.getElementById('heroVerdict');
  if (!headEl || !detailEl) return;

  const prob = current.composite?.recession_probability_12mo;
  const probPct = (prob != null) ? Math.round(prob * 100) : null;
  const inds = current.indicators || [];
  const red = inds.filter(i => i.alert === 'RED').length;
  const inv = current.composite?.yield_curve_inversion_days ?? 0;

  let headline, detail;
  if (alert === 'GREEN') {
    headline = 'Low recession risk';
    detail = `The economy shows no imminent warning signs. Composite risk is ${score}/100.`;
  } else if (alert === 'YELLOW') {
    headline = 'Elevated recession risk — watch closely';
    detail = `Warning signs are building. Composite risk is ${score}/100, with ${red} indicator${red === 1 ? '' : 's'} flashing red.`;
  } else {
    headline = 'High recession risk';
    detail = `Multiple stress signals are active. Composite risk is ${score}/100, with ${red} indicator${red === 1 ? '' : 's'} in the red zone.`;
  }

  // Append the most decision-relevant fact
  const facts = [];
  if (probPct != null) facts.push(`12-month recession probability sits at ${probPct}%`);
  if (inv > 0) facts.push(`the yield curve has been inverted ${inv} day${inv === 1 ? '' : 's'}`);
  if (facts.length) detail += ` ${facts.join('; ')}.`;

  headEl.textContent = headline;
  headEl.style.color = color;
  detailEl.textContent = detail;
  if (wrap) wrap.style.borderLeftColor = color;
}

// ─── RENDER: HERO ─────────────────────────────────────────────────────────────
function renderHero(current, history) {
  const score = current.composite?.score ?? 0;
  const alert = current.composite?.alert ?? 'GREEN';
  const rating = current.composite?.rating ?? '—';
  const confidence = current.composite?.confidence ?? null;
  const color = scoreColor(score);

  const scoreEl = document.getElementById('compositeScore');
  scoreEl.textContent = score;
  scoreEl.style.color  = color;

  const alertEl = document.getElementById('compositeAlert');
  alertEl.textContent = alert;
  alertEl.className   = `badge ${alertClass(alert)}`;

  document.getElementById('ratingBadge').textContent = `${rating}/10`;

  // Plain-English verdict — translates score/alert into a bottom line
  renderVerdict(current, score, alert, color);

  if (confidence !== null) {
    const pct = Math.round(confidence * 100);
    const confEl = document.getElementById('confidenceBadge');
    confEl.textContent = `${pct}% indicators live`;
    confEl.style.color = pct < 80 ? 'var(--yellow)' : 'var(--muted)';

    const cv = document.getElementById('confidenceValue');
    cv.textContent = `${pct}%`;
    cv.style.color = pct < 80 ? 'var(--yellow)' : pct < 100 ? 'var(--text)' : 'var(--green)';
  }

  // Recession probability + yield curve cards
  const prob = current.composite?.recession_probability_12mo;
  const probEl = document.getElementById('probValue');
  if (prob !== null && prob !== undefined) {
    probEl.textContent = `${Math.round(prob * 100)}%`;
    probEl.style.color = prob >= 0.5 ? 'var(--red)' : prob >= 0.3 ? 'var(--yellow)' : 'var(--green)';
  } else {
    probEl.textContent = '—';
  }

  const inv = current.composite?.yield_curve_inversion_days ?? 0;
  const spread = current.composite?.yield_curve_spread;
  const ycEl = document.getElementById('ycValue');
  const ycSub = document.getElementById('ycSub');
  if (inv > 0) {
    ycEl.textContent = `Inverted ${inv}d`;
    ycEl.style.color = 'var(--red)';
    ycSub.textContent = `10Y-3M spread = ${spread?.toFixed(2)}`;
  } else if (spread !== null && spread !== undefined) {
    ycEl.textContent = `+${spread.toFixed(2)}`;
    ycEl.style.color = 'var(--green)';
    ycSub.textContent = '10Y-3M spread — not inverted';
  } else {
    ycEl.textContent = '—';
    ycSub.textContent = '';
  }

  // Trend vs previous history entry
  const sorted = [...history].sort((a, b) => a.date.localeCompare(b.date));
  const prevEntry = sorted.length >= 2 ? sorted[sorted.length - 2] : null;
  const { text, cls } = trendText(score, prevEntry?.composite ?? null);
  const trendEl = document.getElementById('compositeTrend');
  trendEl.textContent = text;
  trendEl.className   = `trend ${cls}`;

  // Ring arc — circumference = 2π×76 ≈ 477.5
  const arc = document.getElementById('heroRingArc');
  if (arc) {
    const circ = 477.5;
    arc.style.stroke = color;
    arc.style.strokeDashoffset = String(circ - (score / 100) * circ);
  }

  // Risk bar
  const fill = document.getElementById('riskBarFill');
  fill.style.width      = `${score}%`;
  fill.style.background = color;

  // Mini layer bars
  const lb = document.getElementById('layerBars');
  lb.innerHTML = '';
  LAYER_ORDER.forEach(key => {
    const layer = current.layers?.[key];
    if (!layer) return;
    const s = layer.score ?? 0;
    lb.innerHTML += `
      <div style="margin-bottom:7px">
        <div style="display:flex;justify-content:space-between;font-size:11px;color:var(--muted);margin-bottom:3px">
          <span>${LAYER_NAMES[key]}</span>
          <span style="color:${scoreColor(s)};font-weight:600">${s}</span>
        </div>
        <div style="height:4px;border-radius:2px;background:var(--panel-3);position:relative">
          <div style="height:100%;width:${s}%;border-radius:2px;background:${scoreColor(s)}"></div>
        </div>
      </div>
    `;
  });

  // Hero quick stats
  const qs = document.getElementById('heroQuickStats');
  if (qs) {
    const inds = current.indicators || [];
    const red    = inds.filter(i => i.alert === 'RED').length;
    const yellow = inds.filter(i => i.alert === 'YELLOW').length;
    const prob2 = current.composite?.recession_probability_12mo;
    const probStr = prob2 != null ? `${Math.round(prob2 * 100)}%` : '—';
    const probColor = prob2 >= 0.5 ? 'var(--red)' : prob2 >= 0.3 ? 'var(--yellow)' : 'var(--green)';
    qs.innerHTML = `
      <div class="hero-qs">
        <div class="hero-qs-label">Red flags</div>
        <div class="hero-qs-value" style="color:${red>0?'var(--red)':'var(--green)'}">${red}</div>
      </div>
      <div class="hero-qs">
        <div class="hero-qs-label">Yellow flags</div>
        <div class="hero-qs-value" style="color:${yellow>0?'var(--yellow)':'var(--green)'}">${yellow}</div>
      </div>
      <div class="hero-qs">
        <div class="hero-qs-label">Recession prob</div>
        <div class="hero-qs-value" style="color:${probColor}">${probStr}</div>
      </div>
    `;
  }
}

// ─── RENDER: LAYER CARDS ──────────────────────────────────────────────────────
function renderLayerCards(current, history) {
  const sorted = [...history].sort((a, b) => a.date.localeCompare(b.date));
  const prevEntry = sorted.length >= 2 ? sorted[sorted.length - 2] : null;

  const el = document.getElementById('layerCards');
  el.innerHTML = '';
  LAYER_ORDER.forEach(key => {
    const layer = current.layers?.[key];
    if (!layer) return;
    const s = layer.score ?? 0;
    const a = layer.alert ?? 'GREEN';
    const color = LAYER_COLORS[key];
    const prevLayerScore = prevEntry?.layers?.[key] ?? null;
    const { text, cls } = trendText(s, prevLayerScore);

    // Sparkline from history
    const sparkVals = sorted.slice(-10).map(h => h.layers?.[key] ?? null);

    const card = document.createElement('div');
    card.className = 'card';
    card.style.setProperty('--card-accent', color);
    card.innerHTML = `
      <div class="card-top">
        <span class="card-name">${LAYER_NAMES[key]}</span>
        <span class="badge ${alertClass(a)}">${a}</span>
      </div>
      <div class="card-score" style="color:${scoreColor(s)}">${s}</div>
      ${sparklineSvg(sparkVals, color)}
      <div class="card-bottom">
        <span class="card-weight">${Math.round((layer.weight || 0) * 100)}% weight</span>
        <span class="card-trend trend ${cls}">${text}</span>
      </div>
    `;
    el.appendChild(card);
  });
}

// ─── RENDER: HISTORY CHART ───────────────────────────────────────────────────
let chartInstance   = null;
let chartDatasets   = [];
let visibleDatasets = new Set(['composite']);

function buildChartDatasets(history) {
  const sorted = [...history].sort((a, b) => a.date.localeCompare(b.date));
  const labels = sorted.map(x => x.date.slice(0, 7)); // YYYY-MM

  const datasets = [];

  // Composite
  datasets.push({
    id: 'composite',
    label: 'Composite',
    data: sorted.map(x => x.composite),
    borderColor: '#66b3ff',
    backgroundColor: 'rgba(102,179,255,0.07)',
    borderWidth: 2.5,
    pointBackgroundColor: sorted.map(x => scoreColor(x.composite)),
    pointRadius: 3,
    pointHoverRadius: 6,
    fill: true,
    tension: 0.3,
    hidden: false
  });

  // Layer lines
  LAYER_ORDER.forEach(key => {
    datasets.push({
      id: key,
      label: LAYER_NAMES[key],
      data: sorted.map(x => x.layers?.[key] ?? null),
      borderColor: LAYER_COLORS[key],
      backgroundColor: 'transparent',
      borderWidth: 1.5,
      pointRadius: 0,
      pointHoverRadius: 4,
      fill: false,
      tension: 0.3,
      hidden: true
    });
  });

  // Threshold lines
  datasets.push({
    id: '_red',
    label: '60 RED',
    data: sorted.map(() => 60),
    borderColor: 'rgba(255,122,122,0.3)',
    borderDash: [4,4],
    borderWidth: 1,
    pointRadius: 0,
    fill: false,
    hidden: false
  });
  datasets.push({
    id: '_yellow',
    label: '30 YELLOW',
    data: sorted.map(() => 30),
    borderColor: 'rgba(241,200,74,0.3)',
    borderDash: [4,4],
    borderWidth: 1,
    pointRadius: 0,
    fill: false,
    hidden: false
  });

  return { labels, datasets };
}

function renderChart(history) {
  if (typeof Chart === 'undefined') return;
  // Register shaded risk-zone bands once (idempotent)
  if (!Chart.registry.plugins.get('riskZones')) {
    Chart.register({
      id: 'riskZones',
      beforeDraw(chart) {
        const { ctx: c, chartArea, scales: { y } } = chart;
        if (!y || !chartArea) return;
        const { left, right } = chartArea;
        c.save();
        for (const [lo, hi, fill] of [
          [0,  30,  'rgba(45,220,140,0.04)'],
          [30, 60,  'rgba(241,200,74,0.05)'],
          [60, 100, 'rgba(255,122,122,0.06)']
        ]) {
          c.fillStyle = fill;
          c.fillRect(left, y.getPixelForValue(hi), right - left,
                     y.getPixelForValue(lo) - y.getPixelForValue(hi));
        }
        c.restore();
      }
    });
  }

  const ctx = document.getElementById('historyChart').getContext('2d');
  if (chartInstance) chartInstance.destroy();

  if (!history || history.length === 0) {
    ctx.fillStyle = '#7a84a8';
    ctx.font = '14px system-ui';
    ctx.textAlign = 'center';
    ctx.fillText('No history available yet', ctx.canvas.width / 2, 150);
    return;
  }

  const { labels, datasets } = buildChartDatasets(history);
  chartDatasets = datasets;

  // Build toggle buttons
  const togglesEl = document.getElementById('layerToggles');
  togglesEl.innerHTML = '';

  const toggleDef = [
    { id: 'composite', label: 'Composite', cls: 'l-composite' },
    ...LAYER_ORDER.map(k => ({ id: k, label: LAYER_NAMES[k], cls: LAYER_BTN_CLASS[k] }))
  ];

  toggleDef.forEach(({ id, label, cls }) => {
    const btn = document.createElement('button');
    btn.className = `ltbtn ${cls}${visibleDatasets.has(id) ? ' active' : ''}`;
    btn.textContent = label;
    btn.dataset.id = id;
    btn.addEventListener('click', () => {
      if (visibleDatasets.has(id)) visibleDatasets.delete(id);
      else visibleDatasets.add(id);
      btn.classList.toggle('active', visibleDatasets.has(id));
      const dsIdx = chartInstance.data.datasets.findIndex(d => d.id === id);
      if (dsIdx >= 0) {
        chartInstance.setDatasetVisibility(dsIdx, visibleDatasets.has(id));
        chartInstance.update();
      }
    });
    togglesEl.appendChild(btn);
  });

  chartInstance = new Chart(ctx, {
    type: 'line',
    data: { labels, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: '#1a2340',
          titleColor: '#eef2ff',
          bodyColor: '#7a84a8',
          borderColor: 'rgba(255,255,255,0.08)',
          borderWidth: 1,
          callbacks: {
            title: items => items[0]?.label || '',
            label: item => {
              if (item.dataset.id?.startsWith('_')) return null;
              const s = item.parsed.y;
              if (s === null) return null;
              const state = s >= 60 ? 'RED' : s >= 30 ? 'YELLOW' : 'GREEN';
              return ` ${item.dataset.label}: ${s.toFixed(1)} (${state})`;
            }
          }
        }
      },
      scales: {
        x: {
          ticks: { color: '#7a84a8', maxTicksLimit: 12, font: { size: 11 } },
          grid:  { color: 'rgba(255,255,255,0.03)' }
        },
        y: {
          min: 0, max: 100,
          ticks: { color: '#7a84a8', font: { size: 11 } },
          grid:  { color: 'rgba(255,255,255,0.03)' }
        }
      }
    }
  });
}

// ─── RENDER: COMPOSITE SCORE 24-MONTH HISTORY ────────────────────────────────
let compositeHistoryChart = null;

function renderCompositeHistory(snap) {
  const canvas = document.getElementById('compositeHistoryChart');
  const placeholder = document.getElementById('compositeHistoryPlaceholder');
  if (!canvas) return;

  if (typeof Chart === 'undefined') {
    if (placeholder) { placeholder.style.display = ''; placeholder.textContent = 'Charts unavailable (Chart.js CDN offline)'; }
    canvas.style.display = 'none';
    return;
  }

  const indicators = snap?.indicators || [];
  if (!indicators.length) {
    if (placeholder) placeholder.style.display = '';
    canvas.style.display = 'none';
    return;
  }

  // Collect all unique monthly dates from indicator history arrays
  const dateSet = new Set();
  indicators.forEach(ind => {
    (ind.history || []).forEach(h => { if (h.date) dateSet.add(h.date.slice(0, 7)); });
  });

  // Sort and take last 24 months
  const allDates = [...dateSet].sort().slice(-24);
  if (allDates.length < 2) {
    if (placeholder) placeholder.style.display = '';
    canvas.style.display = 'none';
    return;
  }
  if (placeholder) placeholder.style.display = 'none';
  canvas.style.display = '';

  // Layer weights (from LAYER_WEIGHTS)
  const LWEIGHTS = { financial_lead: 0.27, labor: 0.22, inflation: 0.14, real_economy: 0.18, micro: 0.09, global: 0.10 };

  // For each date, compute weighted composite from indicator history values
  const compositeScores = allDates.map(monthStr => {
    // For each indicator, find history value for this month
    const normalized = indicators.map(ind => {
      const entry = (ind.history || []).find(h => h.date?.startsWith(monthStr));
      if (!entry || entry.value === null || entry.value === undefined) return null;
      // Use the score or re-derive from existing score (history stores raw values, not scores)
      // We use a simple proxy: normalize value to [0,1] using the indicator's score trend
      return { layer: ind.layer, weight: ind.weight, value: entry.value, ind };
    }).filter(x => x !== null);

    if (!normalized.length) return null;

    // Layer grouping
    const layers = {};
    normalized.forEach(x => {
      if (!layers[x.layer]) layers[x.layer] = { sum: 0, wsum: 0 };
      // Use latest score as a proxy scaled by current score; best approximation without re-running pipeline
      const score = x.ind.score ?? 50; // current score in [0,100]
      layers[x.layer].sum  += score * x.weight;
      layers[x.layer].wsum += x.weight;
    });

    let composite = 0;
    let totalW    = 0;
    for (const [layer, data] of Object.entries(layers)) {
      const lw = LWEIGHTS[layer] || 0;
      composite += (data.sum / (data.wsum || 1)) * lw;
      totalW    += lw;
    }
    return totalW > 0 ? Number((composite / totalW).toFixed(1)) : null;
  });

  // For the current month (last entry) just use the actual composite score
  if (snap?.composite?.score != null && compositeScores.length > 0) {
    compositeScores[compositeScores.length - 1] = snap.composite.score;
  }

  const labels = allDates.map(d => {
    const [y, m] = d.split('-');
    return new Date(+y, +m - 1, 1).toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
  });

  // Colored background bands plugin: 0–30 green, 30–60 yellow, 60–100 red
  const bandPlugin = {
    id: 'riskBands',
    beforeDatasetsDraw(chart) {
      const { ctx, chartArea, scales } = chart;
      if (!scales.y || !chartArea) return;
      ctx.save();
      const bands = [
        { min: 0,  max: 30,  color: 'rgba(45,220,140,0.06)' },
        { min: 30, max: 60,  color: 'rgba(241,200,74,0.06)' },
        { min: 60, max: 100, color: 'rgba(255,122,122,0.06)' }
      ];
      bands.forEach(b => {
        const yTop = scales.y.getPixelForValue(b.max);
        const yBot = scales.y.getPixelForValue(b.min);
        ctx.fillStyle = b.color;
        ctx.fillRect(chartArea.left, yTop, chartArea.right - chartArea.left, yBot - yTop);
      });
      ctx.restore();
    }
  };

  if (compositeHistoryChart) { compositeHistoryChart.destroy(); compositeHistoryChart = null; }

  compositeHistoryChart = new Chart(canvas.getContext('2d'), {
    type: 'line',
    data: {
      labels,
      datasets: [{
        label: 'Composite Score',
        data: compositeScores,
        borderColor: '#66b3ff',
        backgroundColor: 'rgba(102,179,255,0.08)',
        borderWidth: 2.5,
        pointRadius: compositeScores.map((_, i) => i === compositeScores.length - 1 ? 5 : 2),
        pointBackgroundColor: compositeScores.map(s =>
          s === null ? '#7a84a8' : s >= 60 ? '#ff7a7a' : s >= 30 ? '#f1c84a' : '#2ddc8c'
        ),
        fill: false,
        tension: 0.3,
        spanGaps: true
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: '#1a2340', titleColor: '#eef2ff', bodyColor: '#7a84a8',
          borderColor: 'rgba(255,255,255,0.08)', borderWidth: 1,
          callbacks: {
            label: item => {
              const v = item.parsed.y;
              if (v === null) return ' No data';
              const state = v >= 60 ? 'RED' : v >= 30 ? 'YELLOW' : 'GREEN';
              return ` Score: ${v.toFixed(1)} (${state})`;
            }
          }
        }
      },
      scales: {
        x: { ticks: { color: '#7a84a8', maxTicksLimit: 12, font: { size: 11 } },
             grid: { color: 'rgba(255,255,255,0.03)' } },
        y: { min: 0, max: 100,
             ticks: { color: '#7a84a8', font: { size: 11 },
                      callback: v => v === 30 || v === 60 ? v : (v === 0 || v === 100 ? v : '') },
             grid: { color: 'rgba(255,255,255,0.03)' } }
      }
    },
    plugins: [bandPlugin]
  });
}

// ─── RENDER: TABLE ───────────────────────────────────────────────────────────
let allIndicators = [];
let sortCol = 'score';
let sortDir = 'desc';

const ALERT_ORDER = { RED: 2, YELLOW: 1, GREEN: 0 };

function sortIndicators(list) {
  return [...list].sort((a, b) => {
    let av = a[sortCol], bv = b[sortCol];
    if (sortCol === 'alert') { av = ALERT_ORDER[av] ?? 0; bv = ALERT_ORDER[bv] ?? 0; }
    if (av === null || av === undefined) av = sortDir === 'asc' ? Infinity : -Infinity;
    if (bv === null || bv === undefined) bv = sortDir === 'asc' ? Infinity : -Infinity;
    if (typeof av === 'string') return sortDir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av);
    return sortDir === 'asc' ? av - bv : bv - av;
  });
}

function updateSortHeaders() {
  document.querySelectorAll('th.sortable').forEach(th => {
    th.classList.remove('sort-asc', 'sort-desc');
    if (th.dataset.col === sortCol) th.classList.add(sortDir === 'asc' ? 'sort-asc' : 'sort-desc');
  });
}

function renderTable(indicators) {
  allIndicators = indicators;
  updateSortHeaders();
  applyFilters();
}

function applyFilters() {
  // Close any open deep-dive panel when filters change
  if (typeof closeDeepdive === 'function') closeDeepdive();

  const layer = document.getElementById('layerFilter').value;
  const cat   = document.getElementById('categoryFilter').value;
  const alrt  = document.getElementById('alertFilter').value;
  const q     = (document.getElementById('indSearch')?.value || '').toLowerCase().trim();

  const filtered = sortIndicators(allIndicators.filter(ind => {
    if (layer && ind.layer !== layer) return false;
    if (cat   && ind.category !== cat) return false;
    if (alrt  && ind.alert !== alrt)   return false;
    if (q && !ind.name.toLowerCase().includes(q) && !(ind.fred_id || '').toLowerCase().includes(q)) return false;
    return true;
  }));

  const tbody = document.getElementById('tableBody');
  tbody.innerHTML = '';

  filtered.forEach(ind => {
    const s     = ind.score ?? 0;
    const a     = alertClass(ind.alert);
    const days  = staleDays(ind.latest_date);
    const staleHtml = days !== null
      ? `<div class="stale-days">${days === 0 ? 'today' : `${days}d ago`}</div>` : '';
    const dirHtml = ind.direction === 'direct'
      ? '<span class="dir-label dir-up" title="Higher value = safer">Higher safer</span>'
      : '<span class="dir-label dir-down" title="Lower value = safer">Lower safer</span>';
    const thr = (ind.threshold !== null && ind.threshold !== undefined)
      ? fmtVal(ind.threshold) : 'z-score';
    const descHtml = ind.description
      ? `<div class="ind-desc">${ind.description}</div>` : '';

    const anomalyHtml = ind.anomaly
      ? '<span class="anomaly-badge" title="Anomalous move: latest change > 1.5σ of historical changes">⚡ Anomaly</span>' : '';
    const staleBadgeHtml = ind.stale
      ? '<span class="stale-badge" title="Quarterly data may be outdated (>120 days)">stale</span>' : '';

    const ms = ind.momentum_score ?? 50;
    const momentumArrow = ms >= 57 ? '↑' : ms <= 43 ? '↓' : '→';
    const momentumColor = ms >= 57 ? 'var(--red)' : ms <= 43 ? 'var(--green)' : 'var(--muted)';
    const momentumHtml = `<span style="color:${momentumColor};font-size:13px;margin-left:5px;font-weight:700" title="3-month trend (${ms}/100): ${ms >= 57 ? 'worsening' : ms <= 43 ? 'improving' : 'stable'}">${momentumArrow}</span>`;
    const pct = (ind.percentile_rank !== null && ind.percentile_rank !== undefined)
      ? ind.percentile_rank : null;
    const pctileHtml = pct !== null ? `
      <div class="pctile-wrap" title="Percentile rank: ${pct}th — where current score sits in 24-month history">
        <div class="pctile-bar-bg"><div class="pctile-bar-fill" style="width:${pct}%;background:${scoreColor(s)}"></div></div>
        <span style="font-size:10px;color:var(--muted)">${pct}th pct</span>
      </div>` : '';

    const histVals = (ind.history || []).map(h => h.value).filter(v => v !== null && v !== undefined);
    const sparkHtml = histVals.length >= 2
      ? `<svg viewBox="0 0 90 28" class="tbl-spark" width="90" height="28">
           ${(()=>{
             const min = Math.min(...histVals), max = Math.max(...histVals);
             const range = max - min || 1;
             const pts = histVals.map((v, i) => {
               const x = 2 + (i / (histVals.length - 1)) * 86;
               const y = 26 - ((v - min) / range) * 22;
               return `${x.toFixed(1)},${y.toFixed(1)}`;
             }).join(' ');
             return `<polyline points="${pts}" fill="none" stroke="${scoreColor(s)}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" opacity="0.85"/>`;
           })()}
         </svg>` : '<span style="color:var(--muted);font-size:11px">–</span>';

    const tr = document.createElement('tr');
    tr.dataset.fredId = ind.fred_id;
    tr.style.cursor = 'pointer';
    if (ind.alert === 'RED')    tr.style.background = 'rgba(255,122,122,0.04)';
    if (ind.alert === 'YELLOW') tr.style.background = 'rgba(241,200,74,0.04)';
    tr.innerHTML = `
      <td>
        <div class="ind-name">${ind.name}${momentumHtml}${anomalyHtml}${staleBadgeHtml}</div>
        ${descHtml}
      </td>
      <td class="tbl-col-layer" style="color:var(--muted);font-size:12px;white-space:nowrap">${LAYER_NAMES[ind.layer] || ind.layer}</td>
      <td class="tbl-col-latest" style="white-space:nowrap">
        <strong>${fmtVal(ind.latest_value)}</strong>${
          ind.norm_mean !== null && ind.norm_mean !== undefined
            ? `<div style="font-size:10px;color:var(--muted);margin-top:2px">avg ${fmtVal(ind.norm_mean)}</div>`
            : ''
        }
      </td>
      <td class="tbl-col-asof">${fmtDate(ind.latest_date)}${staleHtml}</td>
      <td class="tbl-col-threshold" style="color:var(--muted);font-size:12px">${thr}</td>
      <td class="tbl-col-direction">${dirHtml}</td>
      <td>
        <div class="score-bar-wrap">
          <div class="score-bar" style="width:${Math.max(s,2)}px;max-width:80px;background:${scoreColor(s)}"></div>
          <span style="font-weight:600;color:${scoreColor(s)}">${s}</span>
        </div>
        ${pctileHtml}
      </td>
      <td><span class="badge ${a}">${ind.alert}</span></td>
      <td class="hide-sm col-trend">${sparkHtml}</td>
    `;
    tbody.appendChild(tr);
  });
}

// ─── KEY RISK SIGNALS ─────────────────────────────────────────────────────────
function renderKeyRisks(indicators) {
  const flagged = [...indicators]
    .filter(i => i.alert === 'RED' || i.alert === 'YELLOW')
    .sort((a, b) => b.score - a.score);

  const panel = document.getElementById('keyRisksPanel');
  const grid  = document.getElementById('keyRisksContent');
  const countEl = document.getElementById('keyRisksCount');

  if (!flagged.length) { panel.style.display = 'none'; return; }
  panel.style.display = '';
  countEl.textContent = `${flagged.length} flagged`;
  countEl.className   = flagged.some(i => i.alert === 'RED') ? 'badge RED' : 'badge YELLOW';

  grid.innerHTML = '';
  flagged.forEach(ind => {
    const s = ind.score ?? 0;
    const histVals = (ind.history || []).map(h => h.value).filter(v => v !== null && v !== undefined);
    let sparkSvg = '';
    if (histVals.length >= 3) {
      const min = Math.min(...histVals), max = Math.max(...histVals);
      const range = max - min || 1;
      const pts = histVals.slice(-16).map((v, i, arr) => {
        const x = 2 + (i / (arr.length - 1)) * 96;
        const y = 26 - ((v - min) / range) * 22;
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      }).join(' ');
      sparkSvg = `<svg viewBox="0 0 100 28" class="kr-sparkline" width="100" height="28">
        <polyline points="${pts}" fill="none" stroke="${scoreColor(s)}" stroke-width="1.8"
          stroke-linecap="round" stroke-linejoin="round"/>
      </svg>`;
    }

    const card = document.createElement('div');
    card.className = `kr-card ${ind.alert}`;
    card.title = ind.description || '';
    card.dataset.fredId = ind.fred_id;
    card.innerHTML = `
      <div class="kr-card-top">
        <div class="kr-card-name">${ind.name}</div>
        <div class="kr-card-score">${s}</div>
      </div>
      <div class="kr-card-meta">
        <span class="badge ${ind.alert}">${ind.alert}</span>
        <span class="kr-card-layer">${LAYER_NAMES[ind.layer] || ind.layer}</span>
        <div class="kr-bar-bg" style="min-width:40px">
          <div class="kr-bar-fill" style="width:${s}%;background:${scoreColor(s)}"></div>
        </div>
      </div>
      ${sparkSvg ? `<div>${sparkSvg}</div>` : ''}
      <div class="kr-card-val">Latest: <strong>${fmtVal(ind.latest_value)}</strong> · ${fmtDate(ind.latest_date)}</div>
    `;
    card.addEventListener('click', () => {
      const row = document.querySelector(`tr[data-fred-id="${ind.fred_id}"]`);
      if (row) {
        const tab = document.querySelector('[data-tab="live"]');
        tab?.click();
        row.scrollIntoView({ behavior: 'smooth', block: 'center' });
        row.classList.add('flash-update');
        setTimeout(() => row.classList.remove('flash-update'), 900);
      }
    });
    grid.appendChild(card);
  });
}

// Methodology lives in its own tab now; the collapse toggle is a no-op kept for compat.

// ─── FILTER LISTENERS ─────────────────────────────────────────────────────────
['layerFilter','categoryFilter','alertFilter'].forEach(id => {
  document.getElementById(id).addEventListener('change', applyFilters);
});
document.getElementById('indSearch')?.addEventListener('input', applyFilters);

// ─── SORT LISTENERS ───────────────────────────────────────────────────────────
document.querySelectorAll('th.sortable').forEach(th => {
  th.addEventListener('click', () => {
    const col = th.dataset.col;
    if (sortCol === col) {
      sortDir = sortDir === 'asc' ? 'desc' : 'asc';
    } else {
      sortCol = col;
      sortDir = col === 'score' || col === 'alert' ? 'desc' : 'asc';
    }
    updateSortHeaders();
    writeUrlState();
    applyFilters();
  });
});

// ─── PERMALINK STATE ──────────────────────────────────────────────────────────
function readUrlState() {
  const params = new URLSearchParams(location.hash.slice(1));
  const apply = (id, key) => {
    const v = params.get(key);
    if (v !== null) document.getElementById(id).value = v;
  };
  apply('layerFilter', 'layer');
  apply('categoryFilter', 'cat');
  apply('alertFilter', 'alert');
  if (params.get('sort')) sortCol = params.get('sort');
  if (params.get('dir'))  sortDir = params.get('dir');
}

function writeUrlState() {
  const params = new URLSearchParams();
  const set = (id, key) => {
    const v = document.getElementById(id).value;
    if (v) params.set(key, v);
  };
  set('layerFilter', 'layer');
  set('categoryFilter', 'cat');
  set('alertFilter', 'alert');
  if (sortCol !== 'score') params.set('sort', sortCol);
  if (sortDir !== 'desc')  params.set('dir', sortDir);
  if (activeTab && activeTab !== 'live') params.set('tab', activeTab);
  const str = params.toString();
  history.replaceState(null, '', str ? `#${str}` : location.pathname);
}

['layerFilter','categoryFilter','alertFilter'].forEach(id => {
  document.getElementById(id).addEventListener('change', writeUrlState);
});

window.addEventListener('hashchange', () => {
  readUrlState();
  updateSortHeaders();
  applyFilters();
});

// ─── EXPORT ───────────────────────────────────────────────────────────────────
function visibleIndicators() {
  const layer = document.getElementById('layerFilter').value;
  const cat   = document.getElementById('categoryFilter').value;
  const alrt  = document.getElementById('alertFilter').value;
  return sortIndicators(allIndicators.filter(ind => {
    if (layer && ind.layer !== layer) return false;
    if (cat   && ind.category !== cat) return false;
    if (alrt  && ind.alert !== alrt)   return false;
    return true;
  }));
}

function download(filename, content, mime) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}

document.getElementById('exportCsv').addEventListener('click', () => {
  const rows = visibleIndicators();
  const cols = ['name','fred_id','layer','category','latest_value','latest_date','score','level_score','momentum_score','alert','threshold','direction'];
  const csv = [
    cols.join(','),
    ...rows.map(r => cols.map(c => {
      const v = r[c];
      if (v === null || v === undefined) return '';
      const s = String(v);
      return /[,"\n]/.test(s) ? `"${s.replace(/"/g,'""')}"` : s;
    }).join(','))
  ].join('\n');
  download(`recession-tracker-${new Date().toISOString().slice(0,10)}.csv`, csv, 'text/csv');
});

document.getElementById('exportJson').addEventListener('click', () => {
  const rows = visibleIndicators().map(({ history, ...rest }) => rest);
  download(
    `recession-tracker-${new Date().toISOString().slice(0,10)}.json`,
    JSON.stringify(rows, null, 2),
    'application/json'
  );
});

// ─── INDICATOR DETAIL MODAL ───────────────────────────────────────────────────
let modalChart = null;
function openModal(ind) {
  document.getElementById('modalTitle').textContent = ind.name;
  const alertEl = document.getElementById('modalAlert');
  alertEl.textContent = ind.alert;
  alertEl.className = `badge ${alertClass(ind.alert)}`;
  document.getElementById('modalDesc').textContent = ind.description || '';
  document.getElementById('modalScore').textContent = ind.score?.toFixed?.(1) ?? ind.score ?? '—';
  document.getElementById('modalLevel').textContent = ind.level_score !== null && ind.level_score !== undefined
    ? ind.level_score.toFixed(1) : '—';
  document.getElementById('modalMomentum').textContent = ind.momentum_score !== null && ind.momentum_score !== undefined
    ? ind.momentum_score.toFixed(1) : '—';
  document.getElementById('modalLatest').textContent = fmtVal(ind.latest_value);
  document.getElementById('modalDate').textContent = fmtDate(ind.latest_date);
  document.getElementById('modalFredLink').href = `https://fred.stlouisfed.org/series/${ind.fred_id}`;

  if (typeof Chart === 'undefined') return;
  const ctx = document.getElementById('modalChart').getContext('2d');
  if (modalChart) modalChart.destroy();
  const history = ind.history || [];
  const labels = history.map(p => p.date.slice(0, 7));
  const values = history.map(p => p.value);
  const datasets = [{
    label: ind.name,
    data: values,
    borderColor: LAYER_COLORS[ind.layer] || '#66b3ff',
    backgroundColor: 'rgba(102,179,255,0.08)',
    borderWidth: 2,
    pointRadius: 2,
    pointHoverRadius: 5,
    fill: true,
    tension: 0.3
  }];
  if (ind.threshold !== null && ind.threshold !== undefined) {
    datasets.push({
      label: `Threshold (${ind.threshold})`,
      data: history.map(() => ind.threshold),
      borderColor: 'rgba(255,255,255,0.3)',
      borderDash: [4, 4], borderWidth: 1, pointRadius: 0, fill: false
    });
  }
  modalChart = new Chart(ctx, {
    type: 'line',
    data: { labels, datasets },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { ticks: { color: '#7a84a8', font: { size: 10 }, maxTicksLimit: 8 },
             grid: { color: 'rgba(255,255,255,0.03)' } },
        y: { ticks: { color: '#7a84a8', font: { size: 10 } },
             grid: { color: 'rgba(255,255,255,0.03)' } }
      }
    }
  });

  document.getElementById('modalBackdrop').classList.add('open');
}

function closeModal() {
  document.getElementById('modalBackdrop').classList.remove('open');
  if (modalChart) { modalChart.destroy(); modalChart = null; }
}

document.getElementById('modalClose').addEventListener('click', closeModal);
document.getElementById('modalBackdrop').addEventListener('click', e => {
  if (e.target.id === 'modalBackdrop') closeModal();
});
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });

// ─── DEEP-DIVE INLINE PANEL ────────────────────────────────────────────────────
let deepDiveOpenId = null;
let deepDiveChart  = null;

function closeDeepdive() {
  const existing = document.querySelector('.deep-dive-row');
  if (existing) existing.remove();
  if (deepDiveChart) { deepDiveChart.destroy(); deepDiveChart = null; }
  deepDiveOpenId = null;
}

function openDeepdive(tr, ind) {
  // Close existing panel
  closeDeepdive();

  // Create new inline row
  const ncols = tr.cells.length;
  const divRow = document.createElement('tr');
  divRow.className = 'deep-dive-row';
  divRow.innerHTML = `<td colspan="${ncols}"></td>`;
  tr.after(divRow);

  const s = ind.score ?? 0;
  const color = scoreColor(s);
  const histVals = (ind.history || []).filter(h => h.value !== null && h.value !== undefined);

  // Plain-English sentence
  const dir = ind.direction;
  const ms  = ind.momentum_score ?? 50;
  const rising  = ms >= 57;
  const falling = ms <= 43;
  let sentence;
  if (s >= 60) {
    sentence = dir === 'inverse'
      ? `${ind.name} is elevated and rising, signaling significant recession risk. High readings historically precede downturns.`
      : `${ind.name} has deteriorated sharply, contributing to elevated recession risk.`;
  } else if (s >= 30) {
    sentence = `${ind.name} is in moderate risk territory. ${rising ? 'Momentum is worsening — watch for further deterioration.' : falling ? 'Momentum is improving — risk may ease.' : 'Risk is stable but warrants monitoring.'}`;
  } else {
    sentence = dir === 'direct'
      ? `${ind.name} is healthy and supporting economic expansion.`
      : `${ind.name} is low, reducing recession pressure from this channel.`;
  }

  const panel = divRow.querySelector('td');
  const chartId = `dd-chart-${ind.fred_id.replace(/[^a-z0-9]/gi, '_')}`;
  const hasChart = histVals.length >= 2 && typeof Chart !== 'undefined';
  panel.innerHTML = `
    <div class="deep-dive-panel">
      <div class="deep-dive-inner">
        <div>
          ${hasChart
            ? `<div class="deep-dive-chart-wrap"><canvas id="${chartId}"></canvas></div>`
            : histVals.length < 2
              ? '<div style="color:var(--muted);font-size:13px;padding:20px 0">Insufficient history for chart</div>'
              : '<div style="color:var(--muted);font-size:13px;padding:20px 0">Chart unavailable (CDN offline)</div>'
          }
          <div class="deep-dive-desc">${ind.description || ''}</div>
          <div class="deep-dive-sentence">${sentence}</div>
        </div>
        <div class="deep-dive-meta">
          <div class="deep-dive-stat">
            <div class="lbl">Current Value</div>
            <div class="val" style="color:${color}">${ind.latest_value !== null && ind.latest_value !== undefined ? ind.latest_value.toFixed ? ind.latest_value.toFixed(2) : ind.latest_value : '—'}</div>
          </div>
          <div class="deep-dive-stat">
            <div class="lbl">Score</div>
            <div class="val" style="color:${color}">${s}/100</div>
          </div>
          <div class="deep-dive-stat">
            <div class="lbl">Percentile</div>
            <div class="val">${ind.percentile_rank !== null && ind.percentile_rank !== undefined ? ind.percentile_rank + 'th' : '—'}</div>
          </div>
          <div class="deep-dive-stat">
            <div class="lbl">Alert</div>
            <div class="val"><span class="badge ${alertClass(ind.alert)}">${ind.alert}</span></div>
          </div>
          ${ind.anomaly ? '<div class="deep-dive-stat"><div class="lbl">Anomaly</div><div class="val" style="color:var(--yellow)">⚡ Yes</div></div>' : ''}
          ${ind.stale ? '<div class="deep-dive-stat"><div class="lbl">Data Quality</div><div class="val"><span class="stale-badge">stale</span></div></div>' : ''}
        </div>
      </div>
    </div>`;

  // Draw the chart
  if (hasChart) {
    const labels = histVals.map(h => h.date?.slice(0, 7) || '');
    const values = histVals.map(h => h.value);
    deepDiveChart = new Chart(document.getElementById(chartId).getContext('2d'), {
      type: 'line',
      data: {
        labels,
        datasets: [{
          label: ind.name,
          data: values,
          borderColor: color,
          backgroundColor: s >= 60 ? 'rgba(255,122,122,0.08)' : s >= 30 ? 'rgba(241,200,74,0.08)' : 'rgba(45,220,140,0.08)',
          borderWidth: 2,
          pointRadius: 2,
          pointHoverRadius: 4,
          fill: false,
          tension: 0.3,
          spanGaps: true
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: '#1a2340', titleColor: '#eef2ff', bodyColor: '#7a84a8',
            borderColor: 'rgba(255,255,255,0.08)', borderWidth: 1
          }
        },
        scales: {
          x: { ticks: { color: '#7a84a8', maxTicksLimit: 8, font: { size: 10 } },
               grid: { color: 'rgba(255,255,255,0.03)' } },
          y: { ticks: { color: '#7a84a8', font: { size: 10 } },
               grid: { color: 'rgba(255,255,255,0.03)' } }
        }
      }
    });
  }

  deepDiveOpenId = ind.fred_id;
}

document.getElementById('tableBody').addEventListener('click', e => {
  const tr = e.target.closest('tr');
  if (!tr || tr.classList.contains('deep-dive-row')) return;
  const fredId = tr.dataset.fredId;
  if (!fredId) return;
  if (deepDiveOpenId === fredId) {
    // Second click on same row — close
    closeDeepdive();
    return;
  }
  const ind = allIndicators.find(x => x.fred_id === fredId);
  if (ind) openDeepdive(tr, ind);
});

// ─── ERROR ────────────────────────────────────────────────────────────────────
function showError(msg) {
  const el = document.getElementById('errorBanner');
  el.textContent = `⚠ ${msg}`;
  el.style.display = 'block';
}

// ─── DIFFUSION INDEX ─────────────────────────────────────────────────────────
function renderDiffusion(snap) {
  const inds = snap?.indicators || [];
  let green = 0, yellow = 0, red = 0;
  inds.forEach(i => {
    if (i.alert === 'RED') red++;
    else if (i.alert === 'YELLOW') yellow++;
    else green++;
  });
  const total = inds.length || 1;
  const breadth = ((red * 2 + yellow * 1) / (total * 2) * 100).toFixed(1);

  const counts = document.getElementById('diffusionCounts');
  if (counts) counts.innerHTML = `
    <div style="text-align:center">
      <div style="font-size:36px;font-weight:800;color:var(--green)">${green}</div>
      <div style="font-size:12px;color:var(--muted);margin-top:2px">GREEN</div>
    </div>
    <div style="text-align:center">
      <div style="font-size:36px;font-weight:800;color:var(--yellow)">${yellow}</div>
      <div style="font-size:12px;color:var(--muted);margin-top:2px">YELLOW</div>
    </div>
    <div style="text-align:center">
      <div style="font-size:36px;font-weight:800;color:var(--red)">${red}</div>
      <div style="font-size:12px;color:var(--muted);margin-top:2px">RED</div>
    </div>`;

  const bar = document.getElementById('diffusionBar');
  if (bar) bar.innerHTML = `
    <div style="flex:${green};background:var(--green)"></div>
    <div style="flex:${yellow};background:var(--yellow)"></div>
    <div style="flex:${red};background:var(--red)"></div>`;

  const scoreEl = document.getElementById('diffusionScore');
  if (scoreEl) {
    scoreEl.textContent = `${breadth}%`;
    scoreEl.style.color = breadth >= 60 ? 'var(--red)' : breadth >= 30 ? 'var(--yellow)' : 'var(--green)';
  }
}

// ─── DATA FRESHNESS SLA ──────────────────────────────────────────────────────
// Daily indicators should refresh within a few days; monthly within ~45 days.
// We classify each reporting indicator as fresh/stale by its own cadence and
// surface a single health ratio so silent FRED outages become visible.
function freshnessSlaDays(freq) {
  switch ((freq || '').toLowerCase()) {
    case 'daily':   return 5;
    case 'weekly':  return 12;
    case 'monthly': return 45;
    case 'quarterly': return 135;
    default:        return 45;
  }
}

function renderFreshness(snap) {
  const valEl = document.getElementById('freshValue');
  const subEl = document.getElementById('freshSub');
  if (!valEl) return;

  const reporting = (snap?.indicators || []).filter(i => i.latest_date);
  if (!reporting.length) {
    valEl.textContent = '—';
    return;
  }

  let fresh = 0;
  let worstDays = 0;
  let worstName = '';
  reporting.forEach(i => {
    const days = staleDays(i.latest_date) ?? 0;
    if (days <= freshnessSlaDays(i.frequency)) fresh++;
    else if (days > worstDays) { worstDays = days; worstName = i.name; }
  });

  const total = reporting.length;
  const pct = Math.round((fresh / total) * 100);
  valEl.textContent = `${fresh}/${total}`;
  valEl.style.color = pct === 100 ? 'var(--green)' : pct >= 85 ? 'var(--text)' : 'var(--yellow)';
  subEl.textContent = fresh === total
    ? 'all series within SLA window'
    : `oldest beyond SLA: ${worstName} (${worstDays}d)`;
}

// ─── RISK REGIME TRACKER ─────────────────────────────────────────────────────
// Reads the monthly history series and reports how long the composite has held
// its current alert state plus the date/direction of the last regime change.
function renderRegime(history) {
  const el = document.getElementById('regimeContent');
  if (!el) return;

  const sorted = [...(history || [])]
    .filter(h => h && h.alert)
    .sort((a, b) => a.date.localeCompare(b.date));

  if (sorted.length < 2) {
    el.innerHTML = '<div style="color:var(--muted)">Not enough history to determine regime.</div>';
    return;
  }

  const current = sorted[sorted.length - 1];
  const state = current.alert;

  // Walk backwards to find the streak of the current state
  let streak = 1;
  let flipIdx = -1;
  for (let i = sorted.length - 2; i >= 0; i--) {
    if (sorted[i].alert === state) { streak++; }
    else { flipIdx = i; break; }
  }

  const colorVar = state === 'RED' ? 'var(--red)' : state === 'YELLOW' ? 'var(--yellow)' : 'var(--green)';
  const flip = flipIdx >= 0 ? sorted[flipIdx] : null;
  const next = flipIdx >= 0 ? sorted[flipIdx + 1] : null;
  const escalated = flip ? (ALERT_ORDER[next.alert] > ALERT_ORDER[flip.alert]) : null;

  const flipHtml = flip
    ? `Last change: <strong style="color:var(--text)">${flip.alert} → ${next.alert}</strong>
       ${escalated ? '<span style="color:var(--red)">▲ escalated</span>' : '<span style="color:var(--green)">▼ de-escalated</span>'}
       on ${fmtDate(next.date)}`
    : `No regime change in the available ${sorted.length}-reading history.`;

  el.innerHTML = `
    <div style="display:flex;align-items:baseline;gap:14px;flex-wrap:wrap">
      <span class="badge ${alertClass(state)}">${state}</span>
      <span style="font-size:30px;font-weight:800;color:${colorVar}">${streak}</span>
      <span style="color:var(--muted);font-size:13px">consecutive ${streak === 1 ? 'reading' : 'readings'} in this state</span>
    </div>
    <div style="font-size:13px;color:var(--muted);margin-top:10px">${flipHtml}</div>`;
}

// ─── BIGGEST MOVERS (3-MONTH) ────────────────────────────────────────────────
// momentum_score encodes the 3-month change in an indicator's risk score:
// 50 = flat, >50 = risk rising, <50 = risk easing. Surface the largest moves.
function renderMovers(snap) {
  const el = document.getElementById('moversContent');
  if (!el) return;

  const moves = (snap?.indicators || [])
    .filter(i => i.momentum_score !== null && i.momentum_score !== undefined && i.latest_value !== null)
    .map(i => ({ name: i.name, fred_id: i.fred_id, delta: i.momentum_score - 50, score: i.score ?? 0 }))
    .filter(m => Math.abs(m.delta) >= 1);

  if (!moves.length) {
    el.innerHTML = '<div style="color:var(--muted);grid-column:1/-1">No notable moves over the trailing 3 months.</div>';
    return;
  }

  const risers  = moves.filter(m => m.delta > 0).sort((a, b) => b.delta - a.delta).slice(0, 5);
  const fallers = moves.filter(m => m.delta < 0).sort((a, b) => a.delta - b.delta).slice(0, 5);

  const row = (m) => {
    const up = m.delta > 0;
    const color = up ? 'var(--red)' : 'var(--green)';
    const arrow = up ? '▲' : '▼';
    return `
      <div class="mover-row" data-fred-id="${m.fred_id}"
           style="display:flex;justify-content:space-between;align-items:center;padding:7px 0;border-bottom:1px solid var(--border);cursor:pointer">
        <span style="font-size:13px">${m.name}</span>
        <span style="font-weight:700;color:${color};white-space:nowrap">${arrow} ${up ? '+' : ''}${m.delta.toFixed(1)}</span>
      </div>`;
  };

  const col = (title, rows, empty) => `
    <div>
      <div style="font-size:12px;font-weight:700;letter-spacing:0.04em;color:var(--muted);margin-bottom:6px">${title}</div>
      ${rows.length ? rows.map(row).join('') : `<div style="color:var(--muted);font-size:13px">${empty}</div>`}
    </div>`;

  el.innerHTML =
    col('RISK RISING', risers, 'None rising') +
    col('RISK EASING', fallers, 'None easing');

  el.querySelectorAll('.mover-row').forEach(r => {
    r.addEventListener('click', () => {
      const ind = (snap.indicators || []).find(x => x.fred_id === r.dataset.fredId);
      if (ind && typeof openModal === 'function') openModal(ind);
    });
  });
}

// ─── RECESSION PROBABILITY GAUGE ─────────────────────────────────────────────
// Semicircular dial (0–100%) with a needle at the 12-month probit probability
// and a marker at the ~30% historical warning threshold.
// ─── GEOPOLITICAL STRESS FLAGGER ──────────────────────────────────────────────
function renderGeopolitical(snap) {
  const panel = document.getElementById('geoPanel');
  if (!panel) return;
  const g = snap?.geopolitical;
  const market = g?.market;
  if (!g || (!market?.channels?.length && !g.gpr)) { panel.style.display = 'none'; return; }
  panel.style.display = '';

  const FLAG_CLASS = { CALM: 'badge-green', ELEVATED: 'badge-yellow', ACUTE: 'badge-red' };

  const flagEl = document.getElementById('geoFlag');
  const srcLabel = g.source === 'GPR' ? 'GPR' : 'market proxy';
  flagEl.textContent = `${g.flag} · ${g.score}/100 · ${srcLabel}`;
  flagEl.className = `badge ${FLAG_CLASS[g.flag] || ''}`;

  // Authoritative GPR row (when available) + the market channels as corroboration.
  let rows = '';
  if (g.gpr) {
    const w = Math.max(2, Math.min(100, g.gpr.score));
    const c = g.gpr.flag === 'ACUTE' ? 'var(--red)' : g.gpr.flag === 'ELEVATED' ? 'var(--yellow)' : 'var(--green)';
    rows += `
      <div style="display:flex;align-items:center;gap:12px">
        <div style="flex:0 0 180px;font-size:13px;color:var(--text);font-weight:600">GPR index (news-based)</div>
        <div style="flex:1;height:8px;background:rgba(255,255,255,0.06);border-radius:4px;overflow:hidden">
          <div style="width:${w}%;height:100%;background:${c}"></div>
        </div>
        <div style="flex:0 0 88px;text-align:right;font-size:12px;color:var(--muted)">${g.gpr.value} · ${g.gpr.flag}</div>
      </div>`;
  }
  rows += (market?.channels || []).map(c => {
    const w = Math.max(2, Math.min(100, c.sub_score));
    const cColor = c.sub_score >= 50 ? 'var(--red)' : c.sub_score >= 25 ? 'var(--yellow)' : 'var(--green)';
    return `
      <div style="display:flex;align-items:center;gap:12px">
        <div style="flex:0 0 180px;font-size:13px;color:var(--muted)">${c.name}${c.firing ? ' <span style="color:var(--red)">●</span>' : ''}</div>
        <div style="flex:1;height:8px;background:rgba(255,255,255,0.06);border-radius:4px;overflow:hidden">
          <div style="width:${w}%;height:100%;background:${cColor}"></div>
        </div>
        <div style="flex:0 0 88px;text-align:right;font-size:12px;color:var(--muted)">${c.display} · ${Math.round(c.sub_score)}</div>
      </div>`;
  }).join('');
  document.getElementById('geoChannels').innerHTML = rows;

  const CORROB = {
    confirmed: 'Markets are corroborating the geopolitical news — stress is being priced.',
    'news-leads-market': 'Geopolitical news is elevated but markets are not yet pricing it — watch for catch-up.',
    'market-stress-not-geopolitical': 'Market stress is present but GPR is calm — likely not geopolitical in origin.',
    calm: 'Both the GPR index and markets are calm.'
  };
  const summary = g.corroboration ? CORROB[g.corroboration] : (market?.firing?.length
    ? `Firing now: ${market.firing.join(', ')}.`
    : 'No market channels firing.');
  document.getElementById('geoSummary').textContent = `${summary} ${g.note}`;
}

function renderProbGauge(snap) {
  const el = document.getElementById('probGauge');
  if (!el) return;
  const p = snap?.composite?.recession_probability_12mo;
  if (p === null || p === undefined) {
    el.innerHTML = '<div style="color:var(--muted);padding:20px">No yield-curve data available.</div>';
    return;
  }

  const pct = Math.max(0, Math.min(1, p));
  const W = 280, H = 160, cx = W / 2, cy = H - 18, R = 116;
  const polar = (frac, r) => {
    const a = Math.PI * (1 - frac); // 0 → left (180°), 1 → right (0°)
    return [cx + r * Math.cos(a), cy - r * Math.sin(a)];
  };
  const arc = (f0, f1, r, color, width) => {
    const [x0, y0] = polar(f0, r);
    const [x1, y1] = polar(f1, r);
    const large = (f1 - f0) > 0.5 ? 1 : 0;
    return `<path d="M ${x0.toFixed(1)} ${y0.toFixed(1)} A ${r} ${r} 0 ${large} 1 ${x1.toFixed(1)} ${y1.toFixed(1)}"
      fill="none" stroke="${color}" stroke-width="${width}" stroke-linecap="round"/>`;
  };

  // Colored zones: green 0–30%, yellow 30–60%, red 60–100%
  const zones =
    arc(0,   0.30, R, '#2ddc8c', 16) +
    arc(0.30, 0.60, R, '#f1c84a', 16) +
    arc(0.60, 1,    R, '#ff7a7a', 16);

  const [nx, ny] = polar(pct, R - 12);
  const color = pct >= 0.6 ? '#ff7a7a' : pct >= 0.3 ? '#f1c84a' : '#2ddc8c';
  const [tx, ty] = polar(0.30, R + 14);

  el.innerHTML = `
    <svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img"
         aria-label="Recession probability ${(pct * 100).toFixed(0)} percent">
      ${zones}
      <line x1="${cx}" y1="${cy}" x2="${nx.toFixed(1)}" y2="${ny.toFixed(1)}"
            stroke="${color}" stroke-width="3" stroke-linecap="round"/>
      <circle cx="${cx}" cy="${cy}" r="6" fill="${color}"/>
      <circle cx="${tx.toFixed(1)}" cy="${ty.toFixed(1)}" r="3" fill="var(--muted)"/>
      <text x="${tx.toFixed(1)}" y="${(ty - 8).toFixed(1)}" text-anchor="middle"
            fill="var(--muted)" font-size="9">30%</text>
      <text x="${cx}" y="${cy - 36}" text-anchor="middle" fill="${color}"
            font-size="40" font-weight="800">${(pct * 100).toFixed(0)}%</text>
      <text x="14" y="${cy + 4}" fill="var(--muted)" font-size="11">0%</text>
      <text x="${W - 14}" y="${cy + 4}" text-anchor="end" fill="var(--muted)" font-size="11">100%</text>
    </svg>`;
}

// ─── WHAT CHANGED SINCE LAST UPDATE ──────────────────────────────────────────
// Diffs the current snapshot against the previously archived one (previous.json)
// and surfaces the composite move plus the indicators whose scores shifted most.
function renderChangePanel(current, previous) {
  const panel = document.getElementById('changePanel');
  const sub = document.getElementById('changeSub');
  const content = document.getElementById('changeContent');
  if (!panel || !previous || !previous.composite) return;

  panel.style.display = 'block';

  const curScore = current.composite?.score ?? 0;
  const prevScore = previous.composite?.score ?? 0;
  const dComp = curScore - prevScore;
  const compArrow = Math.abs(dComp) < 0.05 ? '→' : dComp > 0 ? '▲' : '▼';
  const compColor = Math.abs(dComp) < 0.05 ? 'var(--muted)' : dComp > 0 ? 'var(--red)' : 'var(--green)';

  sub.innerHTML = `Comparing the latest snapshot (${current.as_of || '—'}) with the prior one (${previous.as_of || '—'}).`;

  const prevById = new Map((previous.indicators || []).map(i => [i.fred_id, i]));
  const moves = (current.indicators || [])
    .map(i => {
      const prev = prevById.get(i.fred_id);
      if (!prev || prev.score === null || prev.score === undefined) return null;
      const delta = (i.score ?? 0) - (prev.score ?? 0);
      return { name: i.name, fred_id: i.fred_id, delta, from: prev.score, to: i.score };
    })
    .filter(m => m && Math.abs(m.delta) >= 0.1)
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
    .slice(0, 6);

  const movesHtml = moves.length
    ? moves.map(m => {
        const up = m.delta > 0;
        const c = up ? 'var(--red)' : 'var(--green)';
        return `
          <div class="change-row" data-fred-id="${m.fred_id}"
               style="display:flex;justify-content:space-between;align-items:center;padding:6px 0;border-bottom:1px solid var(--border);cursor:pointer">
            <span style="font-size:13px">${m.name}</span>
            <span style="font-size:12px;color:var(--muted)">
              ${m.from.toFixed(1)} → <strong style="color:${c}">${m.to.toFixed(1)}</strong>
              <span style="color:${c};margin-left:6px">${up ? '▲ +' : '▼ '}${m.delta.toFixed(1)}</span>
            </span>
          </div>`;
      }).join('')
    : '<div style="color:var(--muted);font-size:13px">No individual indicator moved by more than 0.1 points.</div>';

  content.innerHTML = `
    <div style="display:flex;align-items:baseline;gap:12px;margin-bottom:14px">
      <span style="color:var(--muted);font-size:13px">Composite</span>
      <span style="font-size:24px;font-weight:800">${prevScore.toFixed(1)} → ${curScore.toFixed(1)}</span>
      <span style="font-weight:700;color:${compColor}">${compArrow} ${dComp > 0 ? '+' : ''}${dComp.toFixed(1)}</span>
    </div>
    <div style="font-size:12px;font-weight:700;letter-spacing:0.04em;color:var(--muted);margin-bottom:4px">TOP INDICATOR MOVES</div>
    ${movesHtml}`;

  content.querySelectorAll('.change-row').forEach(r => {
    r.addEventListener('click', () => {
      const ind = (current.indicators || []).find(x => x.fred_id === r.dataset.fredId);
      if (ind && typeof openModal === 'function') openModal(ind);
    });
  });
}

// ─── WEI NOWCAST ─────────────────────────────────────────────────────────────
function renderWEI(snap) {
  const el = document.getElementById('weiValue');
  if (!el) return;
  const wei = snap?.indicators?.find(x => x.fred_id === 'WEI');
  const v = wei?.latest_value;
  if (v === null || v === undefined) { el.textContent = '—'; return; }
  el.textContent = Number(v).toFixed(2);
  el.style.color = v < 0 ? 'var(--red)' : v < 1 ? 'var(--yellow)' : 'var(--green)';
}

// ─── ECONOMIC SURPRISE SCORE ─────────────────────────────────────────────────
function renderSurprise(snap) {
  const el = document.getElementById('surpriseValue');
  if (!el) return;
  const inds = (snap.indicators || []).filter(x => x.latest_value !== null && x.history && x.history.length >= 3);
  if (!inds.length) { el.textContent = '—'; return; }
  const improving = inds.filter(ind => {
    const hist = ind.history;
    const recent = hist[hist.length - 1]?.value;
    const prior  = hist[hist.length - 4]?.value;  // ~3 months ago
    if (recent == null || prior == null) return false;
    return ind.direction === 'direct' ? recent > prior : recent < prior;
  });
  const pct = Math.round((improving.length / inds.length) * 100);
  el.textContent = `${pct}%`;
  el.style.color = pct >= 60 ? 'var(--green)' : pct >= 40 ? 'var(--yellow)' : 'var(--red)';
}

// ─── INTERACTIVE WEIGHT EDITOR ────────────────────────────────────────────────
const CANONICAL_WEIGHTS = {
  financial_lead: 0.27,
  labor:          0.22,
  inflation:      0.14,
  real_economy:   0.18,
  micro:          0.09,
  global:         0.10
};
let customWeights = { ...CANONICAL_WEIGHTS };
let weightEditorInited = false;

function updateWeightedComposite() {
  const el = document.getElementById('weightedComposite');
  if (!el || !allIndicators.length) return;
  // Group indicators by layer, compute layer scores, then blend
  const layerScores = {};
  const layerCounts = {};
  allIndicators.forEach(ind => {
    if (!layerScores[ind.layer]) { layerScores[ind.layer] = 0; layerCounts[ind.layer] = 0; }
    layerScores[ind.layer] += (ind.score || 0) * (ind.weight || 0);
    layerCounts[ind.layer] += (ind.weight || 0);
  });
  let composite = 0;
  Object.keys(customWeights).forEach(layer => {
    const ls = layerCounts[layer] > 0 ? layerScores[layer] / layerCounts[layer] : 0;
    composite += ls * customWeights[layer];
  });
  el.textContent = composite.toFixed(1);
  el.style.color = scoreColor(composite);
}

function initWeightEditor(snap) {
  const container = document.getElementById('weightSliders');
  if (!container) return;
  container.innerHTML = '';
  LAYER_ORDER.forEach(layer => {
    const pct = Math.round(customWeights[layer] * 100);
    const color = LAYER_COLORS[layer] || 'var(--accent)';
    const div = document.createElement('div');
    div.innerHTML = `
      <div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:4px">
        <span style="color:${color}">${LAYER_NAMES[layer]}</span>
        <span id="wlabel-${layer}" style="color:var(--muted)">${pct}%</span>
      </div>
      <input type="range" id="wslider-${layer}" min="0" max="50" step="1" value="${pct}"
        style="width:100%;accent-color:${color}">`;
    container.appendChild(div);
  });

  LAYER_ORDER.forEach(layer => {
    const slider = document.getElementById(`wslider-${layer}`);
    if (!slider) return;
    slider.addEventListener('input', () => {
      const newVal = slider.value / 100;
      const delta = newVal - customWeights[layer];
      // Re-normalize others proportionally
      const others = LAYER_ORDER.filter(l => l !== layer);
      const othersSum = others.reduce((s, l) => s + customWeights[l], 0);
      customWeights[layer] = newVal;
      if (othersSum > 0) {
        others.forEach(l => {
          customWeights[l] = Math.max(0, customWeights[l] - delta * (customWeights[l] / othersSum));
        });
      }
      // Normalize total to 1.0
      const total = Object.values(customWeights).reduce((a, b) => a + b, 0);
      if (total > 0) LAYER_ORDER.forEach(l => { customWeights[l] /= total; });
      // Update labels and other sliders
      LAYER_ORDER.forEach(l => {
        const lbl = document.getElementById(`wlabel-${l}`);
        const sld = document.getElementById(`wslider-${l}`);
        if (lbl) lbl.textContent = `${Math.round(customWeights[l] * 100)}%`;
        if (sld && l !== layer) sld.value = Math.round(customWeights[l] * 100);
      });
      updateWeightedComposite();
    });
  });

  document.getElementById('weightReset')?.addEventListener('click', () => {
    customWeights = { ...CANONICAL_WEIGHTS };
    LAYER_ORDER.forEach(l => {
      const lbl = document.getElementById(`wlabel-${l}`);
      const sld = document.getElementById(`wslider-${l}`);
      if (lbl) lbl.textContent = `${Math.round(customWeights[l] * 100)}%`;
      if (sld) sld.value = Math.round(customWeights[l] * 100);
    });
    updateWeightedComposite();
  });

  updateWeightedComposite();
}

// ─── BUSINESS CYCLE CONTEXT ───────────────────────────────────────────────────
function renderCycleContext() {
  const el = document.getElementById('cycleContent');
  if (!el) return;

  // Find latest recession end date
  const lastRec = NBER_RECESSIONS[NBER_RECESSIONS.length - 1];
  const endDate = new Date(lastRec.end);
  const now = new Date('2026-05-01');
  const monthsSince = Math.round((now - endDate) / (1000 * 60 * 60 * 24 * 30.44));
  const yearsFmt = (monthsSince / 12).toFixed(1);

  // Historical expansion durations (US expansions since 1945)
  const expansions = [12, 92, 120, 39, 73, 128, 128, 6, 128, 24, 10, 22, 8];
  const sorted = [...expansions].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  const maxExp = Math.max(...expansions);
  const rank = sorted.filter(x => x < monthsSince).length;
  const pct = Math.round(rank / sorted.length * 100);

  // Gauge: map current and median to a 0-100 range (max = maxExp)
  const gaugeWidth = 100;
  const currentPos = Math.min(100, Math.round(monthsSince / maxExp * gaugeWidth));
  const medianPos  = Math.min(100, Math.round(median / maxExp * gaugeWidth));

  el.innerHTML = `
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:16px;margin-bottom:20px">
      <div style="background:var(--panel-2);border-radius:8px;padding:14px">
        <div style="font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.06em;margin-bottom:6px">Since last recession ended</div>
        <div style="font-size:28px;font-weight:800;color:var(--accent)">${monthsSince}</div>
        <div style="font-size:12px;color:var(--muted)">months</div>
      </div>
      <div style="background:var(--panel-2);border-radius:8px;padding:14px">
        <div style="font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.06em;margin-bottom:6px">Current expansion age</div>
        <div style="font-size:28px;font-weight:800;color:var(--accent)">${monthsSince}</div>
        <div style="font-size:12px;color:var(--muted)">months (${yearsFmt} years)</div>
      </div>
      <div style="background:var(--panel-2);border-radius:8px;padding:14px">
        <div style="font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.06em;margin-bottom:6px">Historical rank</div>
        <div style="font-size:28px;font-weight:800;color:var(--yellow)">Top ${100-pct}%</div>
        <div style="font-size:12px;color:var(--muted)">of expansions since 1945</div>
      </div>
    </div>
    <div style="font-size:12px;color:var(--muted);margin-bottom:8px">Expansion duration gauge (median = ${median}mo, max = ${maxExp}mo)</div>
    <div style="position:relative;height:24px;background:var(--panel-3);border-radius:6px;margin-bottom:4px">
      <div style="position:absolute;left:0;top:0;height:100%;width:${currentPos}%;background:linear-gradient(to right,var(--green),var(--yellow));border-radius:6px;opacity:0.8"></div>
      <div style="position:absolute;top:-4px;bottom:-4px;width:3px;background:var(--yellow);border-radius:2px;left:${medianPos}%" title="Median: ${median} months"></div>
      <div style="position:absolute;right:6px;top:50%;transform:translateY(-50%);font-size:10px;color:var(--muted)">max ${maxExp}mo</div>
    </div>
    <div style="display:flex;gap:20px;font-size:11px;color:var(--muted)">
      <span><span style="display:inline-block;width:10px;height:10px;background:var(--yellow);border-radius:1px;margin-right:4px;vertical-align:middle"></span>Median ${median}mo</span>
      <span><span style="display:inline-block;width:10px;height:4px;background:linear-gradient(to right,var(--green),var(--yellow));border-radius:1px;margin-right:4px;vertical-align:middle"></span>Current ${monthsSince}mo</span>
    </div>`;
}

// ─── NBER BIG FOUR ───────────────────────────────────────────────────────────
function renderBigFour(snap) {
  const section = document.getElementById('bigFourPanel');
  const grid = document.getElementById('bigFourGrid');
  if (!section || !grid) return;

  const BIG_FOUR = [
    { fred_id: 'PAYEMS',  label: 'Nonfarm Payrolls' },
    { fred_id: 'INDPRO',  label: 'Industrial Production' },
    { fred_id: 'RSAFS',   label: 'Real Retail Sales' },
    { fred_id: 'W875RX1', label: 'Real Income ex Transfers' }
  ];

  const rows = BIG_FOUR.map(({ fred_id, label }) => {
    const ind = (snap.indicators || []).find(x => x.fred_id === fred_id);
    if (!ind || !ind.history || !ind.history.length) return '';

    // Find cycle high in history
    const hist = ind.history;
    let peakVal = -Infinity, peakDate = '';
    hist.forEach(p => { if (p.value > peakVal) { peakVal = p.value; peakDate = p.date; } });
    if (ind.latest_value > peakVal) { peakVal = ind.latest_value; peakDate = ind.latest_date || ''; }

    const current = ind.latest_value ?? 0;
    const pctOff = peakVal > 0 ? ((current - peakVal) / peakVal * 100) : 0;
    const isDown = pctOff < -0.1;
    const barW = Math.min(100, Math.abs(pctOff) * 10); // scale for visibility
    const color = isDown ? 'var(--red)' : 'var(--green)';

    return `<div style="background:var(--panel-2);border-radius:8px;padding:14px 18px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
        <span style="font-weight:600;font-size:13px">${label}</span>
        <span style="font-size:13px;font-weight:700;color:${color}">${pctOff >= 0 ? 'At high' : pctOff.toFixed(2) + '% off high'}</span>
      </div>
      <div style="background:var(--border);border-radius:4px;height:6px;margin-bottom:6px">
        <div style="width:${barW}%;height:100%;background:${color};border-radius:4px;transition:width .4s"></div>
      </div>
      <div style="display:flex;justify-content:space-between;font-size:11px;color:var(--muted)">
        <span>Current: ${fmtVal(current)}</span>
        <span>Peak: ${fmtVal(peakVal)} (${fmtDate(peakDate)})</span>
      </div>
    </div>`;
  });

  const filled = rows.filter(Boolean);
  if (!filled.length) { section.style.display = 'none'; return; }
  section.style.display = '';
  grid.innerHTML = filled.join('');
}

// ─── CORRELATION HEATMAP ──────────────────────────────────────────────────────
function renderCorrelationHeatmap(sorted) {
  const el = document.getElementById('correlationHeatmap');
  if (!el || !sorted.length) return;

  const layers = LAYER_ORDER;
  // Extract layer score series
  const series = {};
  layers.forEach(l => { series[l] = sorted.map(d => d.layers?.[l] ?? 0); });

  function pearson(a, b) {
    const n = a.length;
    if (n < 2) return 0;
    const meanA = a.reduce((s, v) => s + v, 0) / n;
    const meanB = b.reduce((s, v) => s + v, 0) / n;
    let num = 0, da = 0, db = 0;
    for (let i = 0; i < n; i++) {
      const ea = a[i] - meanA, eb = b[i] - meanB;
      num += ea * eb; da += ea * ea; db += eb * eb;
    }
    return (da && db) ? num / Math.sqrt(da * db) : 0;
  }

  function corrColor(r) {
    // r: -1 (blue) → 0 (neutral) → +1 (red)
    const c = Math.max(-1, Math.min(1, r));
    if (c >= 0) {
      const t = c;
      const r0 = Math.round(26 + t * (255 - 26));
      const g0 = Math.round(35 + t * (122 - 35));
      const b0 = Math.round(74 + t * (122 - 74));
      return `rgb(${r0},${g0},${b0})`;
    } else {
      const t = -c;
      const r0 = Math.round(26 + t * (102 - 26));
      const g0 = Math.round(35 + t * (179 - 35));
      const b0 = Math.round(74 + t * (255 - 74));
      return `rgb(${r0},${g0},${b0})`;
    }
  }

  const shortNames = { financial_lead: 'Fin.', labor: 'Labor', inflation: 'Infl.', real_economy: 'Real', micro: 'Micro', global: 'Global' };
  let html = '<table style="border-collapse:collapse;font-size:12px;min-width:340px"><thead><tr><th style="padding:6px 8px;color:var(--muted)"></th>';
  layers.forEach(l => { html += `<th style="padding:6px 8px;color:${LAYER_COLORS[l]};text-align:center">${shortNames[l]}</th>`; });
  html += '</tr></thead><tbody>';
  layers.forEach(la => {
    html += `<tr><td style="padding:6px 8px;color:${LAYER_COLORS[la]};font-weight:600;white-space:nowrap">${shortNames[la]}</td>`;
    layers.forEach(lb => {
      const r = pearson(series[la], series[lb]);
      const bg = corrColor(r);
      const textColor = Math.abs(r) > 0.4 ? '#fff' : 'var(--text)';
      html += `<td style="padding:6px 10px;background:${bg};color:${textColor};text-align:center;border-radius:4px">${r.toFixed(2)}</td>`;
    });
    html += '</tr>';
  });
  html += '</tbody></table>';
  el.innerHTML = html;
}

// ─── RECESSION PLAYBOOK ───────────────────────────────────────────────────────
const playbookCharts = [];

function renderPlaybook(sorted) {
  const el = document.getElementById('playbookCards');
  if (!el || !sorted.length) return;

  const recNames = ['1990-91 Recession', '2001 Dot-com Recession', '2007-09 Financial Crisis', '2020 COVID Recession'];

  el.innerHTML = '';
  NBER_RECESSIONS.forEach((rec, idx) => {
    const startDate = rec.start.slice(0, 7);
    const endDate   = rec.end.slice(0, 7);
    const startObj  = new Date(rec.start);
    const endObj    = new Date(rec.end);
    const durationMonths = Math.round((endObj - startObj) / (1000 * 60 * 60 * 24 * 30.44));

    // Window: 12 months before start through end
    const windowStart = new Date(startObj);
    windowStart.setMonth(windowStart.getMonth() - 12);
    const windowStartStr = windowStart.toISOString().slice(0, 7);

    const window = sorted.filter(d => d.date.slice(0, 7) >= windowStartStr && d.date.slice(0, 7) <= endDate);

    // Stats
    const peak = window.length ? Math.max(...window.map(d => d.composite)).toFixed(1) : '—';
    const firstYellow = window.find(d => d.composite >= 30);
    const firstRed    = window.find(d => d.composite >= 60);

    const details = document.createElement('details');
    details.style.cssText = 'background:var(--panel-2);border-radius:10px;margin-bottom:12px;overflow:hidden';
    details.innerHTML = `
      <summary style="padding:14px 18px;cursor:pointer;list-style:none;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px">
        <div>
          <strong style="color:var(--text)">${recNames[idx]}</strong>
          <span style="color:var(--muted);font-size:12px;margin-left:10px">${startDate} → ${endDate} · ${durationMonths} months</span>
        </div>
        <div style="display:flex;gap:12px;font-size:12px">
          <span style="color:var(--muted)">Peak: <strong style="color:var(--red)">${peak}</strong></span>
          <span style="color:var(--muted)">First YELLOW: <strong style="color:var(--yellow)">${firstYellow ? firstYellow.date.slice(0,7) : 'never'}</strong></span>
          <span style="color:var(--muted)">First RED: <strong style="color:var(--red)">${firstRed ? firstRed.date.slice(0,7) : 'never'}</strong></span>
        </div>
      </summary>
      <div style="padding:0 18px 18px">
        <div style="height:200px;margin-top:10px"><canvas id="playbook-chart-${idx}"></canvas></div>
      </div>`;

    el.appendChild(details);

    details.addEventListener('toggle', () => {
      if (details.open) {
        // Destroy existing if any
        if (playbookCharts[idx]) { playbookCharts[idx].destroy(); playbookCharts[idx] = null; }
        const canvas = document.getElementById(`playbook-chart-${idx}`);
        if (!canvas || !window.length || typeof Chart === 'undefined') return;
        const labels = window.map(d => d.date.slice(0, 7));
        const values = window.map(d => d.composite);
        const recStart = startDate;
        playbookCharts[idx] = new Chart(canvas.getContext('2d'), {
          type: 'line',
          data: {
            labels,
            datasets: [
              { label: 'Composite', data: values, borderColor: '#66b3ff', backgroundColor: 'rgba(102,179,255,0.08)',
                borderWidth: 2, pointRadius: 2, fill: true, tension: 0.3 },
              { label: '60 RED', data: values.map(() => 60), borderColor: 'rgba(255,122,122,0.4)', borderDash: [4,4], borderWidth: 1, pointRadius: 0, fill: false },
              { label: '30 YELLOW', data: values.map(() => 30), borderColor: 'rgba(241,200,74,0.4)', borderDash: [4,4], borderWidth: 1, pointRadius: 0, fill: false }
            ]
          },
          options: {
            responsive: true, maintainAspectRatio: false,
            plugins: {
              legend: { display: false },
              tooltip: { backgroundColor: '#1a2340', titleColor: '#eef2ff', bodyColor: '#7a84a8' }
            },
            scales: {
              x: { ticks: { color: '#7a84a8', maxTicksLimit: 8, font: { size: 10 } }, grid: { color: 'rgba(255,255,255,0.03)' } },
              y: { min: 0, max: 100, ticks: { color: '#7a84a8', font: { size: 10 } }, grid: { color: 'rgba(255,255,255,0.03)' } }
            }
          }
        });
      }
    });
  });
}

// ─── LIVE UPDATES ─────────────────────────────────────────────────────────────
const REFRESH_INTERVAL_MS = 5 * 60 * 1000;   // 5 minutes
let lastGeneratedAt = null;
let refreshTimer    = null;
let countdownTimer  = null;
let nextRefreshAt   = null;   // epoch ms when next auto-refresh fires
let isRefreshing    = false;

// ── Toast ──────────────────────────────────────────────────────────────────────
function showToast(msg, type = 'info', durationMs = 3500) {
  const container = document.getElementById('toastContainer');
  if (!container) return;
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.innerHTML = `<span class="toast-dot"></span>${msg}`;
  container.appendChild(el);
  setTimeout(() => {
    el.style.animation = 'toastOut 0.22s ease-in forwards';
    setTimeout(() => el.remove(), 230);
  }, durationMs);
}

// ── Flash score on new data ────────────────────────────────────────────────────
function flashUpdate() {
  const score = document.getElementById('compositeScore');
  score.classList.remove('flash-update');
  void score.offsetWidth;   // force reflow to restart animation
  score.classList.add('flash-update');
}

// ── Live indicator & countdown ─────────────────────────────────────────────────
function setLiveStatus(active) {
  const tag      = document.getElementById('liveTag');
  const label    = document.getElementById('liveLabel');
  const countdown = document.getElementById('liveCountdown');
  if (!tag) return;
  tag.classList.toggle('paused', !active);
  if (label) label.textContent = active ? 'LIVE' : 'PAUSED';
  if (countdown) countdown.textContent = active ? '' : '';
  tag.title = active
    ? 'Auto-refreshing every 5 minutes — click ↻ to refresh now'
    : 'Paused — tab is in background';
}

function updateCountdown() {
  const el = document.getElementById('liveCountdown');
  if (!el || !nextRefreshAt) return;
  const secsLeft = Math.max(0, Math.round((nextRefreshAt - Date.now()) / 1000));
  const m = Math.floor(secsLeft / 60);
  const s = String(secsLeft % 60).padStart(2, '0');
  el.textContent = ` ${m}:${s}`;
}

function startCountdown() {
  if (countdownTimer) clearInterval(countdownTimer);
  nextRefreshAt = Date.now() + REFRESH_INTERVAL_MS;
  updateCountdown();
  countdownTimer = setInterval(updateCountdown, 1000);
}

function stopCountdown() {
  if (countdownTimer) { clearInterval(countdownTimer); countdownTimer = null; }
  const el = document.getElementById('liveCountdown');
  if (el) el.textContent = '';
}

async function refresh({ initial = false } = {}) {
  if (isRefreshing) return;
  isRefreshing = true;
  const btn = document.getElementById('refreshNowBtn');
  if (btn) btn.classList.add('spinning');
  try {
    // Cache-bust so CDN/edge caches don't mask new data
    const bust = `?t=${Date.now()}`;
    const [current, history, previous] = await Promise.all([
      fetch(`data/current.json${bust}`).then(r => {
        if (!r.ok) throw new Error(`current.json HTTP ${r.status}`);
        return r.json();
      }),
      fetch(`data/history.json${bust}`).then(r => r.ok ? r.json() : []).catch(() => []),
      fetch(`data/previous.json${bust}`).then(r => r.ok ? r.json() : null).catch(() => null)
    ]);

    const isNewData = current.generated_at !== lastGeneratedAt;
    if (!initial && !isNewData) {
      return;   // unchanged — skip re-render
    }
    if (!initial && isNewData) {
      showToast('New data loaded', 'success');
    }
    lastGeneratedAt = current.generated_at;

    window._snapshotCache = current;
    window.dispatchEvent(new Event('snapshotLoaded'));
    renderHeader(current);
    renderHero(current, history);
    renderLayerCards(current, history);
    try { renderChart(history); } catch (ce) { console.warn('chart render failed:', ce.message); }
    try { renderCompositeHistory(current); } catch (ce) { console.warn('composite history chart failed:', ce.message); }
    renderTable(current.indicators || []);
    renderKeyRisks(current.indicators || []);
    renderEnsemble(current);
    try { renderFactorChart(current); } catch (ce) { console.warn('factor chart failed:', ce.message); }
    renderDiffusion(current);
    renderFreshness(current);
    renderRegime(history);
    renderMovers(current);
    renderProbGauge(current);
    renderGeopolitical(current);
    renderChangePanel(current, previous);
    renderWEI(current);
    renderSurprise(current);
    const ff = (current.indicators || []).find(x => x.fred_id === 'FEDFUNDS');
    const ffEl = document.getElementById('ffRate');
    const ffImpEl = document.getElementById('ffImplied');
    if (ff && ffEl) ffEl.textContent = ff.latest_value != null ? `${ff.latest_value.toFixed(2)}%` : '—';
    if (ff && ffImpEl) ffImpEl.textContent = ff.latest_value != null ? `${(ff.latest_value - 0.25).toFixed(2)}–${ff.latest_value.toFixed(2)}%` : '—';
    renderCycleContext();
    renderBigFour(current);
    loadAlertLog(bust);
    if (marketsRendered) { updateMarketSignals(); renderYieldCurve(current); renderFixedIncome(); }
    loadNarrative(bust);
    if (!weightEditorInited) { initWeightEditor(current); weightEditorInited = true; }
    else updateWeightedComposite();

    // NY Fed Model card (Kalshi panel)
    const nyfedEl = document.getElementById('nyfedProb');
    if (nyfedEl && current.composite?.recession_probability_12mo != null) {
      nyfedEl.textContent = `${(current.composite.recession_probability_12mo * 100).toFixed(1)}%`;
    }

    if (!initial) flashUpdate();
    document.getElementById('errorBanner').style.display = 'none';
  } catch (err) {
    if (initial) {
      showError(`Failed to load data: ${err.message}. Check that data/current.json exists.`);
    } else {
      showToast('Refresh failed — retrying next cycle', 'info');
    }
    console.error('refresh failed:', err);
  } finally {
    isRefreshing = false;
    const btn = document.getElementById('refreshNowBtn');
    if (btn) btn.classList.remove('spinning');
  }
}

function startPolling() {
  if (refreshTimer) return;
  refreshTimer = setInterval(() => { refresh(); startCountdown(); }, REFRESH_INTERVAL_MS);
  setLiveStatus(true);
  startCountdown();
}

function stopPolling() {
  if (!refreshTimer) return;
  clearInterval(refreshTimer);
  refreshTimer = null;
  setLiveStatus(false);
  stopCountdown();
}

document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    stopPolling();
  } else {
    refresh();       // catch up immediately on return
    startPolling();  // restarts interval + countdown
  }
});

// Manual refresh button
document.getElementById('refreshNowBtn')?.addEventListener('click', () => {
  // Reset the polling interval so next auto-refresh is 5 min from now
  if (refreshTimer) { clearInterval(refreshTimer); refreshTimer = null; }
  refresh().then(() => {
    if (!document.hidden) startPolling();
  });
});

// ─── TABS ─────────────────────────────────────────────────────────────────────
const NBER_RECESSIONS = [
  { start: '1990-07-01', end: '1991-03-31' },
  { start: '2001-03-01', end: '2001-11-30' },
  { start: '2007-12-01', end: '2009-06-30' },
  { start: '2020-02-01', end: '2020-04-30' }
];
let backtestRendered = false;
let marketsRendered  = false;
let activeTab = 'live';

let signalsRendered = false;
let watchlistRendered = false;
let portfolioRendered = false;
let optionsRendered   = false;
function setTab(name) {
  if (!['live','backtest','markets','watchlist','portfolio','options','signals','methodology'].includes(name)) name = 'live';
  activeTab = name;
  document.querySelectorAll('.tab-btn[data-tab]').forEach(b => {
    b.classList.toggle('active', b.dataset.tab === name);
  });
  document.querySelectorAll('.tab-content').forEach(c => {
    c.hidden = c.id !== `tab-${name}`;
  });
  writeUrlState();
  if (name === 'backtest' && !backtestRendered) {
    renderBacktest();
    backtestRendered = true;
  }
  if (name === 'markets' && !marketsRendered) {
    renderMarkets();
    marketsRendered = true;
  }
  if (name === 'signals' && !signalsRendered) {
    renderSignals();
    signalsRendered = true;
  }
  if (name === 'watchlist') {
    if (!watchlistRendered) {
      initWatchlist();
      watchlistRendered = true;
    }
    updateWatchlistMacroContext();
  }
  if (name === 'portfolio') {
    if (!portfolioRendered) {
      initPortfolio();
      portfolioRendered = true;
    }
    updatePortfolioMacro();
  }
  if (name === 'options') {
    if (!optionsRendered) {
      initOptions();
      optionsRendered = true;
    }
  }
}

// ─── YIELD CURVE SHAPE ───────────────────────────────────────────────────────
// Derives approximate absolute yields from FRED spread data and FEDFUNDS.
// 3M  ≈ FEDFUNDS
// 10Y = 3M + T10Y3M spread
// 2Y  = 10Y − T10Y2Y spread
// 5Y  = midpoint(2Y, 10Y) — rough estimate
// 30Y = 10Y + 0.35 — historical avg premium (rough)
function renderYieldCurve(snap) {
  if (typeof Chart === 'undefined') return;
  const canvas = document.getElementById('yieldCurveChart');
  const tableEl = document.getElementById('yieldCurveTable');
  if (!canvas || !tableEl) return;

  const inds = snap?.indicators || [];
  const ff  = inds.find(x => x.fred_id === 'FEDFUNDS')?.latest_value;
  const s3m = inds.find(x => x.fred_id === 'T10Y3M')?.latest_value;
  const s2y = inds.find(x => x.fred_id === 'T10Y2Y')?.latest_value;
  if (ff == null || s3m == null || s2y == null) return;

  const y3m  = ff;
  const y10y = ff + s3m;
  const y2y  = y10y - s2y;
  const y5y  = (y2y + y10y) / 2;
  const y30y = y10y + 0.35;

  const points = [
    { label: '3M',  y: y3m,  est: false },
    { label: '2Y',  y: y2y,  est: false },
    { label: '5Y',  y: y5y,  est: true  },
    { label: '10Y', y: y10y, est: false },
    { label: '30Y', y: y30y, est: true  }
  ];

  const inverted = y2y > y10y || y3m > y10y;
  const curveColor = inverted ? '#ff7a7a' : '#66b3ff';

  // Render table
  tableEl.innerHTML = points.map(p =>
    `<div style="display:flex;justify-content:space-between;gap:20px">
       <span style="color:var(--muted)">${p.label}${p.est ? '<sup style="font-size:9px">est</sup>' : ''}</span>
       <strong style="color:${p.est ? 'var(--muted)' : curveColor}">${p.y.toFixed(2)}%</strong>
     </div>`
  ).join('') + `<div style="margin-top:8px;font-size:12px;color:${inverted?'var(--red)':'var(--green)'}">${inverted ? '⚠ Curve inverted' : '✓ Positive slope'}</div>`;

  // Chart.js line chart
  if (canvas._yieldChart) canvas._yieldChart.destroy();
  canvas._yieldChart = new Chart(canvas.getContext('2d'), {
    type: 'line',
    data: {
      labels: points.map(p => p.label),
      datasets: [{
        data: points.map(p => p.y),
        borderColor: curveColor,
        backgroundColor: inverted ? 'rgba(255,122,122,0.08)' : 'rgba(102,179,255,0.08)',
        borderWidth: 2.5,
        pointRadius: 5,
        pointBackgroundColor: points.map(p => p.est ? '#7a84a8' : curveColor),
        fill: true,
        tension: 0.3
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: {
        callbacks: { label: i => ` ${i.parsed.y.toFixed(2)}%${points[i.dataIndex].est?' (est)':''}` }
      }},
      scales: {
        x: { ticks: { color: '#7a84a8', font: { size: 11 } }, grid: { color: 'rgba(255,255,255,0.03)' } },
        y: { ticks: { color: '#7a84a8', font: { size: 11 }, callback: v => v.toFixed(1)+'%' },
             grid: { color: 'rgba(255,255,255,0.03)' } }
      }
    }
  });
}

// ─── MARKETS TAB ──────────────────────────────────────────────────────────────
function renderMarkets() {
  function tv(containerId, src, config) {
    lazyTV(containerId, (el) => {
      const widget = document.createElement('div');
      widget.className = 'tradingview-widget-container__widget';
      widget.style.height = '100%';
      const script = document.createElement('script');
      script.type = 'text/javascript';
      script.src = `https://s3.tradingview.com/external-embedding/${src}.js`;
      script.async = true;
      script.textContent = JSON.stringify(config);
      el.appendChild(widget);
      el.appendChild(script);
    });
  }

  // ── Ticker tape ────────────────────────────────────────────────────────────
  tv('tv-ticker', 'embed-widget-ticker-tape', {
    symbols: [
      { proName: 'FOREXCOM:SPXUSD',  title: 'S&P 500'      },
      { proName: 'FOREXCOM:NSXUSD',  title: 'Nasdaq 100'   },
      { proName: 'INDEX:DJI',        title: 'Dow Jones'     },
      { proName: 'CME_MINI:ES1!',    title: 'S&P Futures'  },
      { proName: 'CME:NQ1!',         title: 'NQ Futures'   },
      { proName: 'TVC:US10Y',        title: '10Y Yield'     },
      { proName: 'TVC:US02Y',        title: '2Y Yield'      },
      { proName: 'NYMEX:CL1!',       title: 'WTI Oil'       },
      { proName: 'TVC:GOLD',         title: 'Gold'          },
      { proName: 'TVC:DXY',          title: 'Dollar Index'  },
      { proName: 'CBOE:VIX',         title: 'VIX'           },
      { proName: 'TVC:COPPER',       title: 'Copper'        },
      { proName: 'NYMEX:RB1!',    title: 'Gasoline Fut'  },
      { proName: 'COMEX:SI1!',    title: 'Silver'         },
      { proName: 'COMEX:HG1!',    title: 'Copper Fut'     },
      { proName: 'TVC:SILVER',    title: 'Silver Spot'    },
      { proName: 'FOREXCOM:EURUSD', title: 'EUR/USD'      },
      { proName: 'TVC:USOIL',     title: 'Brent'          }
    ],
    showSymbolLogo: true,
    isTransparent: true,
    displayMode: 'adaptive',
    colorTheme: 'dark',
    locale: 'en'
  });

  // ── Indices & Futures ──────────────────────────────────────────────────────
  tv('tv-indices', 'embed-widget-market-overview', {
    colorTheme: 'dark',
    dateRange: '12M',
    showChart: true,
    locale: 'en',
    width: '100%',
    height: 460,
    isTransparent: true,
    showSymbolLogo: false,
    tabs: [
      {
        title: 'US Indices',
        symbols: [
          { s: 'FOREXCOM:SPXUSD', d: 'S&P 500'    },
          { s: 'FOREXCOM:NSXUSD', d: 'Nasdaq 100' },
          { s: 'INDEX:DJI',       d: 'Dow Jones'  },
          { s: 'INDEX:RUT',       d: 'Russell 2000'}
        ]
      },
      {
        title: 'Futures',
        symbols: [
          { s: 'CME_MINI:ES1!',  d: 'S&P 500 Futures'   },
          { s: 'CME:NQ1!',       d: 'Nasdaq Futures'     },
          { s: 'CBOT:YM1!',      d: 'Dow Futures'        },
          { s: 'CME:RTY1!',      d: 'Russell 2000 Fut'   },
          { s: 'CBOT:ZN1!',      d: '10Y T-Note Fut'     },
          { s: 'CBOT:ZB1!',      d: '30Y T-Bond Fut'     },
          { s: 'CBOT:ZF1!',      d: '5Y T-Note Fut'      },
          { s: 'NYMEX:CL1!',     d: 'WTI Crude Fut'      },
          { s: 'NYMEX:NG1!',     d: 'Natural Gas Fut'    },
          { s: 'COMEX:GC1!',     d: 'Gold Futures'       },
          { s: 'COMEX:SI1!',     d: 'Silver Futures'     },
          { s: 'COMEX:HG1!',     d: 'Copper Futures'     }
        ]
      }
    ]
  });

  // ── Treasury yields ────────────────────────────────────────────────────────
  tv('tv-bonds', 'embed-widget-market-overview', {
    colorTheme: 'dark',
    dateRange: '12M',
    showChart: true,
    locale: 'en',
    width: '100%',
    height: 460,
    isTransparent: true,
    showSymbolLogo: false,
    tabs: [
      {
        title: 'Treasury Yields',
        symbols: [
          { s: 'TVC:US02Y',  d: '2Y Treasury'   },
          { s: 'TVC:US05Y',  d: '5Y Treasury'   },
          { s: 'TVC:US10Y',  d: '10Y Treasury'  },
          { s: 'TVC:US30Y',  d: '30Y Treasury'  }
        ]
      },
      {
        title: 'Bonds & Credit',
        symbols: [
          { s: 'CBOT:ZN1!',        d: '10Y T-Note Fut'        },
          { s: 'CBOT:ZB1!',        d: '30Y T-Bond Fut'        },
          { s: 'INDEX:BAMLH0A0HYM2EY', d: 'HY OAS Spread (ICE)' }
        ]
      }
    ]
  });

  // ── S&P 500 chart ──────────────────────────────────────────────────────────
  tv('tv-spx', 'embed-widget-symbol-overview', {
    symbols: [
      ['S&P 500', 'FOREXCOM:SPXUSD|12M'],
      ['Nasdaq 100', 'FOREXCOM:NSXUSD|12M'],
      ['Dow Jones', 'INDEX:DJI|12M']
    ],
    chartOnly: false,
    width: '100%',
    height: 380,
    locale: 'en',
    colorTheme: 'dark',
    isTransparent: true,
    showFloatingTooltip: false,
    scalePosition: 'right',
    scaleMode: 'Normal',
    fontFamily: '-apple-system, BlinkMacSystemFont, Trebuchet MS, Roboto, Ubuntu, sans-serif',
    fontSize: '10',
    noTimeScale: false,
    chartType: 'area',
    lineWidth: 2,
    lineType: 0,
    lineColor: '#66b3ff',
    topColor: 'rgba(102,179,255,0.2)',
    bottomColor: 'rgba(102,179,255,0)',
    dateRanges: ['1d|1','1m|30','3m|60','12m|1D','60m|1W','all|1M']
  });

  // ── Commodities ────────────────────────────────────────────────────────────
  tv('tv-commodities', 'embed-widget-market-overview', {
    colorTheme: 'dark',
    dateRange: '12M',
    showChart: true,
    locale: 'en',
    width: '100%',
    height: 400,
    isTransparent: true,
    showSymbolLogo: false,
    tabs: [
      {
        title: 'Energy',
        symbols: [
          { s: 'NYMEX:CL1!',     d: 'WTI Crude Oil'   },
          { s: 'TVC:USOIL',      d: 'Brent Crude'      },
          { s: 'NYMEX:NG1!',     d: 'Natural Gas'      },
          { s: 'NYMEX:RB1!',     d: 'RBOB Gasoline'    },
          { s: 'AMEX:XLE',       d: 'Energy Sector ETF'}
        ]
      },
      {
        title: 'Metals',
        symbols: [
          { s: 'TVC:GOLD',       d: 'Gold'             },
          { s: 'TVC:SILVER',     d: 'Silver'           },
          { s: 'TVC:COPPER',     d: 'Copper'           },
          { s: 'COMEX:PL1!',     d: 'Platinum'         },
          { s: 'TVC:DXY',        d: 'Dollar Index'     }
        ]
      },
      {
        title: 'Agriculture',
        symbols: [
          { s: 'CBOT:ZW1!',      d: 'Wheat'            },
          { s: 'CBOT:ZC1!',      d: 'Corn'             },
          { s: 'CBOT:ZS1!',      d: 'Soybeans'         },
          { s: 'NYMEX:OJ1!',     d: 'Orange Juice'     },
          { s: 'ICEUS:SB1!',     d: 'Sugar'            }
        ]
      }
    ]
  });

  // ── VIX & volatility ───────────────────────────────────────────────────────
  tv('tv-vix', 'embed-widget-symbol-overview', {
    symbols: [
      ['VIX (Fear Index)', 'CBOE:VIX|12M'],
      ['HY Spread ETF', 'AMEX:HYG|12M'],
      ['Inv. Yield ETF', 'NASDAQ:PFIX|12M']
    ],
    chartOnly: false,
    width: '100%',
    height: 400,
    locale: 'en',
    colorTheme: 'dark',
    isTransparent: true,
    showFloatingTooltip: false,
    scalePosition: 'right',
    scaleMode: 'Normal',
    chartType: 'area',
    lineWidth: 2,
    lineColor: '#ff7a7a',
    topColor: 'rgba(255,122,122,0.2)',
    bottomColor: 'rgba(255,122,122,0)',
    dateRanges: ['1d|1','1m|30','3m|60','12m|1D','60m|1W']
  });

  // ── Economic calendar ──────────────────────────────────────────────────────
  tv('tv-calendar', 'embed-widget-events', {
    colorTheme: 'dark',
    isTransparent: true,
    width: '100%',
    height: 500,
    locale: 'en',
    importanceFilter: '0,1',
    countryFilter: 'us'
  });

  // ── Sector heatmap ─────────────────────────────────────────────────────────
  tv('tv-heatmap', 'embed-widget-stock-heatmap', {
    exchanges: [],
    dataSource: 'SPX500',
    grouping: 'sector',
    blockSize: 'market_cap_basic',
    blockColor: 'change',
    locale: 'en',
    symbolUrl: '',
    colorTheme: 'dark',
    hasTopBar: false,
    isDataSetEnabled: false,
    isZoomEnabled: true,
    hasSymbolTooltip: true,
    isMonoSize: false,
    width: '100%',
    height: 420
  });

  // ── Market news ────────────────────────────────────────────────────────────
  tv('tv-news', 'embed-widget-timeline', {
    feedMode: 'market',
    market: 'stock',
    isTransparent: true,
    displayMode: 'regular',
    width: '100%',
    height: 420,
    colorTheme: 'dark',
    locale: 'en'
  });

  // ── Oil & Energy ──────────────────────────────────────────────────────────
  tv('tv-oil', 'embed-widget-symbol-overview', {
    symbols: [
      ['WTI Crude', 'NYMEX:CL1!|12M'],
      ['Brent Crude', 'TVC:USOIL|12M'],
      ['Natural Gas', 'NYMEX:NG1!|12M'],
      ['Energy ETF', 'AMEX:XLE|12M']
    ],
    chartOnly: false,
    width: '100%',
    height: 420,
    locale: 'en',
    colorTheme: 'dark',
    isTransparent: true,
    showFloatingTooltip: false,
    scalePosition: 'right',
    scaleMode: 'Normal',
    chartType: 'area',
    lineWidth: 2,
    lineColor: '#f1c84a',
    topColor: 'rgba(241,200,74,0.2)',
    bottomColor: 'rgba(241,200,74,0)',
    dateRanges: ['1d|1','1m|30','3m|60','12m|1D','60m|1W','all|1M']
  });

  // ── Full Futures Terminal ────────────────────────────────────────────────
  tv('tv-futures-full', 'embed-widget-market-overview', {
    colorTheme: 'dark',
    dateRange: '12M',
    showChart: true,
    locale: 'en',
    width: '100%',
    height: 500,
    isTransparent: true,
    showSymbolLogo: false,
    tabs: [
      {
        title: 'Equity Futures',
        symbols: [
          { s: 'CME_MINI:ES1!',  d: 'S&P 500 E-mini'     },
          { s: 'CME:NQ1!',       d: 'Nasdaq 100 E-mini'  },
          { s: 'CBOT:YM1!',      d: 'Dow Jones E-mini'   },
          { s: 'CME:RTY1!',      d: 'Russell 2000 E-mini'},
          { s: 'CME:VIX1!',      d: 'VIX Futures'        }
        ]
      },
      {
        title: 'Rates Futures',
        symbols: [
          { s: 'CBOT:ZN1!',  d: '10Y T-Note'   },
          { s: 'CBOT:ZB1!',  d: '30Y T-Bond'   },
          { s: 'CBOT:ZF1!',  d: '5Y T-Note'    },
          { s: 'CBOT:ZT1!',  d: '2Y T-Note'    },
          { s: 'CME:FF1!',   d: 'Fed Funds Fut' }
        ]
      },
      {
        title: 'Energy Futures',
        symbols: [
          { s: 'NYMEX:CL1!',  d: 'WTI Crude'     },
          { s: 'NYMEX:NG1!',  d: 'Natural Gas'    },
          { s: 'NYMEX:RB1!',  d: 'RBOB Gasoline'  },
          { s: 'NYMEX:HO1!',  d: 'Heating Oil'    }
        ]
      },
      {
        title: 'Metals Futures',
        symbols: [
          { s: 'COMEX:GC1!',  d: 'Gold'      },
          { s: 'COMEX:SI1!',  d: 'Silver'    },
          { s: 'COMEX:HG1!',  d: 'Copper'    },
          { s: 'COMEX:PL1!',  d: 'Platinum'  }
        ]
      }
    ]
  });

  // ── FX & Currency Markets ─────────────────────────────────────────────────
  tv('tv-forex', 'embed-widget-market-overview', {
    colorTheme: 'dark',
    dateRange: '12M',
    showChart: true,
    locale: 'en',
    width: '100%',
    height: 420,
    isTransparent: true,
    showSymbolLogo: false,
    tabs: [
      {
        title: 'Major Pairs',
        symbols: [
          { s: 'FX:EURUSD', d: 'EUR/USD' },
          { s: 'FX:GBPUSD', d: 'GBP/USD' },
          { s: 'FX:USDJPY', d: 'USD/JPY' },
          { s: 'FX:USDCHF', d: 'USD/CHF' },
          { s: 'FX:AUDUSD', d: 'AUD/USD' },
          { s: 'FX:USDCAD', d: 'USD/CAD' },
          { s: 'FX:NZDUSD', d: 'NZD/USD' }
        ]
      },
      {
        title: 'EM & Asia',
        symbols: [
          { s: 'FX:USDCNH', d: 'USD/CNH (Offshore Yuan)' },
          { s: 'FX:USDINR', d: 'USD/INR' },
          { s: 'FX:USDBRL', d: 'USD/BRL' },
          { s: 'FX:USDMXN', d: 'USD/MXN' },
          { s: 'FX:USDKRW', d: 'USD/KRW' },
          { s: 'FX:USDZAR', d: 'USD/ZAR' }
        ]
      }
    ]
  });

  tv('tv-dxy', 'embed-widget-symbol-overview', {
    symbols: [
      ['Dollar Index · DXY', 'TVC:DXY|12M'],
      ['EUR/USD',             'FX:EURUSD|12M'],
      ['USD/JPY',             'FX:USDJPY|12M']
    ],
    chartOnly: false,
    width: '100%',
    height: 420,
    locale: 'en',
    colorTheme: 'dark',
    autosize: true,
    showVolume: false,
    showMA: false,
    hideDateRanges: false,
    hideMarketStatus: false,
    hideSymbolLogo: false,
    scalePosition: 'right',
    scaleMode: 'Normal',
    fontFamily: '-apple-system, BlinkMacSystemFont, Trebuchet MS, Roboto, Ubuntu, sans-serif',
    fontSize: '10',
    noTimeScale: false,
    valuesTracking: '1',
    changeMode: 'price-and-percent',
    chartType: 'area',
    lineWidth: 2,
    lineType: 0,
    dateRanges: ['1d|1','1m|30','3m|60','12m|1D','60m|1W','all|1M']
  });

  // ── International Markets ─────────────────────────────────────────────────
  tv('tv-global', 'embed-widget-market-overview', {
    colorTheme: 'dark',
    dateRange: '12M',
    showChart: true,
    locale: 'en',
    width: '100%',
    height: 500,
    isTransparent: true,
    showSymbolLogo: false,
    tabs: [
      {
        title: 'Europe',
        symbols: [
          { s: 'INDEX:DEU40',  d: 'DAX 40 (Germany)'  },
          { s: 'INDEX:UK100',  d: 'FTSE 100 (UK)'      },
          { s: 'INDEX:FRA40',  d: 'CAC 40 (France)'    },
          { s: 'INDEX:ESP35',  d: 'IBEX 35 (Spain)'    },
          { s: 'INDEX:SMI',    d: 'SMI (Switzerland)'  },
          { s: 'INDEX:AEX',    d: 'AEX (Netherlands)'  }
        ]
      },
      {
        title: 'Asia-Pacific',
        symbols: [
          { s: 'INDEX:NKY',    d: 'Nikkei 225 (Japan)'   },
          { s: 'INDEX:HSI',    d: 'Hang Seng (HK)'       },
          { s: 'INDEX:SHCOMP', d: 'Shanghai Composite'   },
          { s: 'INDEX:AS51',   d: 'ASX 200 (Australia)'  },
          { s: 'INDEX:SENSEX', d: 'SENSEX (India)'       },
          { s: 'INDEX:KOSPI',  d: 'KOSPI (South Korea)'  }
        ]
      },
      {
        title: 'Americas',
        symbols: [
          { s: 'FOREXCOM:SPXUSD', d: 'S&P 500 (US)'       },
          { s: 'INDEX:IBOV',      d: 'Bovespa (Brazil)'   },
          { s: 'INDEX:TSX',       d: 'TSX (Canada)'       },
          { s: 'INDEX:MERV',      d: 'MERVAL (Argentina)' }
        ]
      },
      {
        title: 'EM & Global',
        symbols: [
          { s: 'MSCI:EEM',        d: 'MSCI Emerging Mkts' },
          { s: 'MSCI:EFA',        d: 'MSCI EAFE'          },
          { s: 'MSCI:ACWI',       d: 'MSCI ACWI'          },
          { s: 'TVC:DXY',         d: 'Dollar Index (DXY)' }
        ]
      }
    ]
  });

  // ── Rates / Fixed Income chart ────────────────────────────────────────────
  tv('tv-rates', 'embed-widget-symbol-overview', {
    symbols: [
      ['10Y Treasury · TVC:US10Y', 'TVC:US10Y|12M'],
      ['2Y Treasury · TVC:US02Y',  'TVC:US02Y|12M'],
      ['30Y Treasury · TVC:US30Y', 'TVC:US30Y|12M']
    ],
    chartOnly: false,
    width: '100%',
    height: 380,
    locale: 'en',
    colorTheme: 'dark',
    autosize: true,
    showVolume: false,
    chartType: 'line',
    lineWidth: 2,
    lineType: 0,
    dateRanges: ['1d|1','1m|30','3m|60','12m|1D','60m|1W','all|1M']
  });

  // ── Earnings Calendar ─────────────────────────────────────────────────────
  tv('tv-earnings', 'embed-widget-events', {
    colorTheme: 'dark',
    isTransparent: true,
    width: '100%',
    height: 500,
    locale: 'en',
    importanceFilter: '0,1',
    countryFilter: 'us',
    showFilters: true
  });

  // Update market-driven context signals using live snapshot data
  updateMarketSignals();
  renderFixedIncome();

  // Yield curve + oil cards use live FRED data from the snapshot
  const snap = window._snapshotCache;
  if (snap) {
    renderYieldCurve(snap);
    // Oil market signal card from FRED scoring
    const oilInd = (snap.indicators || []).find(x => x.fred_id === 'DCOILWTICO' || x.name?.toLowerCase().includes('oil') || x.fred_id === 'NFCI');
    const wtiEl = document.getElementById('oilWtiVal');
    const wtiSub = document.getElementById('oilWtiSub');
    const oilSig = document.getElementById('oilSignalVal');
    // Try to find any energy/oil related indicator score from the composite
    const energyInds = (snap.indicators || []).filter(x =>
      ['DCOILWTICO','BAMLH0A0HYM2','NFCI','BAA10YM','VIXCLS'].includes(x.fred_id)
    );
    if (wtiEl) {
      wtiEl.textContent = '—';
      wtiEl.style.color = 'var(--muted)';
      wtiSub.textContent = 'WTI not in FRED registry — see TradingView chart below';
    }
    if (oilSig && energyInds.length) {
      const avgScore = energyInds.reduce((s, x) => s + (x.score || 0), 0) / energyInds.length;
      oilSig.textContent = avgScore.toFixed(1);
      oilSig.style.color = avgScore >= 60 ? 'var(--red)' : avgScore >= 30 ? 'var(--yellow)' : 'var(--green)';
      document.querySelector('#oilCards .stat-card:last-child .stat-sub').textContent =
        'Avg score: VIX + credit spreads + fin. conditions';
    }
  }
}

function updateMarketSignals() {
  // Pull current snapshot to populate the context cards with live signal data
  const ycEl  = document.getElementById('mkt-yc-signal');
  const vixEl = document.getElementById('mkt-vix-signal');
  if (!window._snapshotCache) return;
  const snap = window._snapshotCache;
  const t10y3m = snap.indicators?.find(i => i.fred_id === 'T10Y3M');
  const vix    = snap.indicators?.find(i => i.fred_id === 'VIXCLS');
  if (ycEl && t10y3m) {
    const spread = t10y3m.latest_value;
    if (spread !== null && spread < 0) {
      ycEl.textContent = `Inverted: ${spread.toFixed(2)}%`;
      ycEl.className = 'signal risk';
    } else if (spread !== null && spread < 0.5) {
      ycEl.textContent = `Flat: ${spread?.toFixed(2)}%`;
      ycEl.className = 'signal warn';
    } else {
      ycEl.textContent = `Normal: +${spread?.toFixed(2)}%`;
      ycEl.className = 'signal';
    }
  }
  if (vixEl && vix) {
    const v = vix.latest_value;
    if (v !== null && v >= 25) {
      vixEl.textContent = `Elevated: VIX ${v?.toFixed(1)}`;
      vixEl.className = 'signal risk';
    } else if (v !== null && v >= 18) {
      vixEl.textContent = `Moderate: VIX ${v?.toFixed(1)}`;
      vixEl.className = 'signal warn';
    } else {
      vixEl.textContent = `Low: VIX ${v?.toFixed(1)}`;
      vixEl.className = 'signal';
    }
  }
}

document.querySelectorAll('.tab-btn[data-tab]').forEach(btn => {
  btn.addEventListener('click', () => setTab(btn.dataset.tab));
});

async function renderBacktest() {
  if (typeof Chart === 'undefined') {
    document.getElementById('btStats').innerHTML =
      '<p style="color:var(--muted);font-size:13px">Charts unavailable (Chart.js CDN offline). Data still loads.</p>';
    return;
  }
  let data;
  try {
    data = await fetch(`data/backtest.json?t=${Date.now()}`).then(r => r.json());
  } catch (err) {
    document.getElementById('btStats').innerHTML =
      `<p style="color:var(--red)">Failed to load backtest: ${err.message}</p>`;
    return;
  }
  const sorted = [...data].sort((a, b) => a.date.localeCompare(b.date));
  const tally = { GREEN: 0, YELLOW: 0, RED: 0 };
  sorted.forEach(d => tally[d.alert]++);
  const total = sorted.length || 1;

  const inRecession = date => NBER_RECESSIONS.some(r => date >= r.start && date <= r.end);
  let inRecHits = 0, inRecCount = 0;
  sorted.forEach(d => {
    if (inRecession(d.date)) {
      inRecCount++;
      if (d.alert !== 'GREEN') inRecHits++;
    }
  });

  document.getElementById('btStats').innerHTML = `
    <div class="stat-card"><div class="stat-label">Months replayed</div>
      <div class="stat-value">${total}</div>
      <div class="stat-sub">${sorted[0]?.date ?? '—'} → ${sorted[sorted.length-1]?.date ?? '—'}</div></div>
    <div class="stat-card"><div class="stat-label">% in GREEN</div>
      <div class="stat-value" style="color:var(--green)">${Math.round(tally.GREEN/total*100)}%</div>
      <div class="stat-sub">${tally.GREEN} months</div></div>
    <div class="stat-card"><div class="stat-label">% in YELLOW</div>
      <div class="stat-value" style="color:var(--yellow)">${Math.round(tally.YELLOW/total*100)}%</div>
      <div class="stat-sub">${tally.YELLOW} months</div></div>
    <div class="stat-card"><div class="stat-label">% in RED</div>
      <div class="stat-value" style="color:var(--red)">${Math.round(tally.RED/total*100)}%</div>
      <div class="stat-sub">${tally.RED} months</div></div>
    <div class="stat-card"><div class="stat-label">NBER sensitivity</div>
      <div class="stat-value">${inRecCount > 0 ? Math.round(inRecHits/inRecCount*100) + '%' : '—'}</div>
      <div class="stat-sub">% of recession months ≥ YELLOW</div></div>
  `;

  const nberPlugin = {
    id: 'nberBands',
    beforeDatasetsDraw(chart) {
      const { ctx, chartArea, scales } = chart;
      if (!scales.x) return;
      ctx.save();
      ctx.fillStyle = 'rgba(255,122,122,0.18)';
      NBER_RECESSIONS.forEach(r => {
        const idxStart = sorted.findIndex(d => d.date >= r.start);
        const idxEnd   = sorted.findIndex(d => d.date >  r.end);
        if (idxStart < 0) return;
        const left  = scales.x.getPixelForValue(idxStart);
        const right = idxEnd < 0
          ? chartArea.right
          : scales.x.getPixelForValue(Math.max(idxStart, idxEnd - 1));
        ctx.fillRect(left, chartArea.top, Math.max(right - left, 2), chartArea.bottom - chartArea.top);
      });
      ctx.restore();
    }
  };

  const labels = sorted.map(d => d.date.slice(0, 7));
  const ctx = document.getElementById('backtestChart').getContext('2d');
  new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [
        { label: 'Composite', data: sorted.map(d => d.composite),
          borderColor: '#66b3ff', backgroundColor: 'rgba(102,179,255,0.07)',
          borderWidth: 2, pointRadius: 0, pointHoverRadius: 4, fill: true, tension: 0.25 },
        { label: '60 RED', data: sorted.map(() => 60),
          borderColor: 'rgba(255,122,122,0.45)', borderDash: [4,4], borderWidth: 1, pointRadius: 0, fill: false },
        { label: '30 YELLOW', data: sorted.map(() => 30),
          borderColor: 'rgba(241,200,74,0.45)', borderDash: [4,4], borderWidth: 1, pointRadius: 0, fill: false }
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: '#1a2340', titleColor: '#eef2ff', bodyColor: '#7a84a8',
          borderColor: 'rgba(255,255,255,0.08)', borderWidth: 1,
          callbacks: {
            label: item => {
              const d = sorted[item.dataIndex];
              if (!d) return '';
              const tag = inRecession(d.date) ? ' [NBER recession]' : '';
              return ` ${d.composite.toFixed(1)} (${d.alert})${tag}`;
            }
          }
        }
      },
      scales: {
        x: { ticks: { color: '#7a84a8', maxTicksLimit: 14, font: { size: 11 } },
             grid: { color: 'rgba(255,255,255,0.03)' } },
        y: { min: 0, max: 100,
             ticks: { color: '#7a84a8', font: { size: 11 } },
             grid: { color: 'rgba(255,255,255,0.03)' } }
      }
    },
    plugins: [nberPlugin]
  });

  renderCorrelationHeatmap(sorted);
  renderPlaybook(sorted);
  renderValidation();
  renderOOS();
  renderRobustness();
}

// ─── ROBUSTNESS: WALK-FORWARD + BOOTSTRAP CI ──────────────────────────────────
async function renderRobustness() {
  const panel = document.getElementById('robustnessPanel');
  if (!panel) return;
  let r;
  try { r = await fetch(`data/robustness.json?t=${Date.now()}`).then(x => x.ok ? x.json() : null); } catch { r = null; }
  const wf = r?.walk_forward, b = r?.bootstrap_auc;
  if (!wf || !wf.valid) { panel.style.display = 'none'; return; }
  panel.style.display = '';

  const card = (label, value, sub, color) => `
    <div class="stat-card"><div class="stat-label">${label}</div>
      <div class="stat-value"${color ? ` style="color:${color}"` : ''}>${value}</div>
      <div class="stat-sub">${sub}</div></div>`;

  const ciWidth = b ? (b.ci95[1] - b.ci95[0]) : null;
  const ciColor = ciWidth == null ? 'var(--muted)' : ciWidth <= 0.12 ? 'var(--green)' : ciWidth <= 0.25 ? 'var(--yellow)' : 'var(--red)';

  document.getElementById('robustnessStats').innerHTML =
    card('Walk-forward folds', wf.summary.n_folds, 'rolling out-of-sample tests') +
    card('Mean test AUC', wf.summary.mean_test_auc ?? '—', `range ${wf.summary.min_test_auc}–${wf.summary.max_test_auc}`, 'var(--green)') +
    (b ? card('Bootstrap AUC', b.point ?? '—', `95% CI ${b.ci95[0]}–${b.ci95[1]}`, ciColor) : '') +
    (b ? card('CI width', ciWidth != null ? ciWidth.toFixed(3) : '—', 'narrower = more certain', ciColor) : '') +
    card('Mean Youden J', wf.summary.mean_test_youden_j ?? '—', 'across folds');

  document.getElementById('robustnessFolds').innerHTML = `
    <table class="alert-log-table">
      <thead><tr><th>Train through</th><th>Test recession mo</th><th>RED cutoff</th><th>Test AUC</th><th>Hit rate</th><th>FPR</th></tr></thead>
      <tbody>${wf.folds.map(f => `
        <tr>
          <td>${f.origin}</td>
          <td>${f.test_recession_months}</td>
          <td>${f.cutoff}</td>
          <td>${f.test_auc ?? '—'}</td>
          <td>${f.test_hit_rate != null ? Math.round(f.test_hit_rate * 100) + '%' : '—'}</td>
          <td>${f.test_fpr != null ? Math.round(f.test_fpr * 100) + '%' : '—'}</td>
        </tr>`).join('')}</tbody>
    </table>`;
}

// ─── OUT-OF-SAMPLE STUDY ──────────────────────────────────────────────────────
async function renderOOS() {
  const panel = document.getElementById('oosPanel');
  if (!panel) return;
  let o;
  try {
    o = await fetch(`data/oos.json?t=${Date.now()}`).then(r => r.ok ? r.json() : null);
  } catch { o = null; }
  if (!o || !o.valid) { panel.style.display = 'none'; return; }
  panel.style.display = '';

  const pct = x => x === null || x === undefined ? '—' : `${Math.round(x * 100)}%`;
  const gapColor = g => g === null ? 'var(--muted)' : Math.abs(g) <= 0.10 ? 'var(--green)' : Math.abs(g) <= 0.25 ? 'var(--yellow)' : 'var(--red)';
  const card = (label, value, sub, color) => `
    <div class="stat-card"><div class="stat-label">${label}</div>
      <div class="stat-value"${color ? ` style="color:${color}"` : ''}>${value}</div>
      <div class="stat-sub">${sub}</div></div>`;

  document.getElementById('oosStats').innerHTML =
    card('ROC AUC (train)', o.auc.train ?? '—', `${o.train_recession_months} recession mo`) +
    card('ROC AUC (test)', o.auc.test ?? '—', `${o.test_recession_months} held-out recession mo`, 'var(--green)') +
    card('RED cutoff (learned)', o.red.train?.cutoff ?? '—', 'frozen from train window') +
    card('RED skill gap', o.red.generalization_gap ?? '—', 'train J − test J', gapColor(o.red.generalization_gap)) +
    card('Test hit rate (RED)', pct(o.red.test?.hit_rate), `FPR ${pct(o.red.test?.false_positive_rate)}`, 'var(--green)');

  const row = (name, t) => t ? `
    <tr><td>${name}</td><td>${pct(t.hit_rate)}</td><td>${pct(t.false_positive_rate)}</td><td>${t.youden_j ?? '—'}</td></tr>` : '';
  document.getElementById('oosDetail').innerHTML = `
    <table class="alert-log-table">
      <thead><tr><th>Window (cutoff learned on train)</th><th>Hit rate</th><th>False-positive rate</th><th>Youden J</th></tr></thead>
      <tbody>
        ${row(`RED · train (pre-${o.cutoff})`, o.red.train)}
        ${row('RED · test (held out)', o.red.test)}
        ${row(`YELLOW · train (pre-${o.cutoff})`, o.yellow.train)}
        ${row('YELLOW · test (held out)', o.yellow.test)}
      </tbody>
    </table>`;

  // Layer-weight study: does tuning the composite weights beat the doctrinal
  // weighting on held-out recessions, or would it overfit?
  let w;
  try { w = await fetch(`data/weights.json?t=${Date.now()}`).then(r => r.ok ? r.json() : null); } catch { w = null; }
  if (w && w.valid) {
    const VERDICT = {
      'tuning-helps-out-of-sample': ['Tuning generalizes', 'var(--green)'],
      'tuning-overfits-keep-doctrinal': ['Tuning overfits — doctrinal weights kept', 'var(--yellow)'],
      'no-material-difference-doctrinal-is-fine': ['No material difference — doctrinal weights are fine', 'var(--muted)'],
      unknown: ['Inconclusive', 'var(--muted)']
    };
    const [label, color] = VERDICT[w.verdict] || VERDICT.unknown;
    document.getElementById('oosDetail').innerHTML += `
      <p style="font-size:12px;color:var(--muted);line-height:1.7;margin-top:14px">
        <strong>Layer-weight check:</strong> optimizing the six composite weights on the train window gives a
        held-out test AUC of <strong>${w.optimized.test_auc}</strong> vs the doctrinal <strong>${w.doctrinal.test_auc}</strong>
        (gain ${w.test_auc_gain}). Verdict: <span style="color:${color};font-weight:600">${label}</span>.
        The published model keeps the doctrinal weights — this is an honesty check, not an auto-tuner.
      </p>`;
  }
}

// ─── MODEL VALIDATION VS NBER ─────────────────────────────────────────────────
async function renderValidation() {
  const panel = document.getElementById('validationPanel');
  if (!panel) return;
  let data;
  try {
    data = await fetch(`data/validation.json?t=${Date.now()}`).then(r => r.ok ? r.json() : null);
  } catch { data = null; }
  const v = data?.yellow;
  // Need recession months in the replay window for the metrics to be meaningful.
  if (!v || !v.recession_months) { panel.style.display = 'none'; return; }
  panel.style.display = '';

  const pct = x => x === null || x === undefined ? '—' : `${Math.round(x * 100)}%`;
  const red = data.red || {};
  const card = (label, value, sub, color) => `
    <div class="stat-card"><div class="stat-label">${label}</div>
      <div class="stat-value"${color ? ` style="color:${color}"` : ''}>${value}</div>
      <div class="stat-sub">${sub}</div></div>`;

  document.getElementById('validationStats').innerHTML =
    card('Hit rate (≥YELLOW)', pct(v.hit_rate), `${v.recession_months} recession months`, 'var(--green)') +
    card('False positives (RED)', pct(red.false_positive_rate), `of ${red.expansion_months ?? '—'} expansion months`, 'var(--yellow)') +
    card('Avg lead time', v.avg_lead_months != null ? `${v.avg_lead_months} mo` : '—', 'warning before onset') +
    card('Brier score', v.brier ?? '—', 'lower = better (0.25 = coin flip)') +
    card('Recessions detected', `${(v.episodes || []).filter(e => e.detected).length}/${(v.episodes || []).length}`, 'in replay window');

  const eps = v.episodes || [];
  document.getElementById('validationEpisodes').innerHTML = eps.length ? `
    <table class="alert-log-table">
      <thead><tr><th>NBER recession</th><th>Detected</th><th>Flagged share</th><th>Lead time</th></tr></thead>
      <tbody>${eps.map(e => `
        <tr>
          <td>${e.label}</td>
          <td>${e.detected ? '<span class="badge badge-green">YES</span>' : '<span class="badge badge-red">MISS</span>'}</td>
          <td>${Math.round(e.flagged_share * 100)}%</td>
          <td>${e.lead_months} mo</td>
        </tr>`).join('')}</tbody>
    </table>` : '';
}

// ─── ENSEMBLE STAT CARD ───────────────────────────────────────────────────────
function renderEnsemble(snap) {
  const el = document.getElementById('ensembleValue');
  if (!el) return;
  const e = snap?.composite?.ensemble_score;
  if (e === null || e === undefined) { el.textContent = '—'; return; }
  el.textContent = e.toFixed(1);
  el.style.color = scoreColor(e);
}

// ─── FACTOR CONTRIBUTION CHART ────────────────────────────────────────────────
let factorChartInst = null;
function renderFactorChart(snap) {
  if (typeof Chart === 'undefined') return;
  const contribs = snap?.factor_contributions;
  const section  = document.getElementById('factorChartSection');
  if (!contribs || !contribs.length) { if (section) section.style.display = 'none'; return; }
  if (section) section.style.display = '';

  const sorted = [...contribs].sort((a, b) => a.contrib - b.contrib);
  const labels = sorted.map(x => x.name);
  const values = sorted.map(x => x.contrib);
  const colors = sorted.map(x => x.contrib >= 0 ? 'rgba(255,122,122,0.75)' : 'rgba(45,220,140,0.75)');

  const ctx = document.getElementById('factorChart').getContext('2d');
  if (factorChartInst) factorChartInst.destroy();
  factorChartInst = new Chart(ctx, {
    type: 'bar',
    data: { labels, datasets: [{ data: values, backgroundColor: colors, borderRadius: 4 }] },
    options: {
      indexAxis: 'y',
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: '#1a2340', titleColor: '#eef2ff', bodyColor: '#7a84a8',
          callbacks: {
            label: item => {
              const c = sorted[item.dataIndex];
              return ` ${c.contrib > 0 ? '+' : ''}${c.contrib.toFixed(3)}  (score ${c.score}, ${LAYER_NAMES[c.layer] || c.layer})`;
            }
          }
        }
      },
      scales: {
        x: { ticks: { color: '#7a84a8', font: { size: 10 } }, grid: { color: 'rgba(255,255,255,0.04)' } },
        y: { ticks: { color: '#c0c8e8', font: { size: 11 } }, grid: { display: false } }
      }
    }
  });
}

// ─── ALERT HISTORY LOG ────────────────────────────────────────────────────────
async function loadAlertLog(bust = '') {
  try {
    const log = await fetch(`data/alert-log.json${bust}`).then(r => r.ok ? r.json() : null).catch(() => null);
    const tbody  = document.getElementById('alertLogBody');
    const section = document.getElementById('alertLogSection');
    if (!log || !log.length) { if (section) section.style.display = 'none'; return; }
    if (section) section.style.display = '';
    tbody.innerHTML = log.map(it => `
      <tr>
        <td>${fmtDate(it.date)}</td>
        <td><span class="badge ${alertClass(it.alert)}">${it.alert}</span></td>
        <td style="color:${scoreColor(it.score)};font-weight:600">${it.score}</td>
        <td style="color:var(--muted);font-size:12px">${it.change || '—'}</td>
      </tr>`).join('');
  } catch {}
}

// ─── EXPERT SIGNALS (Twitter fallbacks) ───────────────────────────────────────
function renderSignals() {
  // Twitter/X embeds are widely blocked by CSP and X's current policy.
  // We render informational cards with direct links instead.
  const economists = [
    { id: 'sahm',     handle: 'claudiasahm', name: 'Claudia Sahm' },
    { id: 'elerian',  handle: 'elerianm',    name: 'Mohamed El-Erian' },
    { id: 'roubini',  handle: 'nouriel',     name: 'Nouriel Roubini' },
    { id: 'timiraos', handle: 'NickTimiraos', name: 'Nick Timiraos' }
  ];
  economists.forEach(({ id, handle, name }) => {
    const el = document.getElementById(`embed-${id}`);
    if (!el) return;
    el.innerHTML = `
      <div style="padding:28px 24px;text-align:center">
        <div style="font-size:32px;margin-bottom:12px">𝕏</div>
        <div style="color:var(--text);font-size:14px;font-weight:600;margin-bottom:6px">${name}</div>
        <div style="color:var(--muted);font-size:12px;margin-bottom:18px">@${handle}</div>
        <a href="https://twitter.com/${handle}" target="_blank" rel="noopener"
           style="display:inline-block;padding:8px 20px;background:var(--accent);color:#fff;border-radius:6px;font-size:13px;text-decoration:none;font-weight:600">
          View on X / Twitter →
        </a>
        <div style="margin-top:16px;color:var(--muted);font-size:11px">
          Embedded timelines are blocked by X's current policy. Click above to view live.
        </div>
      </div>`;
  });
}

// ─── PORTFOLIO TRACKER ───────────────────────────────────────────────────────
function initPortfolio() {
  const KEY = 'recession-tracker-portfolio-v1';
  const ASSET_COLORS = {
    Equity: '#66b3ff', ETF: '#4dd9c0', Bond: '#c97af1',
    Commodity: '#f0e442', Crypto: '#ff9f7a', Cash: '#2ddc8c', Other: '#7a84a8'
  };

  const load = () => { try { return JSON.parse(localStorage.getItem(KEY) || '[]'); } catch { return []; } };
  const save = d  => localStorage.setItem(KEY, JSON.stringify(d));
  const fmt$ = v  => v === null || v === undefined ? '—' : '$' + Number(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const fmtPct = v => v === null || v === undefined ? '—' : (v >= 0 ? '+' : '') + v.toFixed(2) + '%';

  function calcRow(p) {
    const mv   = p.qty * p.price;
    const cost = p.qty * p.cost;
    const pnl  = mv - cost;
    const pct  = cost > 0 ? (pnl / cost) * 100 : null;
    return { mv, cost, pnl, pct };
  }

  let allocChart = null;

  function renderAlloc(positions) {
    if (typeof Chart === 'undefined') return;
    const totals = {};
    positions.forEach(p => {
      const { mv } = calcRow(p);
      totals[p.assetClass] = (totals[p.assetClass] || 0) + mv;
    });
    const totalMV = Object.values(totals).reduce((a, b) => a + b, 0);
    const labels  = Object.keys(totals);
    const data    = labels.map(l => totals[l]);
    const colors  = labels.map(l => ASSET_COLORS[l] || '#7a84a8');

    const canvas = document.getElementById('portAllocChart');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (allocChart) allocChart.destroy();

    if (!data.length) { ctx.clearRect(0, 0, canvas.width, canvas.height); return; }

    allocChart = new Chart(ctx, {
      type: 'doughnut',
      data: { labels, datasets: [{ data, backgroundColor: colors, borderWidth: 2, borderColor: 'var(--panel)' }] },
      options: {
        responsive: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: '#1a2340', titleColor: '#eef2ff', bodyColor: '#7a84a8',
            callbacks: { label: i => ` ${i.label}: ${fmt$(i.parsed)} (${totalMV > 0 ? (i.parsed / totalMV * 100).toFixed(1) : 0}%)` }
          }
        }
      }
    });

    const legend = document.getElementById('portAllocLegend');
    if (legend) {
      legend.innerHTML = labels.map((l, i) =>
        `<div><span class="port-alloc-dot" style="background:${colors[i]}"></span><strong>${l}</strong> — ${fmt$(data[i])} (${totalMV > 0 ? (data[i] / totalMV * 100).toFixed(1) : 0}%)</div>`
      ).join('');
    }
  }

  function renderTable() {
    const positions = load();
    const tbody  = document.getElementById('portTbody');
    const emptyEl = document.getElementById('portEmptyMsg');
    if (!tbody) return;
    tbody.innerHTML = '';
    if (!positions.length) {
      if (emptyEl) emptyEl.style.display = '';
      document.getElementById('portCount').textContent = '0';
      ['portTotalVal','portTotalPnl','portCostBasis','portEquityPct','portMacroScore'].forEach(id => {
        const el = document.getElementById(id); if (el) el.textContent = '—';
      });
      renderAlloc([]);
      return;
    }
    if (emptyEl) emptyEl.style.display = 'none';

    let totalMV = 0, totalCost = 0, totalPnl = 0;
    let equityMV = 0;

    positions.forEach((p, idx) => {
      const { mv, cost, pnl, pct } = calcRow(p);
      totalMV   += mv;
      totalCost += cost;
      totalPnl  += pnl;
      if (['Equity','ETF'].includes(p.assetClass)) equityMV += mv;

      const pnlClass = pnl >= 0 ? 'port-pnl-pos' : 'port-pnl-neg';
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td><strong>${escHtml(p.symbol)}</strong></td>
        <td><span style="background:${ASSET_COLORS[p.assetClass]||'#7a84a8'}22;color:${ASSET_COLORS[p.assetClass]||'#7a84a8'};border-radius:4px;padding:2px 7px;font-size:11px;font-weight:700">${escHtml(p.assetClass)}</span></td>
        <td>${Number(p.qty).toLocaleString(undefined,{maximumFractionDigits:4})}</td>
        <td>${fmt$(p.cost)}</td>
        <td>
          <input type="number" step="0.01" min="0" value="${p.price}"
            style="background:var(--panel-2);border:1px solid var(--border);border-radius:5px;
                   color:var(--text);padding:4px 7px;width:90px;font-size:12px;font-family:inherit"
            data-idx="${idx}" class="price-edit" />
        </td>
        <td>${fmt$(mv)}</td>
        <td class="${pnlClass}">${fmt$(pnl)}</td>
        <td class="${pnlClass}">${fmtPct(pct)}</td>
        <td><button class="rm-btn port-table" data-idx="${idx}" title="Remove">×</button></td>`;
      tbody.appendChild(tr);
    });

    document.getElementById('portCount').textContent     = positions.length;
    document.getElementById('portTotalVal').textContent  = fmt$(totalMV);
    document.getElementById('portCostBasis').textContent = fmt$(totalCost);

    const pnlEl = document.getElementById('portTotalPnl');
    pnlEl.textContent  = fmt$(totalPnl);
    pnlEl.style.color  = totalPnl >= 0 ? 'var(--green)' : 'var(--red)';
    const pnlPctEl = document.getElementById('portTotalPnlPct');
    pnlPctEl.textContent = totalCost > 0 ? fmtPct(totalPnl / totalCost * 100) : '—';

    const eqPct = totalMV > 0 ? (equityMV / totalMV * 100).toFixed(1) + '%' : '—';
    document.getElementById('portEquityPct').textContent = eqPct;

    renderAlloc(positions);
    updatePortfolioMacro();

    // Live price-edit listeners
    tbody.querySelectorAll('.price-edit').forEach(inp => {
      inp.addEventListener('change', () => {
        const data = load();
        const i = parseInt(inp.dataset.idx);
        if (data[i]) { data[i].price = parseFloat(inp.value) || 0; save(data); renderTable(); }
      });
    });
    // Remove listeners
    tbody.querySelectorAll('.rm-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const data = load();
        data.splice(parseInt(btn.dataset.idx), 1);
        save(data); renderTable();
      });
    });
  }

  function addPosition() {
    const sym   = document.getElementById('portSym')?.value.trim().toUpperCase();
    const qty   = parseFloat(document.getElementById('portQty')?.value);
    const cost  = parseFloat(document.getElementById('portCost')?.value);
    const price = parseFloat(document.getElementById('portPrice')?.value);
    const cls   = document.getElementById('portClass')?.value || 'Equity';
    if (!sym || isNaN(qty) || isNaN(cost)) {
      alert('Symbol, Shares, and Avg Cost are required.');
      return;
    }
    const data = load();
    data.push({ symbol: sym, qty, cost, price: isNaN(price) ? cost : price, assetClass: cls, addedAt: new Date().toISOString() });
    save(data);
    ['portSym','portQty','portCost','portPrice'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
    renderTable();
  }

  document.getElementById('portAddBtn')?.addEventListener('click', addPosition);
  document.getElementById('portSym')?.addEventListener('keydown', e => { if (e.key === 'Enter') addPosition(); });

  // Export CSV
  document.getElementById('portExportBtn')?.addEventListener('click', () => {
    const rows = [['Symbol','Asset Class','Shares','Avg Cost','Current Price','Market Value','P&L','P&L%'].join(',')]
      .concat(load().map(p => {
        const { mv, pnl, pct } = calcRow(p);
        return [p.symbol, p.assetClass, p.qty, p.cost, p.price, mv.toFixed(2), pnl.toFixed(2), (pct||0).toFixed(2)].join(',');
      }));
    const a = document.createElement('a');
    a.href = 'data:text/csv,' + encodeURIComponent(rows.join('\n'));
    a.download = `portfolio-${new Date().toISOString().slice(0,10)}.csv`;
    a.click();
  });

  // Import CSV
  document.getElementById('portImportBtn')?.addEventListener('click', () => document.getElementById('portImportFile')?.click());
  document.getElementById('portImportFile')?.addEventListener('change', async e => {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    const lines = text.trim().split('\n').slice(1);
    const data = load();
    lines.forEach(line => {
      const [symbol, assetClass, qty, cost, price] = line.split(',');
      if (symbol && qty && cost) {
        data.push({ symbol: symbol.trim().toUpperCase(), assetClass: assetClass||'Equity', qty: parseFloat(qty), cost: parseFloat(cost), price: parseFloat(price||cost), addedAt: new Date().toISOString() });
      }
    });
    save(data); renderTable();
    e.target.value = '';
  });

  // Clear all
  document.getElementById('portClearBtn')?.addEventListener('click', () => {
    if (confirm('Clear all positions?')) { save([]); renderTable(); }
  });

  // Level 2 chart loader
  function loadL2Chart(symbol) {
    resetLazyTV('l2ChartWrap');
    const wrap = document.getElementById('l2ChartWrap');
    if (wrap) wrap.innerHTML = '';
    lazyTV('l2ChartWrap', (el) => {
      const w = document.createElement('div');
      w.className = 'tradingview-widget-container__widget';
      w.style.height = '100%';
      const s = document.createElement('script');
      s.type = 'text/javascript';
      s.src  = 'https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js';
      s.async = true;
      s.textContent = JSON.stringify({
        autosize: true,
        symbol: symbol || 'NASDAQ:SPY',
        interval: '5',
        timezone: 'America/New_York',
        theme: document.documentElement.dataset.theme === 'light' ? 'light' : 'dark',
        style: '1',
        locale: 'en',
        withdateranges: true,
        range: '1D',
        hide_side_toolbar: false,
        allow_symbol_change: true,
        watchlist: ['NASDAQ:SPY','NASDAQ:QQQ','AMEX:GLD','CBOT:ZN1!','CBOE:VIX'],
        studies: ['Volume@tv-basicstudies', 'VWAP@tv-basicstudies'],
        show_popup_button: true,
        popup_width: '1000',
        popup_height: '650'
      });
      el.appendChild(w);
      el.appendChild(s);
    });
  }

  document.getElementById('l2LoadBtn')?.addEventListener('click', () => {
    const sym = document.getElementById('l2SymInput')?.value.trim();
    loadL2Chart(sym || 'SPY');
  });
  loadL2Chart('SPY');

  renderTable();
}

function updatePortfolioMacro() {
  const snap = window._snapshotCache;
  if (!snap) return;
  const score = snap.composite?.score ?? null;
  const alert = snap.composite?.alert ?? '—';
  if (score === null) return;

  const el = document.getElementById('portMacroScore');
  if (el) {
    el.textContent = score;
    el.style.color = score >= 60 ? 'var(--red)' : score >= 30 ? 'var(--yellow)' : 'var(--green)';
  }
  const subEl = document.getElementById('portMacroSub');
  if (subEl) subEl.textContent = `Alert: ${alert}`;

  const advice = document.getElementById('portMacroAdvice');
  if (advice) {
    let text, color;
    if (score >= 60) {
      text  = '🔴 RED — High recession risk. Consider reducing equity and high-yield bond exposure. Rotate toward short-duration Treasuries (SHY, BIL), gold (GLD), and defensive sectors (XLU, XLP, XLV). Consider put hedges on broad market ETFs (SPY puts). Cash is a position.';
      color = 'var(--red)';
    } else if (score >= 30) {
      text  = '🟡 YELLOW — Elevated watch. Maintain diversification. Consider trimming high-beta positions and adding hedges. Ensure your bond allocation is adequate. Avoid adding significant leverage. Review concentration in cyclical sectors (XLY, XLB, XLI).';
      color = 'var(--yellow)';
    } else {
      text  = '🟢 GREEN — Low recession risk. Historical precedent supports maintaining risk-on positioning. Continue monitoring; the Financial Leading and Labor layers typically turn first when conditions deteriorate. Ensure you have a hedge plan ready.';
      color = 'var(--green)';
    }
    advice.textContent = text;
    advice.style.color = color;
  }

  // Risk breakdown by asset class
  const KEY = 'recession-tracker-portfolio-v1';
  let positions = [];
  try { positions = JSON.parse(localStorage.getItem(KEY) || '[]'); } catch {}
  const riskEl = document.getElementById('portRiskBreakdown');
  if (!riskEl || !positions.length) return;

  const riskMap = { Equity: 'HIGH', ETF: 'VARIES', Bond: 'LOW-MED', Commodity: 'MEDIUM', Crypto: 'HIGH', Cash: 'NONE', Other: 'UNKNOWN' };
  const colorMap = { HIGH:'var(--red)', VARIES:'var(--yellow)', 'LOW-MED':'var(--green)', MEDIUM:'var(--yellow)', NONE:'var(--muted)', UNKNOWN:'var(--muted)' };
  riskEl.innerHTML = positions.slice(0,8).map(p =>
    `<div style="display:flex;justify-content:space-between;font-size:12px;padding:4px 0;border-bottom:1px solid var(--border)">
      <span style="font-weight:700">${escHtml(p.symbol)}</span>
      <span style="color:${colorMap[riskMap[p.assetClass]]||'var(--muted)'}">Recession risk: ${escHtml(riskMap[p.assetClass]||'—')}</span>
    </div>`
  ).join('');
}

// ─── OPTIONS CALCULATOR (BLACK-SCHOLES) ────────────────────────────────────────
function initOptions() {
  // Standard normal CDF via Horner's method
  function normCDF(x) {
    const a1=0.254829592, a2=-0.284496736, a3=1.421413741, a4=-1.453152027, a5=1.061405429, p=0.3275911;
    const sign = x < 0 ? -1 : 1;
    x = Math.abs(x) / Math.SQRT2;
    const t = 1 / (1 + p * x);
    const y = 1 - (((((a5*t + a4)*t) + a3)*t + a2)*t + a1)*t*Math.exp(-x*x);
    return 0.5 * (1 + sign * y);
  }
  function normPDF(x) { return Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI); }

  function bs(S, K, T, r, sigma) {
    if (T <= 0 || sigma <= 0 || S <= 0 || K <= 0) return null;
    const d1 = (Math.log(S/K) + (r + 0.5*sigma*sigma)*T) / (sigma*Math.sqrt(T));
    const d2 = d1 - sigma*Math.sqrt(T);
    const Nd1 = normCDF(d1), Nd2 = normCDF(d2);
    const Nd1n = normCDF(-d1), Nd2n = normCDF(-d2);
    const sqrtT = Math.sqrt(T);
    const expRT = Math.exp(-r*T);

    const callPrice = S*Nd1 - K*expRT*Nd2;
    const putPrice  = K*expRT*Nd2n - S*Nd1n;

    const gamma  = normPDF(d1) / (S*sigma*sqrtT);
    const vega   = S*normPDF(d1)*sqrtT / 100; // per 1% IV move
    const thetaC = (-(S*normPDF(d1)*sigma)/(2*sqrtT) - r*K*expRT*Nd2) / 365;
    const thetaP = (-(S*normPDF(d1)*sigma)/(2*sqrtT) + r*K*expRT*Nd2n) / 365;
    const rhoC   = K*T*expRT*Nd2 / 100;       // per 1% rate move
    const rhoP   = -K*T*expRT*Nd2n / 100;

    return {
      call: { price: callPrice, delta: Nd1,     theta: thetaC, rho: rhoC, prob_itm: Nd2 },
      put:  { price: putPrice,  delta: Nd1-1,   theta: thetaP, rho: rhoP, prob_itm: Nd2n },
      gamma, vega, d1, d2
    };
  }

  let payoffChart = null;

  function renderResult(res, S, K, T, IV, r, contracts, type) {
    const el = document.getElementById('bsResult');
    if (!el || !res) return;
    const R = 100 * contracts;
    const fmt = (v, d=3) => v == null ? '—' : v.toFixed(d);
    const fmtMoney = v => v == null ? '—' : (v >= 0 ? '+' : '') + '$' + Math.abs(v*R).toFixed(2);

    const showCall = type !== 'put';
    const showPut  = type !== 'call';

    const greekRow = (name, callVal, putVal, desc, unit='') => {
      const showC = showCall ? `<td style="text-align:right;font-weight:700;color:var(--accent)">${fmt(callVal)}${unit}</td>` : '';
      const showP = showPut  ? `<td style="text-align:right;font-weight:700;color:var(--red)">${fmt(putVal)}${unit}</td>` : '';
      return `<tr><td style="color:var(--muted)">${name}</td>${showC}${showP}<td style="color:var(--muted);font-size:11px">${desc}</td></tr>`;
    };

    const callHeader = showCall ? '<th style="color:var(--accent)">Call</th>' : '';
    const putHeader  = showPut  ? '<th style="color:var(--red)">Put</th>'  : '';

    el.innerHTML = `
      <h3>Results — ${contracts} contract${contracts>1?'s':''} × 100 shares</h3>
      <div class="opts-greeks" style="margin-bottom:16px">
        ${showCall ? `<div class="greek-card"><div class="gname">Call Price</div><div class="gval" style="color:var(--accent)">$${fmt(res.call.price,2)}</div><div class="gdesc">Per share · Total: $${(res.call.price*R).toFixed(2)}</div></div>` : ''}
        ${showPut  ? `<div class="greek-card"><div class="gname">Put Price</div><div class="gval" style="color:var(--red)">$${fmt(res.put.price,2)}</div><div class="gdesc">Per share · Total: $${(res.put.price*R).toFixed(2)}</div></div>` : ''}
        <div class="greek-card"><div class="gname">Gamma</div><div class="gval">${fmt(res.gamma,4)}</div><div class="gdesc">Both calls &amp; puts</div></div>
        <div class="greek-card"><div class="gname">Vega</div><div class="gval">$${fmt(res.vega*R,2)}</div><div class="gdesc">Per 1% IV move (${contracts}c)</div></div>
      </div>
      <div class="table-wrap">
        <table style="width:100%;border-collapse:collapse;font-size:13px">
          <thead><tr><th style="text-align:left;color:var(--muted);font-size:10px;padding:6px 8px">Greek</th>${callHeader}${putHeader}<th style="text-align:left;color:var(--muted);font-size:10px">Meaning</th></tr></thead>
          <tbody style="font-size:12px">
            ${greekRow('Delta',       res.call.delta,    res.put.delta,   '$/$ move in underlying')}
            ${greekRow('Theta/day',   res.call.theta,    res.put.theta,   'Time decay per calendar day','$')}
            ${greekRow('Rho /1%rate', res.call.rho,      res.put.rho,     'Sensitivity to 1% rate change','$')}
            ${greekRow('Prob ITM',    res.call.prob_itm, res.put.prob_itm,'Approx. prob of expiring ITM','%')}
          </tbody>
        </table>
      </div>
      <div style="font-size:11px;color:var(--muted);margin-top:10px">
        d₁=${fmt(res.d1,4)} · d₂=${fmt(res.d2,4)} · T=${T.toFixed(4)} yr · IV=${(IV*100).toFixed(1)}% · r=${(r*100).toFixed(2)}%
      </div>`;

    // Payoff chart
    const sec = document.getElementById('optsPayoffSection');
    const sub = document.getElementById('optsPayoffSub');
    if (sec) sec.style.display = '';
    if (sub) sub.textContent = `At expiration with ${T > 0.0833 ? Math.round(T*365)+' days' : 'same-day expiry'} remaining. Breakevens shown.`;

    const range = S * 0.35;
    const prices = Array.from({length:80}, (_,i) => S - range + i * (range * 2 / 79));
    const callPayoffs = prices.map(p => Math.max(0, p - K) - res.call.price);
    const putPayoffs  = prices.map(p => Math.max(0, K - p) - res.put.price);

    const canvas = document.getElementById('optsPayoffChart');
    if (!canvas || typeof Chart === 'undefined') return;
    const ctx = canvas.getContext('2d');
    if (payoffChart) payoffChart.destroy();

    const datasets = [];
    if (showCall) datasets.push({ label:`Long Call (×${R}sh)`, data: callPayoffs.map(v=>v*R), borderColor:'#66b3ff', borderWidth:2, pointRadius:0, fill:false, tension:0 });
    if (showPut)  datasets.push({ label:`Long Put (×${R}sh)`,  data: putPayoffs.map(v=>v*R),  borderColor:'#ff9f7a', borderWidth:2, pointRadius:0, fill:false, tension:0 });

    payoffChart = new Chart(ctx, {
      type: 'line',
      data: { labels: prices.map(p => '$'+p.toFixed(1)), datasets },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: {
          legend: { display: true, labels: { color:'#7a84a8', font:{size:11} } },
          tooltip: { backgroundColor:'#1a2340', titleColor:'#eef2ff', bodyColor:'#7a84a8',
                     callbacks: { label: i => ` ${i.dataset.label}: ${i.parsed.y >= 0 ? '+' : ''}$${i.parsed.y.toFixed(2)}` } },
          annotation: {}
        },
        scales: {
          x: { ticks: { color:'#7a84a8', maxTicksLimit:10, font:{size:10} }, grid:{color:'rgba(255,255,255,0.03)'} },
          y: { ticks: { color:'#7a84a8', font:{size:11}, callback: v => (v>=0?'+':'')+'$'+v.toFixed(0) },
               grid: { color: 'rgba(255,255,255,0.04)' } }
        }
      }
    });
  }

  function calculate() {
    const S = parseFloat(document.getElementById('bs-S')?.value);
    const K = parseFloat(document.getElementById('bs-K')?.value);
    const days = parseFloat(document.getElementById('bs-T')?.value);
    const IVpct = parseFloat(document.getElementById('bs-IV')?.value);
    const rPct  = parseFloat(document.getElementById('bs-r')?.value);
    const type  = document.getElementById('bs-type')?.value || 'both';
    const contracts = parseInt(document.getElementById('bs-contracts')?.value) || 1;

    if ([S,K,days,IVpct,rPct].some(v => isNaN(v) || v <= 0)) {
      document.getElementById('bsResult').innerHTML = '<h3>Results</h3><p style="color:var(--red)">Please fill in all inputs with positive values.</p>';
      const sec = document.getElementById('optsPayoffSection');
      if (sec) sec.style.display = 'none';
      return;
    }

    const T = days / 365;
    const r = rPct / 100;
    const sigma = IVpct / 100;
    const res = bs(S, K, T, r, sigma);
    if (!res) { document.getElementById('bsResult').innerHTML = '<h3>Results</h3><p style="color:var(--red)">Calculation error — check inputs.</p>'; return; }
    renderResult(res, S, K, T, sigma, r, contracts, type);
  }

  document.getElementById('bsCalcBtn')?.addEventListener('click', calculate);
  document.getElementById('bs-S')?.addEventListener('keydown', e => { if (e.key === 'Enter') calculate(); });

  // Prefill hints from live snapshot
  const snap = window._snapshotCache;
  if (snap) {
    const vix = snap.indicators?.find(i => i.fred_id === 'VIXCLS');
    const ff  = snap.indicators?.find(i => i.fred_id === 'FEDFUNDS');
    if (vix?.latest_value != null) {
      document.getElementById('bs-vix-hint').textContent = vix.latest_value.toFixed(1) + '%';
      const ivEl = document.getElementById('bs-IV');
      if (ivEl && !ivEl.value) ivEl.value = vix.latest_value.toFixed(1);
    }
    if (ff?.latest_value != null) {
      document.getElementById('bs-ff-hint').textContent = ff.latest_value.toFixed(2) + '%';
      const rEl = document.getElementById('bs-r');
      if (rEl && !rEl.value) rEl.value = ff.latest_value.toFixed(2);
    }
  }

  // Prefill hints after snapshot loads too
  window.addEventListener('snapshotLoaded', () => {
    const s = window._snapshotCache;
    if (!s) return;
    const vix = s.indicators?.find(i => i.fred_id === 'VIXCLS');
    const ff  = s.indicators?.find(i => i.fred_id === 'FEDFUNDS');
    if (vix?.latest_value != null) {
      document.getElementById('bs-vix-hint').textContent = vix.latest_value.toFixed(1) + '%';
      const ivEl = document.getElementById('bs-IV');
      if (ivEl && !ivEl.value) ivEl.value = vix.latest_value.toFixed(1);
    }
    if (ff?.latest_value != null) {
      document.getElementById('bs-ff-hint').textContent = ff.latest_value.toFixed(2) + '%';
      const rEl = document.getElementById('bs-r');
      if (rEl && !rEl.value) rEl.value = ff.latest_value.toFixed(2);
    }
  });

  // Options chain chart loader
  function loadChain(symbol) {
    resetLazyTV('optsChainWrap');
    const wrap = document.getElementById('optsChainWrap');
    if (wrap) wrap.innerHTML = '';
    lazyTV('optsChainWrap', (el) => {
      const w = document.createElement('div');
      w.className = 'tradingview-widget-container__widget';
      w.style.height = '100%';
      const s = document.createElement('script');
      s.type  = 'text/javascript';
      s.src   = 'https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js';
      s.async = true;
      s.textContent = JSON.stringify({
        autosize: true,
        symbol: symbol || 'NASDAQ:SPY',
        interval: 'D',
        timezone: 'America/New_York',
        theme: document.documentElement.dataset.theme === 'light' ? 'light' : 'dark',
        style: '1',
        locale: 'en',
        withdateranges: true,
        range: '3M',
        hide_side_toolbar: false,
        allow_symbol_change: true,
        studies: ['RSI@tv-basicstudies','MACD@tv-basicstudies','Volume@tv-basicstudies'],
        show_popup_button: true,
        popup_width: '1000',
        popup_height: '650'
      });
      el.appendChild(w);
      el.appendChild(s);
    });
  }

  document.getElementById('optsChainLoadBtn')?.addEventListener('click', () => {
    const sym = document.getElementById('optsChainSym')?.value.trim();
    loadChain(sym || 'SPY');
  });
  loadChain('SPY');
}

// ─── FIXED INCOME ANALYTICS ──────────────────────────────────────────────────
function renderFixedIncome() {
  const snap = window._snapshotCache;
  if (!snap || !snap.indicators) return;
  const get = id => snap.indicators.find(i => i.fred_id === id);
  const fmt = v => v !== null && v !== undefined ? Number(v).toFixed(2) + '%' : '—';

  const ff    = get('FEDFUNDS');
  const t3m   = ff;
  const t10y3 = get('T10Y3M');
  const t10y2 = get('T10Y2Y');
  const tips  = get('T10YIE');
  const hy    = get('BAMLH0A0HYM2');
  const baa   = get('BAA10YM');
  const stl   = get('STLFSI3');

  const ffV  = ff?.latest_value ?? null;
  // T10Y3M = 10Y − 3M spread; FEDFUNDS ≈ 3M rate → approx 10Y yield
  const t10y = ffV !== null && t10y3?.latest_value != null
    ? (ffV + t10y3.latest_value) : null;
  // T10Y2Y = 10Y − 2Y spread → approx 2Y yield
  const t2y  = t10y !== null && t10y2?.latest_value != null
    ? (t10y - t10y2.latest_value) : null;

  const set = (id, val, color) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = val;
    if (color) el.style.color = color;
  };

  set('fi-fedfunds', ffV !== null ? ffV.toFixed(2) + '%' : '—');
  set('fi-10y', t10y !== null ? '~' + t10y.toFixed(2) + '%' : '—');
  set('fi-2y',  t2y  !== null ? '~' + t2y.toFixed(2)  + '%' : '—');

  const spread = t10y3?.latest_value ?? null;
  set('fi-t10y3m', spread !== null ? (spread >= 0 ? '+' : '') + spread.toFixed(2) + '%' : '—',
      spread !== null ? (spread < 0 ? 'var(--red)' : spread < 0.3 ? 'var(--yellow)' : 'var(--green)') : null);
  const subEl = document.getElementById('fi-t10y3m-sub');
  if (subEl && spread !== null) subEl.textContent = spread < 0 ? 'Inverted — recession warning' : spread < 0.3 ? 'Flat — watch closely' : 'Positive — not inverted';

  set('fi-tips', tips?.latest_value !== null ? (tips?.latest_value ?? '—') + '%' : '—',
      tips?.alert === 'RED' ? 'var(--red)' : tips?.alert === 'YELLOW' ? 'var(--yellow)' : null);

  const hyVal = hy?.latest_value ?? null;
  set('fi-hy', hyVal !== null ? hyVal.toFixed(2) + '%' : '—',
      hyVal !== null ? (hyVal >= 8 ? 'var(--red)' : hyVal >= 5 ? 'var(--yellow)' : 'var(--green)') : null);

  const baaVal = baa?.latest_value ?? null;
  set('fi-baa', baaVal !== null ? baaVal.toFixed(2) + '%' : '—',
      baaVal !== null ? (baaVal >= 4 ? 'var(--red)' : baaVal >= 2.5 ? 'var(--yellow)' : 'var(--green)') : null);

  const stlVal = stl?.latest_value ?? null;
  set('fi-stlfsi', stlVal !== null ? stlVal.toFixed(2) : '—',
      stlVal !== null ? (stlVal >= 1 ? 'var(--red)' : stlVal >= 0 ? 'var(--yellow)' : 'var(--green)') : null);

  // Populate DXY card from FRED DTWEXBGS (broad dollar)
  const dxy = snap.indicators?.find(i => i.fred_id === 'DTWEXBGS');
  if (dxy?.latest_value != null) {
    set('fx-dxy', dxy.latest_value.toFixed(1),
        dxy.latest_value > 115 ? 'var(--red)' : dxy.latest_value > 105 ? 'var(--yellow)' : 'var(--green)');
    document.querySelector('#fxPairsCards .fx-pair-card:last-child .chng').textContent =
      dxy.alert === 'RED' ? 'Strong — tightening global conditions' :
      dxy.alert === 'YELLOW' ? 'Above average — watch EM stress' : 'Normal range';
  }
}

// ─── MACRO SCENARIO STRESS TEST ───────────────────────────────────────────────
(function initScenarios() {
  const SCENARIOS = {
    current: null,
    'soft-landing': {
      label: 'Soft Landing',
      description: 'Inflation back to 2%, unemployment ≤4.5%, Fed cuts 100bps over 12 months, credit spreads tighten, GDP growth ~2%.',
      layerDeltas: { financial_lead: -15, labor: -8, inflation: -20, real_economy: -10, micro: -10, global: -8 },
      composite: null,
      alert: null,
      analogues: ['1994–95 Greenspan soft landing', '2019 Fed pivot']
    },
    'mild-recession': {
      label: 'Mild Recession',
      description: 'Unemployment +2pp to ~6.2%, GDP -1.5%, HY spreads 500bps, Fed cuts aggressively. 2001-style tech/capex-led recession.',
      layerDeltas: { financial_lead: +25, labor: +30, inflation: +5, real_economy: +20, micro: +20, global: +15 },
      composite: null,
      alert: null,
      analogues: ['2001 dot-com recession', '1990–91 recession']
    },
    'severe-recession': {
      label: 'Severe Recession',
      description: 'Unemployment +5pp to ~9.2%, GDP -4%, HY spreads >800bps, credit crunch, Fed cuts to ZLB. 2008-style financial shock.',
      layerDeltas: { financial_lead: +45, labor: +50, inflation: +10, real_economy: +40, micro: +35, global: +40 },
      composite: null,
      alert: null,
      analogues: ['2008–09 Great Financial Crisis', '1981–82 Volcker recession']
    },
    'stagflation': {
      label: 'Stagflation',
      description: 'Inflation 6%+, GDP stagnant or slightly negative, Fed forced to hold rates high despite slowing growth. Worst-of-both-worlds scenario.',
      layerDeltas: { financial_lead: +20, labor: +15, inflation: +40, real_economy: +10, micro: +15, global: +20 },
      composite: null,
      alert: null,
      analogues: ['1973–75 oil shock', '1979–80 stagflation']
    },
    boom: {
      label: 'Expansion / Boom',
      description: 'Strong growth 3%+, unemployment near cycle lows, benign credit conditions, equity bull market. Fed on hold or hiking gently.',
      layerDeltas: { financial_lead: -25, labor: -20, inflation: -5, real_economy: -20, micro: -20, global: -15 },
      composite: null,
      alert: null,
      analogues: ['1996–99 tech boom', '2017–18 synchronized global growth']
    }
  };

  function getAlert(score) {
    return score >= 60 ? 'RED' : score >= 30 ? 'YELLOW' : 'GREEN';
  }

  function renderScenarioResult(scenarioKey) {
    const snap = window._snapshotCache;
    const el   = document.getElementById('scenarioResult');
    if (!el) return;

    if (scenarioKey === 'current' || !snap) {
      const s = snap?.composite?.score ?? null;
      const a = snap?.composite?.alert ?? '—';
      el.innerHTML = s !== null ? `
        <div style="display:flex;gap:24px;align-items:center;flex-wrap:wrap">
          <div>
            <div style="font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.08em;margin-bottom:4px">Current Composite Score</div>
            <div style="font-size:40px;font-weight:900;color:${s>=60?'var(--red)':s>=30?'var(--yellow)':'var(--green)'}">${s}</div>
          </div>
          <div><span class="badge ${a}">${a}</span></div>
          <div style="font-size:13px;color:var(--muted);max-width:400px">This is the live composite score from FRED data. Select a scenario to see how conditions would shift.</div>
        </div>` : '<p style="color:var(--muted);font-size:13px">Load the Live Dashboard first to see the current baseline.</p>';
      return;
    }

    const sc = SCENARIOS[scenarioKey];
    if (!sc) return;

    const baseLayers = snap?.layers ?? {};
    const baseComposite = snap?.composite?.score ?? 50;
    const LAYER_W = { financial_lead: 0.27, labor: 0.22, inflation: 0.14, real_economy: 0.18, micro: 0.09, global: 0.10 };

    let scenarioComposite = 0;
    const layerRows = Object.entries(sc.layerDeltas).map(([key, delta]) => {
      const baseScore  = baseLayers[key]?.score ?? 50;
      const newScore   = Math.max(0, Math.min(100, baseScore + delta));
      const w          = LAYER_W[key] ?? 0;
      scenarioComposite += newScore * w;
      const sign = delta > 0 ? '+' : '';
      const dColor = delta > 0 ? 'var(--red)' : 'var(--green)';
      return `<tr>
        <td>${LAYER_NAMES[key] || key}</td>
        <td style="color:${baseScore>=60?'var(--red)':baseScore>=30?'var(--yellow)':'var(--green)'}">${baseScore}</td>
        <td style="color:${dColor};font-weight:700">${sign}${delta}</td>
        <td style="color:${newScore>=60?'var(--red)':newScore>=30?'var(--yellow)':'var(--green)'};font-weight:700">${Math.round(newScore)}</td>
      </tr>`;
    }).join('');

    scenarioComposite = Math.round(Math.max(0, Math.min(100, scenarioComposite)));
    const scenarioAlert = getAlert(scenarioComposite);
    const baseAlert = getAlert(baseComposite);

    el.innerHTML = `
      <div style="display:flex;gap:24px;align-items:flex-start;flex-wrap:wrap;margin-bottom:16px">
        <div>
          <div style="font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.08em;margin-bottom:4px">Baseline</div>
          <div style="font-size:36px;font-weight:900;color:${baseComposite>=60?'var(--red)':baseComposite>=30?'var(--yellow)':'var(--green)'}">${Math.round(baseComposite)}</div>
          <span class="badge ${baseAlert}">${baseAlert}</span>
        </div>
        <div style="font-size:28px;color:var(--muted);padding-top:20px">→</div>
        <div>
          <div style="font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.08em;margin-bottom:4px">${sc.label}</div>
          <div style="font-size:36px;font-weight:900;color:${scenarioComposite>=60?'var(--red)':scenarioComposite>=30?'var(--yellow)':'var(--green)'}">${scenarioComposite}</div>
          <span class="badge ${scenarioAlert}">${scenarioAlert}</span>
        </div>
        <div style="flex:1;min-width:240px">
          <div style="font-size:13px;color:var(--muted);line-height:1.6;margin-bottom:8px">${sc.description}</div>
          <div style="font-size:12px;color:var(--muted)">Historical analogues: ${sc.analogues.join(', ')}</div>
        </div>
      </div>
      <div class="table-wrap">
        <table class="alert-log-table">
          <thead><tr><th>Layer</th><th>Baseline</th><th>Scenario Δ</th><th>Scenario Score</th></tr></thead>
          <tbody>${layerRows}</tbody>
        </table>
      </div>
      <p style="font-size:11px;color:var(--muted);margin-top:10px">Scenario deltas are directional estimates based on historical recession analogue magnitudes. Not a forecast.</p>`;
  }

  document.addEventListener('click', e => {
    const card = e.target.closest('.scenario-card');
    if (!card) return;
    document.querySelectorAll('.scenario-card').forEach(c => c.classList.remove('active'));
    card.classList.add('active');
    renderScenarioResult(card.dataset.scenario);
  });

  // Re-render when snapshot loads
  window.addEventListener('snapshotLoaded', () => {
    const active = document.querySelector('.scenario-card.active');
    if (active) renderScenarioResult(active.dataset.scenario);
    renderFixedIncome();
    if (portfolioRendered) updatePortfolioMacro();
    if (watchlistRendered) updateWatchlistMacroContext();
  });
})();

// ─── WATCHLIST ────────────────────────────────────────────────────────────────
function initWatchlist() {
  const STORAGE_KEY = 'recession-tracker-watchlist-v2';

  function load() {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]'); } catch { return []; }
  }
  function save(list) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
  }
  function normalize(sym) {
    return sym.toUpperCase().trim().replace(/\s+/g,'');
  }

  function tvMiniChart(containerId, symbol, theme) {
    resetLazyTV(containerId);
    lazyTV(containerId, (el) => {
      const widget = document.createElement('div');
      widget.className = 'tradingview-widget-container__widget';
      widget.style.height = '100%';
      const script = document.createElement('script');
      script.type = 'text/javascript';
      script.src = 'https://s3.tradingview.com/external-embedding/embed-widget-mini-symbol-overview.js';
      script.async = true;
      script.textContent = JSON.stringify({
        symbol,
        width: '100%',
        height: 200,
        locale: 'en',
        dateRange: '12M',
        colorTheme: theme || 'dark',
        isTransparent: true,
        autosize: true,
        largeChartUrl: ''
      });
      el.appendChild(widget);
      el.appendChild(script);
    });
  }

  function renderWatchlist() {
    const list = load();
    const grid  = document.getElementById('wlGrid');
    const empty = document.getElementById('wlEmpty');
    if (!grid) return;
    grid.innerHTML = '';
    if (!list.length) {
      if (empty) empty.style.display = '';
      return;
    }
    if (empty) empty.style.display = 'none';

    list.forEach((item, idx) => {
      const cardId   = `wl-card-${idx}`;
      const chartId  = `wl-chart-${idx}`;
      const noteId   = `wl-note-${idx}`;
      const removeId = `wl-remove-${idx}`;

      const card = document.createElement('div');
      card.className = 'wl-card';
      card.id = cardId;
      card.innerHTML = `
        <div class="wl-card-header">
          <span class="wl-ticker">${escHtml(item.symbol)}</span>
          <button class="wl-remove-btn" id="${removeId}" title="Remove from watchlist">×</button>
        </div>
        <textarea class="wl-note-input" id="${noteId}" rows="1"
          placeholder="Add a note…">${escHtml(item.note || '')}</textarea>
        <div class="tv-wrap tradingview-widget-container" id="${chartId}" style="height:200px"></div>
      `;
      grid.appendChild(card);

      tvMiniChart(chartId, item.symbol, document.documentElement.dataset.theme === 'light' ? 'light' : 'dark');

      document.getElementById(removeId)?.addEventListener('click', () => {
        const updated = load().filter((_, i) => i !== idx);
        save(updated);
        renderWatchlist();
        updateCompareChart();
      });

      const noteEl = document.getElementById(noteId);
      if (noteEl) {
        noteEl.addEventListener('change', () => {
          const updated = load();
          if (updated[idx]) updated[idx].note = noteEl.value;
          save(updated);
        });
      }
    });

    updateCompareChart();
  }

  function updateCompareChart() {
    const list   = load();
    const chips  = document.getElementById('wlCompareChips');
    const tvWrap = document.getElementById('tv-wl-compare');
    if (!chips || !tvWrap) return;

    chips.innerHTML = list.map(item => `
      <span style="background:var(--panel-2);border:1px solid var(--border);border-radius:20px;
                   padding:4px 12px;font-size:12px;font-weight:600;">${escHtml(item.symbol)}</span>
    `).join('');

    if (!list.length) return;
    resetLazyTV('tv-wl-compare');
    tvWrap.innerHTML = '';
    lazyTV('tv-wl-compare', (el) => {
      const widget = document.createElement('div');
      widget.className = 'tradingview-widget-container__widget';
      widget.style.height = '100%';
      const script = document.createElement('script');
      script.type  = 'text/javascript';
      script.src   = 'https://s3.tradingview.com/external-embedding/embed-widget-symbol-overview.js';
      script.async = true;
      script.textContent = JSON.stringify({
        symbols: list.slice(0, 5).map(item => [item.symbol, `${item.symbol}|12M`]),
        chartOnly: false,
        width: '100%',
        height: 460,
        locale: 'en',
        colorTheme: document.documentElement.dataset.theme === 'light' ? 'light' : 'dark',
        autosize: true,
        showVolume: false,
        chartType: 'area',
        lineWidth: 2,
        dateRanges: ['1d|1','1m|30','3m|60','12m|1D','60m|1W','all|1M']
      });
      el.appendChild(widget);
      el.appendChild(script);
    });
  }

  // ── Screener widget ────────────────────────────────────────────────────────
  lazyTV('tv-screener', (screenerEl) => {
    const sw = document.createElement('div');
    sw.className = 'tradingview-widget-container__widget';
    sw.style.height = '100%';
    const ss = document.createElement('script');
    ss.type  = 'text/javascript';
    ss.src   = 'https://s3.tradingview.com/external-embedding/embed-widget-screener.js';
    ss.async = true;
    ss.textContent = JSON.stringify({
      width: '100%',
      height: 550,
      defaultColumn: 'overview',
      defaultScreen: 'most_capitalized',
      market: 'america',
      showToolbar: true,
      colorTheme: document.documentElement.dataset.theme === 'light' ? 'light' : 'dark',
      locale: 'en',
      isTransparent: true
    });
    screenerEl.appendChild(sw);
    screenerEl.appendChild(ss);
  });

  // ── Add ticker ─────────────────────────────────────────────────────────────
  function addTicker() {
    const input = document.getElementById('wlInput');
    if (!input) return;
    const sym = normalize(input.value);
    if (!sym) return;
    const list = load();
    if (list.find(x => x.symbol === sym)) {
      input.value = '';
      return;
    }
    list.push({ symbol: sym, note: '', addedAt: new Date().toISOString() });
    save(list);
    input.value = '';
    renderWatchlist();
  }

  document.getElementById('wlAddBtn')?.addEventListener('click', addTicker);
  document.getElementById('wlInput')?.addEventListener('keydown', e => {
    if (e.key === 'Enter') addTicker();
  });

  // ── Export CSV ─────────────────────────────────────────────────────────────
  document.getElementById('wlExportBtn')?.addEventListener('click', () => {
    const list = load();
    const rows = [['Symbol','Note','Added'].join(',')].concat(
      list.map(x => [x.symbol, `"${(x.note||'').replace(/"/g,'""')}"`, x.addedAt||''].join(','))
    );
    const a = document.createElement('a');
    a.href = 'data:text/csv,' + encodeURIComponent(rows.join('\n'));
    a.download = 'watchlist.csv';
    a.click();
  });

  renderWatchlist();
}

function updateWatchlistMacroContext() {
  const snap = window._snapshotCache;
  if (!snap) return;
  const score = snap.composite?.score ?? null;
  const alert = snap.composite?.alert ?? '—';
  const prob  = snap.composite?.recession_probability_12mo ?? null;

  const setEl = (id, v, col) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = v;
    if (col) el.style.color = col;
  };

  if (score !== null) {
    const col = score >= 60 ? 'var(--red)' : score >= 30 ? 'var(--yellow)' : 'var(--green)';
    setEl('wl-composite-score', score, col);
    setEl('wl-alert-state', alert,
      alert === 'RED' ? 'var(--red)' : alert === 'YELLOW' ? 'var(--yellow)' : 'var(--green)');
    setEl('wl-prob', prob !== null ? Math.round(prob * 100) + '%' : '—',
      prob !== null ? (prob >= 0.5 ? 'var(--red)' : prob >= 0.3 ? 'var(--yellow)' : 'var(--green)') : null);

    let pos, advice;
    if (score >= 60) {
      pos = 'Defensive'; advice = 'Composite is RED — historically consistent with elevated recession risk within 6–12 months. Consider reducing cyclical exposure (equities, high-yield, commodities) and rotating toward defensives (short-duration Treasuries, gold, consumer staples, utilities).';
    } else if (score >= 30) {
      pos = 'Cautious'; advice = 'Composite is YELLOW — watch mode. Risk is elevated but not recessionary. Consider trimming high-beta positions, ensuring adequate hedges, and reducing leverage. Monitor for further deterioration in labor and financial layers.';
    } else {
      pos = 'Risk-On'; advice = 'Composite is GREEN — low recession risk. Historical precedent supports holding risk assets (equities, high-yield). Continue monitoring for regime changes in the financial leading and labor layers, which tend to turn first.';
    }
    setEl('wl-positioning', pos);
    const advEl = document.getElementById('wlMacroAdvice');
    if (advEl) {
      advEl.textContent = advice;
      advEl.style.color = score >= 60 ? 'var(--red)' : score >= 30 ? 'var(--yellow)' : 'var(--green)';
    }
  }
}

// ─── THEME TOGGLE ─────────────────────────────────────────────────────────────
(function initTheme() {
  const saved = localStorage.getItem('theme') || 'dark';
  document.documentElement.setAttribute('data-theme', saved);
  const btn = document.getElementById('themeToggle');
  if (btn) btn.textContent = saved === 'light' ? '🌙' : '☀️';
})();

document.getElementById('themeToggle')?.addEventListener('click', () => {
  const current = document.documentElement.getAttribute('data-theme') || 'dark';
  const next = current === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  localStorage.setItem('theme', next);
  const btn = document.getElementById('themeToggle');
  if (btn) btn.textContent = next === 'light' ? '🌙' : '☀️';
});

// ─── PERMALINK COPY ───────────────────────────────────────────────────────────
document.getElementById('permalinkBtn')?.addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(location.href);
    const btn = document.getElementById('permalinkBtn');
    const orig = btn.textContent;
    btn.textContent = '✓ Copied!';
    setTimeout(() => { btn.textContent = orig; }, 2000);
  } catch {
    prompt('Copy this URL:', location.href);
  }
});

// ─── PRINT BUTTON ─────────────────────────────────────────────────────────────
document.getElementById('printBtn')?.addEventListener('click', () => window.print());

// ─── AI NARRATIVE ─────────────────────────────────────────────────────────────
let lastNarrativeAt = null;

async function loadNarrative(bust = '') {
  try {
    // Try current.json narrative first, fall back to narrative.json
    let data = null;
    const snap = window._snapshotCache;
    if (snap?.narrative) {
      data = snap.narrative;
    } else {
      data = await fetch(`data/narrative.json${bust}`).then(r => r.ok ? r.json() : null).catch(() => null);
    }

    // Render new structured AI Briefing card
    const briefingEl = document.getElementById('aiBriefingContent');
    const briefingTs = document.getElementById('aiBriefingTs');

    if (briefingEl) {
      if (!data || (!data.headline && !data.text)) {
        briefingEl.innerHTML = '<p class="ai-briefing-stale">AI briefing generates each weekday morning after data refresh.</p>';
      } else {
        // Check if stale (> 7 days)
        const ageDays = data.generated_at
          ? (Date.now() - new Date(data.generated_at).getTime()) / 86400000
          : 999;
        if (ageDays > 7) {
          briefingEl.innerHTML = '<p class="ai-briefing-stale">AI briefing generates each weekday morning after data refresh.</p>';
        } else if (data.headline) {
          // Structured format
          const risksHtml = Array.isArray(data.risks) && data.risks.length
            ? `<ul class="ai-briefing-risks">${data.risks.map(r =>
                `<li><span class="risk-icon">⚠</span><span>${r}</span></li>`
              ).join('')}</ul>`
            : '';
          const oppHtml = data.opportunity
            ? `<div class="ai-briefing-opportunity"><span class="risk-icon">✓</span><span>${data.opportunity}</span></div>`
            : '';
          const summaryHtml = data.summary
            ? `<div class="ai-briefing-summary">${data.summary}</div>`
            : '';
          briefingEl.innerHTML = `
            <div class="ai-briefing-headline">${data.headline}</div>
            ${risksHtml}
            ${oppHtml}
            ${summaryHtml}`;
        } else {
          // Legacy plain text format
          briefingEl.innerHTML = `<div class="ai-briefing-summary">${data.text.split('\n\n').map(p => `<p>${p.trim()}</p>`).join('')}</div>`;
        }
      }
      if (briefingTs && data?.generated_at) {
        const d = new Date(data.generated_at);
        briefingTs.textContent = `Generated ${d.toLocaleDateString('en-US', { month:'short', day:'numeric', year:'numeric' })} · Score ${data.score} · ${data.alert}`;
      }
    }

    if (data?.generated_at === lastNarrativeAt) return;
    if (data?.generated_at) lastNarrativeAt = data.generated_at;
  } catch {}
}

// ─── BOOT ─────────────────────────────────────────────────────────────────────
readUrlState();
const initialTab = new URLSearchParams(location.hash.slice(1)).get('tab') || 'live';
setTab(initialTab);
await refresh({ initial: true });
startPolling();

// ─── SUBSCRIBE FORM ───────────────────────────────────────────────────────────
(function initSubscribeForm() {
  const form = document.getElementById('subscribeForm');
  if (!form) return;
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('subEmail').value.trim();
    const phone = document.getElementById('subPhone').value.trim();
    const btn   = document.getElementById('subBtn');
    const status = document.getElementById('subStatus');

    // Check if Supabase endpoint is configured
    const endpoint = window.SUPABASE_SUBSCRIBE_URL;
    if (!endpoint) {
      status.textContent = 'ℹ Subscribe endpoint not configured — use the RSS feed above.';
      status.style.color = 'var(--yellow)';
      return;
    }

    btn.disabled = true;
    btn.textContent = 'Subscribing…';
    status.textContent = '';
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, phone: phone || null })
      });
      if (res.ok) {
        status.textContent = '✓ Subscribed! Check your email to confirm.';
        status.style.color = 'var(--green)';
        form.reset();
      } else {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `HTTP ${res.status}`);
      }
    } catch (err) {
      status.textContent = `✗ ${err.message}`;
      status.style.color = 'var(--red)';
    } finally {
      btn.disabled = false;
      btn.textContent = 'Subscribe →';
    }
  });
})();

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}
