// Geopolitical stress flagger. Pure functions, no I/O.
//
// IMPORTANT framing: this is NOT the news-based Caldara–Iacoviello Geopolitical
// Risk (GPR) index — that series is published as CSV from the authors' site, not
// the FRED API this app runs on. Instead this flags geopolitical/event stress
// through the financial channels such shocks actually transmit through, all of
// which are already fetched: equity volatility (VIX), credit risk (high-yield
// spread), and safe-haven flows (a surging broad dollar). When all three fire at
// once the market is pricing an acute shock. It is reported as a SEPARATE overlay
// and is deliberately NOT folded into the recession composite, because
// geopolitical stress is episodic and does not always lead to recession.

function clamp01(x) { return Math.max(0, Math.min(1, x)); }

// Each channel maps a raw level to a stress sub-score in [0,1].
// Calibration points are documented inline; a sub-score ≥ 0.5 = "firing".
const CHANNELS = [
  {
    fred_id: 'VIXCLS', name: 'Equity volatility (VIX)',
    // calm ~18, acute ~40
    sub: v => clamp01((v - 18) / 22),
    fmt: v => v.toFixed(1)
  },
  {
    fred_id: 'BAMLH0A0HYM2', name: 'Credit risk (HY spread)',
    // calm ~3.5%, acute ~8%
    sub: v => clamp01((v - 3.5) / 4.5),
    fmt: v => v.toFixed(2) + '%'
  },
  {
    fred_id: 'DTWEXBGS', name: 'Safe-haven USD',
    // z-score of the broad dollar; only a strong-dollar surge counts as stress
    sub: (v, ind) => {
      if (ind?.norm_mean == null || !ind?.norm_std) return null;
      const z = (v - ind.norm_mean) / ind.norm_std;
      return clamp01(z / 2.5); // z = 2.5σ above mean → full stress
    },
    fmt: v => v.toFixed(1)
  }
];

// Relative weights (renormalized over channels with data). Volatility and credit
// are the primary, fastest transmission channels for geopolitical shocks.
const WEIGHTS = { VIXCLS: 0.45, BAMLH0A0HYM2: 0.35, DTWEXBGS: 0.20 };

export function flagFor(score) {
  if (score >= 66) return 'ACUTE';
  if (score >= 33) return 'ELEVATED';
  return 'CALM';
}

/**
 * Compute the geopolitical stress overlay from normalized indicators.
 * @param indicators Array of normalized indicators (need fred_id, latest.value,
 *                   and for DTWEXBGS norm_mean/norm_std).
 * @returns { score, flag, channels: [...], firing: [...], note } or null if no data.
 */
export function computeGeopoliticalFlag(indicators) {
  const byId = new Map((indicators || []).map(i => [i.fred_id, i]));
  const channels = [];
  let weighted = 0, weightSum = 0;

  for (const ch of CHANNELS) {
    const ind = byId.get(ch.fred_id);
    const val = ind?.latest?.value;
    if (val == null || !Number.isFinite(val)) continue;
    const sub = ch.sub(val, ind);
    if (sub == null) continue;
    const w = WEIGHTS[ch.fred_id] ?? 0;
    weighted  += sub * w;
    weightSum += w;
    channels.push({
      fred_id: ch.fred_id,
      name: ch.name,
      value: val,
      display: ch.fmt(val),
      sub_score: Number((sub * 100).toFixed(1)),
      firing: sub >= 0.5
    });
  }

  if (!weightSum) return null;

  const score = Number(((weighted / weightSum) * 100).toFixed(1));
  const flag  = flagFor(score);
  const firing = channels.filter(c => c.firing).map(c => c.name);

  return {
    score,
    flag,
    channels,
    firing,
    note: 'Market-transmitted proxy (VIX + credit + safe-haven USD), not the news-based GPR index. Separate from the recession composite.'
  };
}
