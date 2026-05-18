# Recession Tracker

## Trigger conditions
- User asks to build a recession monitoring dashboard
- User wants to track FRED indicators with automated refresh
- User wants a server-side scheduled data pipeline with static front-end

## Process
1. Scaffold repo per spec (registry + tests)
2. Build pure scoring engine (TDD)
3. Build FRED pipeline (fetch + Actions workflow)
4. Build static dashboard

## Acceptance criteria
- `node --test` passes all suites
- GitHub Action completes green
- `data/current.json` and `data/history.json` exist with valid schema
- GitHub Pages site loads and renders

## Anti-patterns
- Browser direct FRED fetch (CORS will block it)
- Synthetic backtest (intellectually fraudulent)
- API key in client code
- Mixing data fetch with UI rendering
