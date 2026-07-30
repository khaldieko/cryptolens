import { config } from "../config";
import { getPortfolioView } from "./holdings";
import { ensureHistory, getSeries } from "./priceHistory";

/**
 * Week 5 — Drawdown simulation for a user's real holdings.
 * Aggregates holdings by asset, ensures price history, then asks the Python
 * engine to model a market drop scaled by each asset's beta.
 */

export interface SimAssetImpact {
  assetId: string;
  beta: number;
  valueBefore: number;
  valueAfter: number;
  changePct: number;
}

export interface SimulationResult {
  marketDropPct: number;
  totalBefore: number;
  totalAfter: number;
  projectedLoss: number;
  projectedLossPct: number;
  perAsset: SimAssetImpact[];
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

/** POST to the engine /simulate with the same cold-start retry as /metrics. */
async function callSimulate(payload: unknown): Promise<Record<string, unknown>> {
  const delaysMs = [0, 2000, 4000, 8000, 12000, 20000];
  let lastErr: Error | null = null;
  for (let attempt = 0; attempt < delaysMs.length; attempt++) {
    if (delaysMs[attempt] > 0) await sleep(delaysMs[attempt]);
    try {
      const res = await fetch(`${config.riskEngineUrl}/simulate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (res.status === 502 || res.status === 503 || res.status === 504) {
        lastErr = new Error(`Risk engine waking (${res.status})`);
        continue;
      }
      if (!res.ok) throw Object.assign(new Error(`Risk engine error ${res.status}`), { status: 502 });
      return (await res.json()) as Record<string, unknown>;
    } catch (err) {
      lastErr = err as Error;
    }
  }
  throw Object.assign(new Error("Risk engine is starting up — please refresh in a moment"), { status: 503, cause: lastErr });
}

export async function runSimulation(userId: number, marketDropPct: number): Promise<SimulationResult> {
  const view = await getPortfolioView(userId);

  // Aggregate holdings by asset
  const byAsset = new Map<string, number>();
  for (const h of view.holdings) {
    byAsset.set(h.assetId, (byAsset.get(h.assetId) ?? 0) + h.valueUsd);
  }

  if (byAsset.size === 0 || view.totalValueUsd <= 0) {
    return {
      marketDropPct, totalBefore: 0, totalAfter: 0,
      projectedLoss: 0, projectedLossPct: 0, perAsset: [],
    };
  }

  const assetIds = [...byAsset.keys()];
  await ensureHistory(assetIds);
  const series = await getSeries(assetIds);
  const usable = assetIds.filter(id => (series[id]?.length ?? 0) >= 2);

  const payload = {
    holdings: assetIds.map(id => ({ asset_id: id, value_usd: byAsset.get(id)! })),
    series: usable.map(id => ({ asset_id: id, prices: series[id] })),
    market_drop_pct: marketDropPct,
  };

  const raw = await callSimulate(payload);
  const per = (raw.per_asset as Array<Record<string, number | string>>) ?? [];

  return {
    marketDropPct: Number(raw.market_drop_pct),
    totalBefore: Number(raw.total_before),
    totalAfter: Number(raw.total_after),
    projectedLoss: Number(raw.projected_loss),
    projectedLossPct: Number(raw.projected_loss_pct),
    perAsset: per.map(a => ({
      assetId: String(a.asset_id),
      beta: Number(a.beta),
      valueBefore: Number(a.value_before),
      valueAfter: Number(a.value_after),
      changePct: Number(a.change_pct),
    })),
  };
}
