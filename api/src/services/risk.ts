import { config } from "../config";
import { redis } from "../redis";
import { getPortfolioView } from "./holdings";
import { ensureHistory, getSeries } from "./priceHistory";

/**
 * Week 4 risk metrics + Week 5 rate-limit resilience.
 * `background=true` (used by the alerts evaluator) never fetches from CoinGecko —
 * it computes from already-stored history only, so the 5-minute sweep can't
 * exhaust the API rate limit.
 */

export interface RiskMetrics {
  totalValueUsd: number;
  change24hPct: number;
  volatilityAnnualized: number;
  concentrationHhi: number;
  concentrationRating: "Low" | "Moderate" | "High";
  assetsIncluded: number;
  computedAt: string;
}

interface EngineResponse {
  volatility_annualized: number;
  concentration_hhi: number;
  concentration_rating: "Low" | "Moderate" | "High";
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

async function callEngine(payload: unknown): Promise<EngineResponse> {
  const delaysMs = [0, 2000, 4000, 8000, 12000, 20000];
  let lastErr: Error | null = null;
  for (let attempt = 0; attempt < delaysMs.length; attempt++) {
    if (delaysMs[attempt] > 0) await sleep(delaysMs[attempt]);
    try {
      const res = await fetch(`${config.riskEngineUrl}/metrics`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (res.status === 502 || res.status === 503 || res.status === 504) {
        lastErr = new Error(`Risk engine waking (${res.status})`);
        continue;
      }
      if (!res.ok) throw Object.assign(new Error(`Risk engine error ${res.status}`), { status: 502 });
      return (await res.json()) as EngineResponse;
    } catch (err) {
      lastErr = err as Error;
    }
  }
  throw Object.assign(new Error("Risk engine is starting up — please refresh in a moment"), { status: 503, cause: lastErr });
}

export async function getRiskMetrics(userId: number, background = false): Promise<RiskMetrics> {
  const cacheKey = `risk:user:${userId}`;
  const hit = await redis.get(cacheKey);
  if (hit) return JSON.parse(hit) as RiskMetrics;

  const view = await getPortfolioView(userId);

  const byAsset = new Map<string, { valueUsd: number; change24h: number }>();
  for (const h of view.holdings) {
    const prev = byAsset.get(h.assetId) ?? { valueUsd: 0, change24h: h.change24h };
    byAsset.set(h.assetId, { valueUsd: prev.valueUsd + h.valueUsd, change24h: h.change24h });
  }

  const total = view.totalValueUsd;
  const change24hPct = total > 0
    ? [...byAsset.values()].reduce((acc, a) => acc + a.change24h * (a.valueUsd / total), 0)
    : 0;

  if (byAsset.size === 0 || total <= 0) {
    const empty: RiskMetrics = {
      totalValueUsd: total, change24hPct: 0, volatilityAnnualized: 0,
      concentrationHhi: 0, concentrationRating: "Low", assetsIncluded: 0,
      computedAt: new Date().toISOString(),
    };
    await redis.set(cacheKey, JSON.stringify(empty), "EX", 120);
    return empty;
  }

  const assetIds = [...byAsset.keys()];
  // Background sweeps must not fetch from CoinGecko — use stored history only.
  await ensureHistory(assetIds, !background);
  const series = await getSeries(assetIds);
  const usable = assetIds.filter(id => (series[id]?.length ?? 0) >= 2);

  const payload = {
    holdings: assetIds.map(id => ({ asset_id: id, value_usd: byAsset.get(id)!.valueUsd })),
    series: usable.map(id => ({ asset_id: id, prices: series[id] })),
  };

  const engine = await callEngine(payload);

  const metrics: RiskMetrics = {
    totalValueUsd: total,
    change24hPct,
    volatilityAnnualized: engine.volatility_annualized,
    concentrationHhi: engine.concentration_hhi,
    concentrationRating: engine.concentration_rating,
    assetsIncluded: usable.length,
    computedAt: new Date().toISOString(),
  };
  await redis.set(cacheKey, JSON.stringify(metrics), "EX", 120);
  return metrics;
}
