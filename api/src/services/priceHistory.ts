import { config } from "../config";
import { query } from "../db";
import { cached } from "../redis";

/**
 * Week 4 daily price history + Week 5 rate-limit resilience.
 * Postgres (price_history) is the source of truth for daily closes. We backfill
 * from CoinGecko only when needed, and — critically — NEVER throw on a rate
 * limit: if CoinGecko is unavailable we fall back to whatever is already stored.
 */

const HISTORY_DAYS = 30;
const MIN_USABLE_DAYS = 8; // enough for a meaningful volatility estimate

interface MarketChart {
  prices: Array<[number, number]>;
}

export function toDailyCloses(chart: MarketChart): Array<{ day: string; price: number }> {
  const byDay = new Map<string, number>();
  for (const [ms, price] of chart.prices ?? []) {
    if (!Number.isFinite(ms) || !Number.isFinite(price)) continue;
    const day = new Date(ms).toISOString().slice(0, 10);
    byDay.set(day, price);
  }
  return [...byDay.entries()].map(([day, price]) => ({ day, price })).sort((a, b) => a.day.localeCompare(b.day));
}

async function fetchMarketChart(assetId: string): Promise<MarketChart | null> {
  const key = `cg:chart:${assetId}:${HISTORY_DAYS}`;
  try {
    return await cached(key, 43200, async () => {
      const url = `${config.coingeckoBase}/coins/${encodeURIComponent(assetId)}/market_chart` +
        `?vs_currency=usd&days=${HISTORY_DAYS}&interval=daily`;
      const res = await fetch(url, {
        headers: {
          accept: "application/json",
          ...(config.coingeckoApiKey ? { "x-cg-demo-api-key": config.coingeckoApiKey } : {}),
        },
      });
      if (res.status === 429) {
        // Signal rate-limit to the caller by throwing INSIDE cached (won't be stored)
        throw Object.assign(new Error("cg-429"), { rateLimited: true });
      }
      if (!res.ok) throw Object.assign(new Error(`cg-${res.status}`), { status: res.status });
      return (await res.json()) as MarketChart;
    });
  } catch {
    // Any fetch failure (rate limit, network, CG down) → null, caller falls back to stored data
    return null;
  }
}

async function storedDayCount(assetId: string): Promise<{ count: number; latest: string | null }> {
  const rows = await query<{ count: string; latest: string | null }>(
    "SELECT COUNT(*)::int AS count, MAX(day)::text AS latest FROM price_history WHERE asset_id = $1",
    [assetId]
  );
  return { count: Number(rows[0]?.count ?? 0), latest: rows[0]?.latest ?? null };
}

/**
 * Ensure history for each asset — but be conservative about fetching:
 *  - If we already have >= MIN_USABLE_DAYS AND today's (or yesterday's) close, skip.
 *  - Otherwise try to fetch; if the fetch is rate-limited/unavailable, keep going
 *    with whatever we have. Never throws on rate limits.
 * When `allowFetch` is false (background evaluator), we never call CoinGecko.
 */
export async function ensureHistory(assetIds: string[], allowFetch = true): Promise<void> {
  const today = new Date().toISOString().slice(0, 10);
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);

  for (const assetId of assetIds) {
    const { count, latest } = await storedDayCount(assetId);
    const fresh = latest !== null && latest >= yesterday;
    const usable = count >= MIN_USABLE_DAYS;

    // Good enough already → skip entirely
    if (fresh && usable) continue;
    // Background sweeps must not fetch
    if (!allowFetch) continue;
    // Already fetched today (even if CG failed, the 12h Redis cache dedupes) — for
    // fresh-but-thin data, still try once; for stale data, try to top up.

    const chart = await fetchMarketChart(assetId);
    if (!chart) continue; // rate-limited/unavailable → use stored data

    const closes = toDailyCloses(chart);
    for (const c of closes) {
      await query(
        `INSERT INTO price_history (asset_id, day, price_usd) VALUES ($1, $2, $3)
         ON CONFLICT (asset_id, day) DO UPDATE SET price_usd = EXCLUDED.price_usd`,
        [assetId, c.day, c.price]
      );
    }
  }
}

export async function getSeries(assetIds: string[], days = HISTORY_DAYS): Promise<Record<string, number[]>> {
  const out: Record<string, number[]> = {};
  for (const assetId of assetIds) {
    const rows = await query<{ price_usd: string }>(
      `SELECT price_usd FROM (
         SELECT day, price_usd FROM price_history WHERE asset_id = $1 ORDER BY day DESC LIMIT $2
       ) recent ORDER BY day ASC`,
      [assetId, days]
    );
    out[assetId] = rows.map(r => Number(r.price_usd));
  }
  return out;
}
