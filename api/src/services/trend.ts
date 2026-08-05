import { config } from "../config";
import { redis } from "../redis";
import { query } from "../db";
import { getPortfolioView } from "./holdings";

/**
 * Week 6 — Time series for the dashboard charts.
 *
 * Portfolio value over time is computed as a *constant-holdings backtest*:
 * today's holdings valued at each day's historical close. This answers
 * "what would my current portfolio have been worth?" — it does not replay
 * historical buys/sells, which CryptoLens doesn't track. Documented as such
 * in the UI so the chart isn't misread as realised performance.
 *
 * Volatility trend is a rolling window over that value series, computed by the
 * Python engine so all risk math stays in one place.
 */

export interface TrendPoint {
  day: string;
  valueUsd: number;
  volatility: number | null; // annualized, null until the window fills
}

export interface TrendResult {
  points: TrendPoint[];
  days: number;
  window: number;
  assetsIncluded: number;
  note: string;
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

async function callTrend(payload: unknown): Promise<Array<{ day: string; volatility: number | null }>> {
  const delaysMs = [0, 2000, 4000, 8000, 12000, 20000];
  let lastErr: Error | null = null;
  for (let attempt = 0; attempt < delaysMs.length; attempt++) {
    if (delaysMs[attempt] > 0) await sleep(delaysMs[attempt]);
    try {
      const res = await fetch(`${config.riskEngineUrl}/trend`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (res.status === 502 || res.status === 503 || res.status === 504) {
        lastErr = new Error(`Risk engine waking (${res.status})`);
        continue;
      }
      if (!res.ok) throw Object.assign(new Error(`Risk engine error ${res.status}`), { status: 502 });
      const body = (await res.json()) as { points: Array<{ day: string; volatility: number | null }> };
      return body.points ?? [];
    } catch (err) {
      lastErr = err as Error;
    }
  }
  throw Object.assign(new Error("Risk engine is starting up — please refresh in a moment"), { status: 503, cause: lastErr });
}

export async function getTrend(userId: number, days = 30, window = 7): Promise<TrendResult> {
  const cacheKey = `trend:user:${userId}:${days}:${window}`;
  const hit = await redis.get(cacheKey);
  if (hit) return JSON.parse(hit) as TrendResult;

  const view = await getPortfolioView(userId);

  // Current amount held per asset (summed across sources)
  const amounts = new Map<string, number>();
  for (const h of view.holdings) {
    amounts.set(h.assetId, (amounts.get(h.assetId) ?? 0) + h.amount);
  }

  const empty: TrendResult = {
    points: [], days, window, assetsIncluded: 0,
    note: "Add holdings to see your portfolio trend.",
  };
  if (amounts.size === 0) return empty;

  const assetIds = [...amounts.keys()];

  // Pull stored daily closes for these assets (no CoinGecko call — charts read
  // from the history already collected in Week 4).
  const rows = await query<{ asset_id: string; day: string; price_usd: string }>(
    `SELECT asset_id, day::text AS day, price_usd
     FROM price_history
     WHERE asset_id = ANY($1::text[]) AND day >= (CURRENT_DATE - $2::int)
     ORDER BY day ASC`,
    [assetIds, days]
  );
  if (rows.length === 0) {
    return { ...empty, note: "Price history is still being collected — check back shortly." };
  }

  // day -> assetId -> price
  const byDay = new Map<string, Map<string, number>>();
  for (const r of rows) {
    if (!byDay.has(r.day)) byDay.set(r.day, new Map());
    byDay.get(r.day)!.set(r.asset_id, Number(r.price_usd));
  }

  // Only include days where we have a price for most held assets, so a partially
  // backfilled asset doesn't create artificial dips in the value line.
  const minCoverage = Math.max(1, Math.ceil(assetIds.length * 0.6));
  const series: Array<{ day: string; value: number }> = [];
  for (const [day, prices] of [...byDay.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    if (prices.size < minCoverage) continue;
    let value = 0;
    for (const [assetId, amount] of amounts) {
      const p = prices.get(assetId);
      if (p !== undefined) value += amount * p;
    }
    if (value > 0) series.push({ day, value });
  }

  if (series.length < 2) {
    return { ...empty, assetsIncluded: assetIds.length,
      note: "Not enough price history yet for a trend — it builds up daily." };
  }

  // Ask the engine for the rolling volatility of this value series
  let volPoints: Array<{ day: string; volatility: number | null }> = [];
  try {
    volPoints = await callTrend({
      series: series.map(s => ({ day: s.day, value: s.value })),
      window,
    });
  } catch {
    // Chart still renders the value line even if the engine is unavailable
    volPoints = series.map(s => ({ day: s.day, volatility: null }));
  }
  const volByDay = new Map(volPoints.map(p => [p.day, p.volatility]));

  const result: TrendResult = {
    points: series.map(s => ({
      day: s.day,
      valueUsd: Number(s.value.toFixed(2)),
      volatility: volByDay.get(s.day) ?? null,
    })),
    days,
    window,
    assetsIncluded: assetIds.length,
    note: "Current holdings valued at historical prices (constant-holdings view).",
  };

  await redis.set(cacheKey, JSON.stringify(result), "EX", 300);
  return result;
}
