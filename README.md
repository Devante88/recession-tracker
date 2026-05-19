# Recession Tracker

A macro + micro recession monitoring dashboard. Pulls 24 indicators from
FRED on a scheduled cadence, scores each into a 0-100 risk score, aggregates
into 5 layers and 1 composite, and publishes a dashboard via GitHub Pages.

## Architecture

GitHub Actions fetches FRED data twice weekly, computes the composite score
in Node, commits JSON snapshots to the repo. GitHub Pages serves the static
front-end which reads those JSON files. No CORS issues, no API key in
the browser.

## Setup

1. Get a free FRED API key from https://fred.stlouisfed.org/docs/api/api_key.html
2. Fork or clone this repo
3. Add `FRED_API_KEY` to repo Secrets (Settings → Secrets and variables → Actions)
4. Enable GitHub Pages (Settings → Pages → deploy from `main` branch, `/docs` folder)
5. Manually trigger the "Refresh FRED Data" workflow once to generate initial data
6. Visit your GitHub Pages URL

## Local development

```bash
node --test tests/*.mjs                   # run tests
FRED_API_KEY=xxx node scripts/fetch.mjs   # generate data locally
```

Then open `docs/index.html` via a local server (e.g. `python -m http.server 8000 --directory docs`)
because ES modules won't load from `file://`.

## Limitations and honest disclosures

- **Composite weights are doctrinal, not optimized.** The 5-layer weights
  (financial 30%, labor 25%, real economy 20%, inflation 15%, micro 10%)
  reflect a judgment about which signal classes lead vs lag, not an
  empirical optimization against NBER chronology.
- **Alert thresholds (60 RED, 30 YELLOW) are calibrated by intuition.**
  Without a backtest, these are not validated. Treat as relative signals.
- **Series have different release lags.** Daily series are ~1 day fresh,
  monthly are 1-2 months stale, quarterly are 3-4 months stale. The
  composite blends these and surfaces each indicator's actual observation
  date.
- **No backtest.** This was an intentional architectural choice. History
  accumulates from real scheduled runs over time.

## Indicator registry

24 indicators across 5 layers. See `src/registry.mjs` for the full list,
weights, and thresholds.
