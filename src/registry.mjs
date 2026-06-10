// Indicator registry. Each entry defines a FRED series and how to score it.
//
// Fields:
//   name         Human-readable label
//   fred_id      FRED series identifier
//   layer        One of: financial_lead | labor | inflation | real_economy | micro | global
//   frequency    daily | weekly | monthly | quarterly
//   direction    direct (higher = good)  |  inverse (higher = bad)
//   weight       Within-layer weight (weights sum to 1.0 within each layer)
//   threshold    Numeric trigger level, or null for z-score normalization
//   category     macro | micro
//   description  Human note

export const REGISTRY = [
  // ─── Financial leading indicators ─────────────────────────────────────
  // Weights rescaled after adding CFNAI (0.08) and USEPUINDXD (0.07);
  // existing indicators scaled by 0.85 to keep within-layer sum at 1.0.
  { name: "Yield Curve 10Y-3M",    fred_id: "T10Y3M",        layer: "financial_lead", frequency: "daily",   direction: "direct",  weight: 0.1848, threshold: 0.0,  category: "macro", description: "Spread between 10Y and 3M Treasury yields. Inversion historically precedes recession by 6–18 months." },
  { name: "Yield Curve 10Y-2Y",    fred_id: "T10Y2Y",        layer: "financial_lead", frequency: "daily",   direction: "direct",  weight: 0.0924, threshold: 0.0,  category: "macro", description: "Spread between 10Y and 2Y Treasury yields. Classic recession signal." },
  { name: "Baa-10Y Credit Spread", fred_id: "BAA10YM",       layer: "financial_lead", frequency: "monthly", direction: "inverse", weight: 0.1232, threshold: 3.0,  category: "macro", description: "Corporate spread as a credit-stress proxy. Threshold calibrated to widening regimes." },
  { name: "Chicago Fed NFCI",      fred_id: "NFCI",          layer: "financial_lead", frequency: "weekly",  direction: "inverse", weight: 0.0924, threshold: 0.5,  category: "macro", description: "Broad financial conditions index. Positive = tighter than average." },
  { name: "VIX (Equity Vol)",      fred_id: "VIXCLS",        layer: "financial_lead", frequency: "daily",   direction: "inverse", weight: 0.0616, threshold: 25.0, category: "macro", description: "CBOE volatility index. Sustained levels above 25 indicate market stress." },
  { name: "High Yield Spread",     fred_id: "BAMLH0A0HYM2",  layer: "financial_lead", frequency: "daily",   direction: "inverse", weight: 0.0616, threshold: 5.0,  category: "macro", description: "ICE BofA US high-yield option-adjusted spread. Above 5% = elevated credit risk." },
  { name: "10Y TIPS Breakeven",    fred_id: "T10YIE",        layer: "financial_lead", frequency: "daily",   direction: "direct",  weight: 0.0599, threshold: null, category: "macro", description: "Market-implied 10-year inflation expectations; collapse signals deflation/growth fears." },
  { name: "Fed Balance Sheet",     fred_id: "WALCL",         layer: "financial_lead", frequency: "weekly",  direction: "direct",  weight: 0.0599, threshold: null, category: "macro", description: "Federal Reserve total assets; QT (shrinking) tightens financial conditions." },
  { name: "M2 Money Supply",       fred_id: "M2SL",          layer: "financial_lead", frequency: "monthly", direction: "direct",  weight: 0.0547, threshold: null, category: "macro", description: "M2 money supply; sharp deceleration signals tightening liquidity and recession risk." },
  { name: "St. Louis Financial Stress", fred_id: "STLFSI4",  layer: "financial_lead", frequency: "weekly",  direction: "inverse", weight: 0.0595, threshold: null, category: "macro", description: "St. Louis Fed Financial Stress Index (v4; replaces discontinued STLFSI3). Zero = average; above zero = above-average stress." },
  { name: "Chicago Fed Activity Index", fred_id: "CFNAI",    layer: "financial_lead", frequency: "monthly", direction: "direct",  weight: 0.0800, threshold: null, category: "macro", description: "Chicago Fed National Activity Index (replaces discontinued USSLIND). Weighted average of 85 indicators; sustained readings below zero signal below-trend growth, below -0.7 historically coincides with recession." },
  { name: "Economic Policy Uncertainty", fred_id: "USEPUINDXD", layer: "financial_lead", frequency: "daily", direction: "inverse", weight: 0.0700, threshold: null, category: "macro", description: "US Economic Policy Uncertainty Index. Elevated uncertainty suppresses investment and hiring; spikes precede economic slowdowns." },

  // ─── Labor ─────────────────────────────────────────────────────────────
  { name: "Unemployment Rate",     fred_id: "UNRATE",        layer: "labor", frequency: "monthly", direction: "inverse", weight: 0.1584, threshold: null, category: "macro", description: "Headline U3 unemployment. Z-score normalized." },
  { name: "Sahm Rule (Real-Time)", fred_id: "SAHMREALTIME",  layer: "labor", frequency: "monthly", direction: "inverse", weight: 0.1980, threshold: 0.5,  category: "macro", description: "Triggers at 0.5 when unemployment 3mo avg rises 0.5pp above its 12mo low. Historically coincident with recession start." },
  { name: "Initial Jobless Claims",fred_id: "ICSA",          layer: "labor", frequency: "weekly",  direction: "inverse", weight: 0.1584, threshold: 300000, category: "macro", description: "Fast labor deterioration signal. Threshold = sustained recessionary level." },
  { name: "Payroll Employment",    fred_id: "PAYEMS",        layer: "labor", frequency: "monthly", direction: "direct",  weight: 0.1584, threshold: null, category: "macro", description: "Nonfarm payroll trend. Z-score normalized." },
  { name: "JOLTS Quits Rate",      fred_id: "JTSQUR",        layer: "labor", frequency: "monthly", direction: "direct",  weight: 0.1188, threshold: 2.0,  category: "micro", description: "Worker confidence proxy. Falling quits = labor market cooling." },
  { name: "UMich Consumer Sentiment", fred_id: "UMCSENT",   layer: "labor", frequency: "monthly", direction: "direct",  weight: 0.1080, threshold: null, category: "macro", description: "University of Michigan Consumer Sentiment Index; forward-looking consumer health." },
  { name: "Labor Force Participation Rate", fred_id: "CIVPART", layer: "labor", frequency: "monthly", direction: "direct", weight: 0.1000, threshold: null, category: "macro", description: "Civilian labor force participation rate; declining LFPR signals discouraged workers exiting." },

  // ─── Inflation ─────────────────────────────────────────────────────────
  { name: "CPI All Items YoY",     fred_id: "CPIAUCSL",      layer: "inflation", frequency: "monthly", direction: "inverse", weight: 0.20, threshold: null, category: "macro", description: "Headline CPI. Z-score normalized over trailing window." },
  { name: "Core CPI YoY",          fred_id: "CPILFESL",      layer: "inflation", frequency: "monthly", direction: "inverse", weight: 0.20, threshold: null, category: "macro", description: "Core CPI (ex food/energy). Z-score normalized." },
  { name: "PCE Price Index",       fred_id: "PCEPI",         layer: "inflation", frequency: "monthly", direction: "inverse", weight: 0.20, threshold: null, category: "macro", description: "Fed's preferred inflation measure. Z-score normalized." },
  { name: "Fed Funds Rate",        fred_id: "FEDFUNDS",      layer: "inflation", frequency: "monthly", direction: "inverse", weight: 0.20, threshold: null, category: "macro", description: "Policy rate level. Z-score normalized." },
  { name: "Avg Hourly Earnings",   fred_id: "CES0500000003", layer: "inflation", frequency: "monthly", direction: "inverse", weight: 0.20, threshold: null, category: "micro", description: "Wage pressure signal. Z-score normalized." },

  // ─── Real economy ──────────────────────────────────────────────────────
  // Added MORTGAGE30US at 0.08; rescaled others by 0.92.
  { name: "Real GDP",              fred_id: "GDPC1",         layer: "real_economy", frequency: "quarterly", direction: "direct",  weight: 0.1266, threshold: null, category: "macro", description: "Real output. Z-score on QoQ change." },
  { name: "Industrial Production", fred_id: "INDPRO",        layer: "real_economy", frequency: "monthly",   direction: "direct",  weight: 0.1025, threshold: null, category: "macro", description: "Goods-sector output. Z-score normalized." },
  { name: "Retail Sales",          fred_id: "RSAFS",         layer: "real_economy", frequency: "monthly",   direction: "direct",  weight: 0.1025, threshold: null, category: "macro", description: "Consumer demand. Z-score normalized." },
  { name: "Real Income ex Transfers", fred_id: "W875RX1",    layer: "real_economy", frequency: "monthly",   direction: "direct",  weight: 0.1025, threshold: null, category: "macro", description: "Earned household income. NBER coincident series." },
  { name: "Housing Starts",        fred_id: "HOUST",         layer: "real_economy", frequency: "monthly",   direction: "direct",  weight: 0.0784, threshold: null, category: "micro", description: "Rate-sensitive leading housing signal." },
  { name: "Weekly Economic Index", fred_id: "WEI",           layer: "real_economy", frequency: "weekly",    direction: "direct",  weight: 0.0904, threshold: 0,   category: "macro", description: "NY Fed Weekly Economic Index; 10 daily/weekly indicators scaled to match YoY GDP growth." },
  { name: "Personal Saving Rate",  fred_id: "PSAVERT",       layer: "real_economy", frequency: "monthly",   direction: "direct",  weight: 0.0753, threshold: null, category: "macro", description: "Personal saving as % of disposable income; higher = more consumer buffer." },
  { name: "Case-Shiller Home Price Index", fred_id: "CSUSHPISA", layer: "real_economy", frequency: "monthly", direction: "direct", weight: 0.0753, threshold: null, category: "macro", description: "S&P/Case-Shiller national home price index; housing wealth leads consumer spending 6–12 months." },
  { name: "Capacity Utilization",  fred_id: "TCU",           layer: "real_economy", frequency: "monthly",   direction: "direct",  weight: 0.0837, threshold: null, category: "macro", description: "Total industry capacity utilization; below 78% signals slowing investment and industrial contraction." },
  { name: "Building Permits",      fred_id: "PERMIT",        layer: "real_economy", frequency: "monthly",   direction: "direct",  weight: 0.0828, threshold: null, category: "micro", description: "New privately-owned housing units authorized. Leads construction by 1–2 months; sharp declines precede recessions." },
  { name: "30-Year Fixed Mortgage Rate", fred_id: "MORTGAGE30US", layer: "real_economy", frequency: "weekly", direction: "inverse", weight: 0.0800, threshold: null, category: "macro", description: "30-year fixed mortgage rate; rising rates directly reduce housing affordability and construction, leading the real economy by 6–12 months." },

  // ─── Micro ─────────────────────────────────────────────────────────────
  { name: "Manufacturers New Orders", fred_id: "NEWORDER",  layer: "micro", frequency: "monthly",   direction: "direct",  weight: 0.2118, threshold: null, category: "micro", description: "Census new orders for nondefense capital goods ex aircraft. Goods-sector demand proxy." },
  { name: "Bank Lending Standards (C&I)", fred_id: "DRTSCILM", layer: "micro", frequency: "quarterly", direction: "inverse", weight: 0.2118, threshold: 20.0, category: "micro", description: "Net % of banks tightening C&I loan standards (Senior Loan Officer Survey)." },
  { name: "Consumer Credit Delinquency", fred_id: "DRCCLACBS", layer: "micro", frequency: "quarterly", direction: "inverse", weight: 0.2118, threshold: 3.0,  category: "micro", description: "Credit card delinquency rate at all commercial banks. Household stress gauge." },
  { name: "JOLTS Job Openings",    fred_id: "JTSJOL",        layer: "micro", frequency: "monthly",   direction: "direct",  weight: 0.2118, threshold: 5500, category: "micro", description: "Employer demand (FRED: thousands). 5,500 = 5.5M openings, near recessionary trough." },
  { name: "PPI All Commodities",   fred_id: "PPIACO",        layer: "micro", frequency: "monthly",   direction: "inverse", weight: 0.1528, threshold: null, category: "macro", description: "Producer Price Index for all commodities; rising PPI compresses margins and signals cost-push stress." },

  // ─── Global / International ─────────────────────────────────────────────────
  // Added DTWEXBGS at 0.15; rescaled others by 0.85.
  { name: "G7 Leading Indicator",  fred_id: "G7LOLITOAASTSAM",  layer: "global", frequency: "monthly",   direction: "direct",  weight: 0.2550, threshold: 100.0, category: "macro", description: "OECD Composite Leading Indicator for the G7. Below 100 signals below-trend global growth." },
  { name: "Euro Area Yield Curve", fred_id: "EURYLDCRV",         layer: "global", frequency: "monthly",   direction: "direct",  weight: 0.2125, threshold: 0.0,   category: "macro", description: "Derived: Euro area 10Y govt yield minus 3M rate. Inversion = EU recession signal." },
  { name: "Euro Area Unemployment",fred_id: "LRHUTTTTEZM156S",   layer: "global", frequency: "monthly",   direction: "inverse", weight: 0.2125, threshold: null,  category: "macro", description: "Euro area harmonized unemployment rate. Z-score normalized." },
  { name: "Euro Area Real GDP",    fred_id: "CLVMNACSCAB1GQEA",  layer: "global", frequency: "quarterly", direction: "direct",  weight: 0.1700, threshold: null,  category: "macro", description: "Euro area real GDP, chained 2010 EUR, ECB/Eurostat. Z-score normalized." },
  { name: "Trade-Weighted USD",    fred_id: "DTWEXBGS",          layer: "global", frequency: "monthly",   direction: "inverse", weight: 0.1500, threshold: null,  category: "macro", description: "Nominal broad trade-weighted US dollar index. A stronger dollar tightens global financial conditions and pressures EM economies." }
];

// Layer weights sum to 1.0.
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
