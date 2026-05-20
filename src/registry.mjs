// Indicator registry. Each entry defines a FRED series and how to score it.
//
// Fields:
//   name         Human-readable label
//   fred_id      FRED series identifier
//   layer        One of: financial_lead | labor | inflation | real_economy | micro
//   frequency    daily | weekly | monthly | quarterly
//   direction    direct (higher = good)  |  inverse (higher = bad)
//   weight       Within-layer weight (layer weights sum within layer)
//   threshold    Numeric trigger level, or null for z-score normalization
//   category     macro | micro
//   description  Human note

export const REGISTRY = [
  // ─── Financial leading indicators ─────────────────────────────────────
  { name: "Yield Curve 10Y-3M", fred_id: "T10Y3M", layer: "financial_lead", frequency: "daily", direction: "direct", weight: 0.30, threshold: 0.0, category: "macro", description: "Spread between 10Y and 3M Treasury yields. Inversion historically precedes recession." },
  { name: "Yield Curve 10Y-2Y", fred_id: "T10Y2Y", layer: "financial_lead", frequency: "daily", direction: "direct", weight: 0.15, threshold: 0.0, category: "macro", description: "Spread between 10Y and 2Y Treasury yields. Classic recession signal." },
  { name: "Baa-10Y Credit Spread", fred_id: "BAA10YM", layer: "financial_lead", frequency: "monthly", direction: "inverse", weight: 0.20, threshold: 3.0, category: "macro", description: "Corporate spread as a credit-stress proxy. Threshold calibrated to widening regimes." },
  { name: "Chicago Fed NFCI", fred_id: "NFCI", layer: "financial_lead", frequency: "weekly", direction: "inverse", weight: 0.15, threshold: 0.5, category: "macro", description: "Broad financial conditions index. Positive = tighter than average." },
  { name: "VIX (Equity Vol)", fred_id: "VIXCLS", layer: "financial_lead", frequency: "daily", direction: "inverse", weight: 0.10, threshold: 25.0, category: "macro", description: "CBOE volatility index. Sustained levels above 25 indicate market stress." },
  { name: "High Yield Spread", fred_id: "BAMLH0A0HYM2", layer: "financial_lead", frequency: "daily", direction: "inverse", weight: 0.10, threshold: 5.0, category: "macro", description: "ICE BofA US high-yield option-adjusted spread. Above 5% = elevated credit risk." },

  // ─── Labor ─────────────────────────────────────────────────────────────
  { name: "Unemployment Rate", fred_id: "UNRATE", layer: "labor", frequency: "monthly", direction: "inverse", weight: 0.20, threshold: null, category: "macro", description: "Headline U3 unemployment. Z-score normalized." },
  { name: "Sahm Rule (Real-Time)", fred_id: "SAHMREALTIME", layer: "labor", frequency: "monthly", direction: "inverse", weight: 0.25, threshold: 0.5, category: "macro", description: "Confirmatory (not leading): triggers at 0.5 when unemployment 3mo avg rises 0.5pp above its 12mo low." },
  { name: "Initial Jobless Claims", fred_id: "ICSA", layer: "labor", frequency: "weekly", direction: "inverse", weight: 0.20, threshold: 300000, category: "macro", description: "Fast labor deterioration signal. Threshold = sustained recessionary level." },
  { name: "Payroll Employment", fred_id: "PAYEMS", layer: "labor", frequency: "monthly", direction: "direct", weight: 0.20, threshold: null, category: "macro", description: "Nonfarm payroll trend. Z-score normalized." },
  { name: "JOLTS Quits Rate", fred_id: "JTSQUR", layer: "labor", frequency: "monthly", direction: "direct", weight: 0.15, threshold: 2.0, category: "micro", description: "Worker confidence proxy. Falling quits = labor market cooling." },

  // ─── Inflation ─────────────────────────────────────────────────────────
  { name: "CPI All Items YoY", fred_id: "CPIAUCSL", layer: "inflation", frequency: "monthly", direction: "inverse", weight: 0.20, threshold: null, category: "macro", description: "Headline CPI. Z-score normalized over trailing window." },
  { name: "Core CPI YoY", fred_id: "CPILFESL", layer: "inflation", frequency: "monthly", direction: "inverse", weight: 0.20, threshold: null, category: "macro", description: "Core CPI. Z-score normalized." },
  { name: "PCE Price Index", fred_id: "PCEPI", layer: "inflation", frequency: "monthly", direction: "inverse", weight: 0.20, threshold: null, category: "macro", description: "Fed's preferred inflation measure. Z-score normalized." },
  { name: "Fed Funds Rate", fred_id: "FEDFUNDS", layer: "inflation", frequency: "monthly", direction: "inverse", weight: 0.20, threshold: null, category: "macro", description: "Policy rate level. Z-score normalized." },
  { name: "Avg Hourly Earnings", fred_id: "CES0500000003", layer: "inflation", frequency: "monthly", direction: "inverse", weight: 0.20, threshold: null, category: "micro", description: "Wage pressure signal. Z-score normalized." },

  // ─── Real economy ──────────────────────────────────────────────────────
  { name: "Real GDP", fred_id: "GDPC1", layer: "real_economy", frequency: "quarterly", direction: "direct", weight: 0.25, threshold: null, category: "macro", description: "Real output. Z-score on QoQ change." },
  { name: "Industrial Production", fred_id: "INDPRO", layer: "real_economy", frequency: "monthly", direction: "direct", weight: 0.20, threshold: null, category: "macro", description: "Goods-sector output. Z-score normalized." },
  { name: "Retail Sales", fred_id: "RSAFS", layer: "real_economy", frequency: "monthly", direction: "direct", weight: 0.20, threshold: null, category: "macro", description: "Consumer demand. Z-score normalized." },
  { name: "Real Income ex Transfers", fred_id: "W875RX1", layer: "real_economy", frequency: "monthly", direction: "direct", weight: 0.20, threshold: null, category: "macro", description: "Earned household income. NBER coincident series." },
  { name: "Housing Starts", fred_id: "HOUST", layer: "real_economy", frequency: "monthly", direction: "direct", weight: 0.15, threshold: null, category: "micro", description: "Rate-sensitive leading housing signal." },

  // ─── Micro ─────────────────────────────────────────────────────────────
  { name: "Manufacturers New Orders", fred_id: "NEWORDER", layer: "micro", frequency: "monthly", direction: "direct", weight: 0.20, threshold: null, category: "micro", description: "Census new orders ex-defense. Goods-sector proxy (not ISM PMI; that's gated)." },
  { name: "Bank Lending Standards (C&I)", fred_id: "DRTSCILM", layer: "micro", frequency: "quarterly", direction: "inverse", weight: 0.20, threshold: 20.0, category: "micro", description: "Net % of banks tightening C&I loan standards. Survey." },
  { name: "Consumer Credit Delinquency", fred_id: "DRCCLACBS", layer: "micro", frequency: "quarterly", direction: "inverse", weight: 0.20, threshold: 3.0, category: "micro", description: "Credit card delinquency rate. Household stress." },
  { name: "Small Business Optimism", fred_id: "NFIBOPTMI", layer: "micro", frequency: "monthly", direction: "direct", weight: 0.20, threshold: 95.0, category: "micro", description: "NFIB Small Business Optimism Index." },
  { name: "JOLTS Job Openings", fred_id: "JTSJOL", layer: "micro", frequency: "monthly", direction: "direct", weight: 0.20, threshold: 5500, category: "micro", description: "Employer demand. FRED reports in thousands; 5500 = 5.5M openings, recessionary trough range." },

  // ─── Global / International ─────────────────────────────────────────────────
  { name: "OECD Leading Indicator", fred_id: "OECDLOLITOAASTSAM", layer: "global", frequency: "monthly", direction: "direct", weight: 0.30, threshold: 100.0, category: "macro", description: "OECD Composite Leading Indicator, total OECD area. Below 100 signals below-trend global growth." },
  { name: "Euro Area Yield Curve",  fred_id: "EURYLDCRV",         layer: "global", frequency: "monthly", direction: "direct", weight: 0.25, threshold: 0.0,   category: "macro", description: "Derived: Euro area 10Y govt yield minus 3M rate. Inversion = EU recession signal." },
  { name: "Euro Area Unemployment", fred_id: "LRHUTTTTEZM156S",   layer: "global", frequency: "monthly", direction: "inverse", weight: 0.25, threshold: null,  category: "macro", description: "Euro area harmonized unemployment rate. Z-score normalized." },
  { name: "Euro Area Real GDP",     fred_id: "NAEXKP01EZQ661S",   layer: "global", frequency: "quarterly", direction: "direct", weight: 0.20, threshold: null, category: "macro", description: "Euro area real GDP index. Z-score normalized." }
];

// Global layer weight = 0.10; existing 5 layers scaled to 0.90 proportionally.
export const LAYER_WEIGHTS = {
  financial_lead: 0.27,
  labor:          0.22,
  inflation:      0.14,
  real_economy:   0.18,
  micro:          0.09,
  global:         0.10
};

export function getFredIds() {
  return REGISTRY.map(x => x.fred_id);
}

export function getIndicatorsByLayer(layer) {
  return REGISTRY.filter(x => x.layer === layer);
}

export function validateLayerWeights() {
  const sums = {};
  for (const item of REGISTRY) sums[item.layer] = (sums[item.layer] || 0) + item.weight;
  const result = { valid: true, layers: {} };
  for (const [layer, sum] of Object.entries(sums)) {
    const rounded = Number(sum.toFixed(4));
    result.layers[layer] = { sum: rounded, ok: Math.abs(rounded - 1.0) < 0.01 };
    if (!result.layers[layer].ok) result.valid = false;
  }
  return result;
}

export function validateCompositeWeights() {
  const sum = Object.values(LAYER_WEIGHTS).reduce((a, b) => a + b, 0);
  return { sum: Number(sum.toFixed(4)), ok: Math.abs(sum - 1.0) < 0.01 };
}
