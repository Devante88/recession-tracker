// Geopolitical stress flagger. Pure functions, no I/O.
//
// Two complementary signals:
//
// 1. GPR (authoritative): the Caldara–Iacoviello Geopolitical Risk index — a
//    news-based count of geopolitical threats/events, long-run average ≈ 100.
//    It is published as .xls/.dta from the authors' site (not the FRED API), so
//    scripts/gpr.mjs ingests it from a configurable CSV URL and writes gpr.json.
//    When a GPR reading is available it is the HEADLINE flag.
//
// 2. Market-transmission proxy (always available): geopolitical shocks hit the
//    economy through equity volatility (VIX), credit risk (HY spread), and
//    safe-haven dollar flows (broad USD surge). When GPR is unavailable this is
//    the headline; when GPR is present it serves as CORROBORATION — is the
//    market actually pricing the geopolitical news, or not?
//
// Reported as a SEPARATE overlay, deliberately NOT folded into the recession
// composite, because geopolitical stress is episodic and does not reliably lead
// to recession.

function clamp01(x) { return Math.max(0, Math.min(1, x)); }

// ── Market-transmission proxy ────────────────────────────────────────────────
const CHANNELS = [
  { fred_id: 'VIXCLS',       name: 'Equity volatility (VIX)', sub: v => clamp01((v - 18) / 22), fmt: v => v.toFixed(1) },          // calm ~18, acute ~40
  { fred_id: 'BAMLH0A0HYM2', name: 'Credit risk (HY spread)', sub: v => clamp01((v - 3.5) / 4.5), fmt: v => v.toFixed(2) + '%' }, // calm ~3.5%, acute ~8%
  { fred_id: 'DTWEXBGS',     name: 'Safe-haven USD',          sub: (v, ind) => {                                                  // z-score; only strong-dollar surge = stress
      if (ind?.norm_mean == null || !ind?.norm_std) return null;
      return clamp01(((v - ind.norm_mean) / ind.norm_std) / 2.5);
    }, fmt: v => v.toFixed(1) }
];
const WEIGHTS = { VIXCLS: 0.45, BAMLH0A0HYM2: 0.35, DTWEXBGS: 0.20 };

export function flagFor(score) {
  if (score >= 66) return 'ACUTE';
  if (score >= 33) return 'ELEVATED';
  return 'CALM';
}

export function marketStress(indicators) {
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
    weighted += sub * w; weightSum += w;
    channels.push({ fred_id: ch.fred_id, name: ch.name, value: val, display: ch.fmt(val), sub_score: Number((sub * 100).toFixed(1)), firing: sub >= 0.5 });
  }
  if (!weightSum) return null;
  const score = Number(((weighted / weightSum) * 100).toFixed(1));
  return { score, flag: flagFor(score), channels, firing: channels.filter(c => c.firing).map(c => c.name) };
}

// ── Real GPR index ───────────────────────────────────────────────────────────
// Band the raw index against documented anchors: long-run avg ≈ 100; regional
// conflict noise ~120–180; major-event territory ≥ 200 (e.g. Russia–Ukraine
// Feb 2022 ≈ 230, Iraq war ≈ 350, 9/11 ≈ 500).
export function gprFlagFor(value) {
  if (value >= 200) return 'ACUTE';
  if (value >= 115) return 'ELEVATED';
  return 'CALM';
}

export function gprReading(gpr) {
  const value = gpr?.latest;
  if (value == null || !Number.isFinite(value)) return null;
  // 0–100 stress score: 60 → 0, 240 → 100.
  const score = Number((clamp01((value - 60) / 180) * 100).toFixed(1));
  return { value: Number(value.toFixed(1)), date: gpr.date ?? null, score, flag: gprFlagFor(value) };
}

// ── Combined overlay ─────────────────────────────────────────────────────────
export function computeGeopoliticalFlag(indicators, gpr = null) {
  const market = marketStress(indicators);
  const gprRead = gprReading(gpr);
  if (!market && !gprRead) return null;

  const headline = gprRead || market;
  const source   = gprRead ? 'GPR' : 'market-proxy';

  let corroboration = null;
  if (gprRead && market) {
    const gprStressed    = gprRead.flag !== 'CALM';
    const marketStressed = market.flag !== 'CALM';
    corroboration = gprStressed && marketStressed ? 'confirmed'
      : gprStressed && !marketStressed ? 'news-leads-market'
      : !gprStressed && marketStressed ? 'market-stress-not-geopolitical'
      : 'calm';
  }

  return {
    score: headline.score,
    flag: headline.flag,
    source,
    gpr: gprRead,
    market,
    corroboration,
    note: gprRead
      ? 'Headline = Caldara–Iacoviello GPR index (news-based). Market channels (VIX + credit + USD) shown as corroboration. Separate from the recession composite.'
      : 'Market-transmitted proxy (VIX + credit + safe-haven USD); GPR index not available. Separate from the recession composite.'
  };
}
