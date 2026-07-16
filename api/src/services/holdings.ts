import { query } from "../db";
import { getPrices } from "./coingecko";

/**
 * Week 3 — Portfolio aggregation core.
 * Holdings come from two source kinds:
 *  - 'wallet': a public ETH address (balance synced via Etherscan)
 *  - 'csv':    exchange holdings imported as symbol,amount rows
 * Everything is valued in USD via the cached CoinGecko price layer.
 */

// Curated symbol → CoinGecko id map for the MVP. CoinGecko's full coin list
// has thousands of duplicate symbols, so an explicit map is safer and
// deterministic. Extend as needed.
export const SYMBOL_MAP: Record<string, { id: string; symbol: string }> = {
  BTC: { id: "bitcoin", symbol: "BTC" },
  ETH: { id: "ethereum", symbol: "ETH" },
  SOL: { id: "solana", symbol: "SOL" },
  USDT: { id: "tether", symbol: "USDT" },
  USDC: { id: "usd-coin", symbol: "USDC" },
  BNB: { id: "binancecoin", symbol: "BNB" },
  XRP: { id: "ripple", symbol: "XRP" },
  ADA: { id: "cardano", symbol: "ADA" },
  DOGE: { id: "dogecoin", symbol: "DOGE" },
  AVAX: { id: "avalanche-2", symbol: "AVAX" },
  DOT: { id: "polkadot", symbol: "DOT" },
  LINK: { id: "chainlink", symbol: "LINK" },
  MATIC: { id: "matic-network", symbol: "MATIC" },
  POL: { id: "polygon-ecosystem-token", symbol: "POL" },
  LTC: { id: "litecoin", symbol: "LTC" },
  UNI: { id: "uniswap", symbol: "UNI" },
  ATOM: { id: "cosmos", symbol: "ATOM" },
  ARB: { id: "arbitrum", symbol: "ARB" },
  OP: { id: "optimism", symbol: "OP" },
  HYPE: { id: "hyperliquid", symbol: "HYPE" },
};

export interface CsvRow {
  assetId: string;
  symbol: string;
  amount: number;
}

export interface CsvParseResult {
  rows: CsvRow[];
  errors: string[];
}

/**
 * Parse CSV text of the form:
 *   symbol,amount
 *   BTC,0.5
 *   ETH,2.1
 * Header row optional. Unknown symbols and bad amounts are collected as
 * errors rather than silently dropped.
 */
export function parseHoldingsCsv(text: string): CsvParseResult {
  const rows: CsvRow[] = [];
  const errors: string[] = [];
  const seen = new Map<string, number>(); // aggregate duplicate symbols

  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0);
  for (let i = 0; i < lines.length; i++) {
    const parts = lines[i].split(",").map(p => p.trim());
    if (parts.length < 2) {
      errors.push(`Line ${i + 1}: expected "symbol,amount"`);
      continue;
    }
    const symbol = parts[0].toUpperCase();
    // skip a header row like "symbol,amount"
    if (i === 0 && symbol === "SYMBOL") continue;

    const mapped = SYMBOL_MAP[symbol];
    if (!mapped) {
      errors.push(`Line ${i + 1}: unsupported symbol "${symbol}"`);
      continue;
    }
    const amount = Number(parts[1]);
    if (!Number.isFinite(amount) || amount < 0) {
      errors.push(`Line ${i + 1}: invalid amount "${parts[1]}"`);
      continue;
    }
    seen.set(mapped.id, (seen.get(mapped.id) ?? 0) + amount);
  }

  for (const [assetId, amount] of seen) {
    const entry = Object.values(SYMBOL_MAP).find(m => m.id === assetId)!;
    rows.push({ assetId, symbol: entry.symbol, amount });
  }
  return { rows, errors };
}

export async function getDefaultPortfolioId(userId: number): Promise<number> {
  const rows = await query<{ id: number }>(
    "SELECT id FROM portfolios WHERE user_id = $1 ORDER BY id LIMIT 1",
    [userId]
  );
  if (rows.length > 0) return rows[0].id;
  const created = await query<{ id: number }>(
    "INSERT INTO portfolios (user_id) VALUES ($1) RETURNING id",
    [userId]
  );
  return created[0].id;
}

export async function upsertHolding(sourceId: number, assetId: string, symbol: string, amount: number) {
  await query(
    `INSERT INTO holdings (source_id, asset_id, symbol, amount, updated_at)
     VALUES ($1, $2, $3, $4, now())
     ON CONFLICT (source_id, asset_id)
     DO UPDATE SET amount = EXCLUDED.amount, updated_at = now()`,
    [sourceId, assetId, symbol, amount]
  );
}

export interface ValuedHolding {
  assetId: string;
  symbol: string;
  amount: number;
  priceUsd: number;
  valueUsd: number;
  change24h: number;
  pctOfPortfolio: number;
  sourceId: number;
  sourceLabel: string;
  sourceKind: string;
}

export interface PortfolioView {
  portfolioId: number;
  totalValueUsd: number;
  sources: Array<{ id: number; kind: string; label: string }>;
  holdings: ValuedHolding[];
}

export async function getPortfolioView(userId: number): Promise<PortfolioView> {
  const portfolioId = await getDefaultPortfolioId(userId);

  const sources = await query<{ id: number; kind: string; label: string }>(
    "SELECT id, kind, label FROM sources WHERE portfolio_id = $1 ORDER BY id",
    [portfolioId]
  );

  const raw = await query<{
    source_id: number; asset_id: string; symbol: string; amount: string;
    label: string; kind: string;
  }>(
    `SELECT h.source_id, h.asset_id, h.symbol, h.amount, s.label, s.kind
     FROM holdings h JOIN sources s ON s.id = h.source_id
     WHERE s.portfolio_id = $1
     ORDER BY h.asset_id`,
    [portfolioId]
  );

  const ids = [...new Set(raw.map(r => r.asset_id))];
  const prices = await getPrices(ids);

  let total = 0;
  const holdings: ValuedHolding[] = raw.map(r => {
    const p = prices[r.asset_id] ?? { usd: 0 };
    const amount = Number(r.amount);
    const priceUsd = p.usd ?? 0;
    const valueUsd = amount * priceUsd;
    total += valueUsd;
    return {
      assetId: r.asset_id,
      symbol: r.symbol,
      amount,
      priceUsd,
      valueUsd,
      change24h: (p as Record<string, number>)["usd_24h_change"] ?? 0,
      pctOfPortfolio: 0, // filled below once total is known
      sourceId: r.source_id,
      sourceLabel: r.label,
      sourceKind: r.kind,
    };
  });
  for (const h of holdings) {
    h.pctOfPortfolio = total > 0 ? (h.valueUsd / total) * 100 : 0;
  }
  holdings.sort((a, b) => b.valueUsd - a.valueUsd);

  return { portfolioId, totalValueUsd: total, sources, holdings };
}
