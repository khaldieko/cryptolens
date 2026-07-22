# Week 4 — Core Risk Engine: what changed & how to apply

## New / changed files

**API (new):**
- `api/src/services/priceHistory.ts` — fetches 30 days of daily closes from
  CoinGecko `market_chart`, stores them in the `price_history` table
  (Postgres = source of truth; Redis caches raw fetches for 12h)
- `api/src/services/risk.ts` — the bridge: holdings → ensure price history →
  Python engine `/metrics` → combined RiskMetrics (2-min Redis cache per user)
- `api/src/routes/risk.ts` — `GET /api/risk/metrics` (authenticated)

**API (changed):**
- `api/src/index.ts` — mounts `/api/risk`

**Frontend (changed):**
- `frontend/src/api/client.ts` — `getRiskMetrics()` + RiskMetrics type
- `frontend/src/pages/Dashboard.tsx` — the four wireframe stat cards, live:
  Total Value, 24h Change (value-weighted), Volatility Score (annualized %,
  with Calm/Elevated/Extreme coloring), Concentration Rating (Low/Moderate/High
  with the HHI value)

## What the metrics mean (for the professor / demo)
- **Volatility Score** — standard deviation of daily log returns over 30 days,
  annualized (√365), computed portfolio-wide using the covariance between
  assets — so diversification between uncorrelated assets *reduces* the score.
- **Concentration (HHI)** — Herfindahl–Hirschman Index on portfolio weights:
  1/n for perfectly even, 1.0 for all-in-one-asset. <0.25 Low, <0.50 Moderate,
  else High.
- **24h Change** — each asset's 24h move weighted by its share of portfolio value.

## How to apply

1. Copy files into the repo at the same paths (overwrite where files exist).
2. Local test:
   ```bash
   cd api && npm run dev        # no new migration this week
   # risk engine + frontend in their own tabs as usual
   ```
3. Open the Dashboard. First load fetches 30 days of history per held asset
   (a few seconds), then metrics appear. With the test CSV (BTC/ETH/SOL/LINK/
   USDC) expect: Volatility ~30–60% (Elevated), Concentration Moderate-to-High
   (BTC-heavy), and USDC correctly dampening both.
4. Sanity checks worth screenshotting:
   - Remove everything except USDC → volatility collapses toward 0% (stablecoin)
   - All-in one asset → Concentration flips to High (HHI → 1.0)
5. Commit & push — auto-deploys. First production load also backfills history
   into the Render Postgres.

## Design decisions
- **Postgres as history source-of-truth** (not just Redis): history powers the
  Week 6 volatility-trend chart and survives cache eviction; the `price_history`
  table was designed for this in Week 2.
- **On-demand backfill instead of a cron job (for now):** metrics requests
  ensure freshness themselves; the scheduled evaluator arrives in Week 5 with
  alerts, where cron is genuinely needed.
- **Per-user 2-minute metric cache:** keeps repeat dashboard loads instant and
  protects the free-tier engine from redundant computation.

## Week 4 exit criteria
- [x] Daily price history collection (30d) into Postgres — parser unit-tested
      (6/6) incl. against live CoinGecko data
- [x] `/api/risk/metrics` wiring holdings → history → Python engine
- [x] Dashboard stat cards live: value, 24h change, volatility, concentration
- [x] Type-checks clean (API + frontend)
- [ ] Deployed + verified on the live URL (your push)
