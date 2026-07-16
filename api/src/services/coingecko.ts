import { config } from "../config";
import { cached } from "../redis";

/**
 * CoinGecko free tier allows ~10-30 req/min. Strategy:
 * - Cache /simple/price responses in Redis for 60s per unique (ids, vs) pair.
 * - Cache the coin list for 24h.
 * - Surface 429s with a friendly error instead of hammering the API.
 */

export interface PriceMap {
  [assetId: string]: { [currency: string]: number };
}

async function cgFetch<T>(path: string): Promise<T> {
  const res = await fetch(`${config.coingeckoBase}${path}`, {
    headers: {
      accept: "application/json",
      ...(config.coingeckoApiKey ? { "x-cg-demo-api-key": config.coingeckoApiKey } : {}),
    },
  });
  if (res.status === 429) {
    throw Object.assign(new Error("CoinGecko rate limit hit — serving cached data only"), { status: 429 });
  }
  if (!res.ok) {
    throw Object.assign(new Error(`CoinGecko error ${res.status}`), { status: res.status });
  }
  return (await res.json()) as T;
}

export async function getPrices(ids: string[], vs = "usd"): Promise<PriceMap> {
  if (ids.length === 0) return {};
  const sorted = [...ids].sort().join(",");
  const key = `cg:prices:${sorted}:${vs}`;
  return cached(key, 60, () =>
    cgFetch<PriceMap>(
      `/simple/price?ids=${encodeURIComponent(sorted)}&vs_currencies=${encodeURIComponent(vs)}&include_24hr_change=true`
    )
  );
}

export async function getCoinList(): Promise<Array<{ id: string; symbol: string; name: string }>> {
  return cached("cg:coinlist", 86400, () =>
    cgFetch<Array<{ id: string; symbol: string; name: string }>>("/coins/list")
  );
}
