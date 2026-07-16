# Week 3 — Portfolio Aggregation: what changed & how to apply

## New / changed files

**API (new):**
- `api/migrations/002_holdings_unique.sql` — unique index for holding upserts
- `api/src/services/holdings.ts` — CSV parser, symbol→CoinGecko map, USD valuation
- `api/src/routes/portfolio.ts` — the new endpoints

**API (changed):**
- `api/src/index.ts` — mounts `/api/portfolio`
- `api/src/services/etherscan.ts` — exports `isValidEthAddress` helper
- `api/src/services/coingecko.ts` — `getPrices([])` now safely returns `{}`

**Frontend (new):**
- `frontend/src/components/Layout.tsx` — app shell with sidebar (Risk Lab & Alerts marked "soon")
- `frontend/src/pages/Portfolio.tsx` — the Portfolio screen from the Week 1 wireframe

**Frontend (changed):**
- `frontend/src/api/client.ts` — portfolio API functions + types
- `frontend/src/pages/Dashboard.tsx` — now uses Layout, shows Portfolio Total card
- `frontend/src/App.tsx` — adds the `/portfolio` route

## New API endpoints (all require the JWT Bearer token)

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/portfolio` | Sources + holdings valued in USD, sorted by value |
| POST | `/api/portfolio/wallets` `{address}` | Add ETH wallet (read-only), sync balance via Etherscan |
| POST | `/api/portfolio/csv` `{filename,csv}` | Import `symbol,amount` rows; unknown symbols reported, not dropped |
| POST | `/api/portfolio/sync` | Refresh all wallet balances |
| DELETE | `/api/portfolio/sources/:id` | Remove a source (holdings cascade) |

## How to apply

1. Copy these files into your repo at the same paths (overwrite existing).
2. Local test:
   ```bash
   cd api && npm run migrate && npm run dev     # migration 002 runs automatically
   # new terminal: cd frontend && npm run dev
   ```
3. In the app: Portfolio page → paste any public ETH address (try Vitalik's:
   0xd8dA6BF26964aF9D7eEd9e03E9EB25c05d6C6b0C) → holdings appear valued in USD.
4. CSV test — create `test.csv`:
   ```
   symbol,amount
   BTC,0.25
   ETH,1.5
   SOL,20
   ```
   Import it; the table should show all rows + % of portfolio.
5. Commit & push — Render/Vercel auto-deploy, and migration 002 runs during the
   Render build (`npm run migrate` is already in your build command).

## Design decisions worth noting to the professor
- **Curated symbol map** instead of CoinGecko's full coin list: the full list has
  thousands of duplicate tickers (many scam coins named "BTC"), so an explicit
  20-asset map is deterministic and safe for an MVP. Unknown symbols are surfaced
  back to the user as skipped lines rather than silently guessed.
- **Full address stored as source label**, shortened only in the UI — this lets
  `/sync` refresh balances without a second lookup table.
- **Server-side CSV parsing** with per-line error reporting (no silent data loss).

## Week 3 exit criteria
- [x] Add wallet by public address → live ETH balance as a holding
- [x] CSV import with validation and duplicate aggregation (10/10 unit tests pass)
- [x] Unified holdings view: USD value, price, 24h change, % of portfolio
- [x] Source management (list, remove, sync)
- [x] App shell navigation matching wireframes
- [ ] Deployed + smoke-tested on the live URL (your push)
