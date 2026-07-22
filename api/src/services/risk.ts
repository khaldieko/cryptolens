import { config } from "../config";
import { redis } from "../redis";
import { getPortfolioView } from "./holdings";
import { ensureHistory, getSeries } from "./priceHistory";

/**
 * Week 4 — Risk metrics for a user's real holdings.
 * Flow: holdings (Postgres) → ensure 30d price history → Python risk engine
 * (/metrics) → volatility + HHI + rating, combined with portfolio value and a
 * value-weighted 24h change. Cached per user for 2 minutes.
 */

export interface RiskMetrics {
  totalValueUsd: number;
  change24hPct: number;          // value-weighted across holdings
  volatilityAnnualized: number;  // e.g. 0.53 = 53%
  concentrationHhi: number;      // 1/n .. 1.0
  concentrationRating: "Low" | "Moderate" | "High";
  assetsIncluded: number;        // assets with enough history for the vol calc
  computedAt: string;
}

interface EngineResponse {
  volatility_annualized: number;
  concentration_hhi: number;
  concentration_rating: "Low" | "Moderate" | "High";
}

export async function getRiskMetrics(userId: number): Promise<RiskMetrics> {
  const cacheKey = `risk:user:${userId}`;
  const hit = await redis.get(cacheKey);
  if (hit) return JSON.parse(hit) as RiskMetrics;

  const view = await getPortfolioView(userId);

  // Aggregate per asset (a portfolio can hold the same asset from many sources)
  const byAsset = new Map<string, { valueUsd: number; change24h: number }>();
  for (const h of view.holdings) {
    const prev = byAsset.get(h.assetId) ?? { valueUsd: 0, change24h: h.change24h };
    byAsset.set(h.assetId, { valueUsd: prev.valueUsd + h.valueUsd, change24h: h.change24h });
  }

  const total = view.totalValueUsd;
  const change24hPct = total > 0
    ? [...byAsset.values()].reduce((acc, a) => acc + a.change24h * (a.valueUsd / total), 0)
    : 0;

  // Empty portfolio → zeroed metrics, no engine call
  if (byAsset.size === 0 || total <= 0) {
    const empty: RiskMetrics = {
      totalValueUsd: total,
      change24hPct: 0,
      volatilityAnnualized: 0,
      concentrationHhi: 0,
      concentrationRating: "Low",
      assetsIncluded: 0,
      computedAt: new Date().toISOString(),
    };
    await redis.set(cacheKey, JSON.stringify(empty), "EX", 120);
    return empty;
  }

  const assetIds = [...byAsset.keys()];
  await ensureHistory(assetIds);
  const series = await getSeries(assetIds);

  // Engine requires ≥2 points per series
  const usable = assetIds.filter(id => (series[id]?.length ?? 0) >= 2);

  const payload = {
    holdings: assetIds.map(id => ({ asset_id: id, value_usd: byAsset.get(id)!.valueUsd })),
    series: usable.map(id => ({ asset_id: id, prices: series[id] })),
  };

  const res = await fetch(`${config.riskEngineUrl}/metrics`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    throw Object.assign(new Error(`Risk engine error ${res.status}`), { status: 502 });
  }
  const engine = (await res.json()) as EngineResponse;

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
