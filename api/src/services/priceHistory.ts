import { config } from "../config";
import { query } from "../db";
import { cached } from "../redis";

/**
 * Week 4 — Daily price history.
 * Strategy: Postgres (price_history) is the source of truth for daily closes.
 * When history for an asset is missing or stale (no row for yesterday or today),
 * we backfill 30 days from CoinGecko's market_chart endpoint, and Redis-cache
 * the raw fetch for 12h as extra rate-limit protection.
 */

const HISTORY_DAYS = 30;

interface MarketChart {
  prices: Array<[number, number]>; // [unix_ms, price]
}

/** Pure function: market_chart payload → per-day closes (keeps latest point per UTC day). */
export function toDailyCloses(chart: MarketChart): Array<{ day: string; price: number }> {
  const byDay = new Map<string, number>();
  for (const [ms, price] of chart.prices ?? []) {
    if (!Number.isFinite(ms) || !Number.isFinite(price)) continue;
    const day = new Date(ms).toISOString().slice(0, 10); // YYYY-MM-DD (UTC)
    byDay.set(day, price); // later points overwrite → last value of the day wins
  }
  return [...byDay.entries()]
    .map(([day, price]) => ({ day, price }))
    .sort((a, b) => a.day.localeCompare(b.day));
}

async function fetchMarketChart(assetId: string): Promise<MarketChart> {
  const key = `cg:chart:${assetId}:${HISTORY_DAYS}`;
  return cached(key, 43200, async () => {
    const url = `${config.coingeckoBase}/coins/${encodeURIComponent(assetId)}/market_chart` +
      `?vs_currency=usd&days=${HISTORY_DAYS}&interval=daily`;
    const res = await fetch(url, {
      headers: {
        accept: "application/json",
        ...(config.coingeckoApiKey ? { "x-cg-demo-api-key": config.coingeckoApiKey } : {}),
      },
    });
    if (res.status === 429) {
      throw Object.assign(new Error("CoinGecko rate limit hit while fetching history"), { status: 429 });
    }
    if (!res.ok) {
      throw Object.assign(new Error(`CoinGecko history error ${res.status} for ${assetId}`), { status: res.status });
    }
    return (await res.json()) as MarketChart;
  });
}

/** True if we already have a close for yesterday or today (UTC). */
async function isFresh(assetId: string): Promise<boolean> {
  const rows = await query<{ latest: string | null }>(
    "SELECT MAX(day)::text AS latest FROM price_history WHERE asset_id = $1",
    [assetId]
  );
  const latest = rows[0]?.latest;
  if (!latest) return false;
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  return latest >= yesterday;
}

/** Ensure ≥30 days of daily closes exist in Postgres for each asset. */
export async function ensureHistory(assetIds: string[]): Promise<void> {
  for (const assetId of assetIds) {
    if (await isFresh(assetId)) continue;
    const chart = await fetchMarketChart(assetId);
    const closes = toDailyCloses(chart);
    for (const c of closes) {
      await query(
        `INSERT INTO price_history (asset_id, day, price_usd)
         VALUES ($1, $2, $3)
         ON CONFLICT (asset_id, day) DO UPDATE SET price_usd = EXCLUDED.price_usd`,
        [assetId, c.day, c.price]
      );
    }
  }
}

/** Oldest-first daily closes per asset, up to `days` most recent. */
export async function getSeries(assetIds: string[], days = HISTORY_DAYS): Promise<Record<string, number[]>> {
  const out: Record<string, number[]> = {};
  for (const assetId of assetIds) {
    const rows = await query<{ price_usd: string }>(
      `SELECT price_usd FROM (
         SELECT day, price_usd FROM price_history
         WHERE asset_id = $1 ORDER BY day DESC LIMIT $2
       ) recent ORDER BY day ASC`,
      [assetId, days]
    );
    out[assetId] = rows.map(r => Number(r.price_usd));
  }
  return out;
}
