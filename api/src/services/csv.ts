/**
 * CSV parsing for exchange-holdings import.
 * Extracted in Week 7 so it can be unit-tested without a database.
 */

export const SYMBOL_MAP: Record<string, { id: string; symbol: string }> = {
  BTC: { id: "bitcoin", symbol: "BTC" }, ETH: { id: "ethereum", symbol: "ETH" },
  SOL: { id: "solana", symbol: "SOL" }, USDT: { id: "tether", symbol: "USDT" },
  USDC: { id: "usd-coin", symbol: "USDC" }, BNB: { id: "binancecoin", symbol: "BNB" },
  XRP: { id: "ripple", symbol: "XRP" }, ADA: { id: "cardano", symbol: "ADA" },
  DOGE: { id: "dogecoin", symbol: "DOGE" }, AVAX: { id: "avalanche-2", symbol: "AVAX" },
  DOT: { id: "polkadot", symbol: "DOT" }, LINK: { id: "chainlink", symbol: "LINK" },
  MATIC: { id: "matic-network", symbol: "MATIC" }, LTC: { id: "litecoin", symbol: "LTC" },
  UNI: { id: "uniswap", symbol: "UNI" }, ATOM: { id: "cosmos", symbol: "ATOM" },
  ARB: { id: "arbitrum", symbol: "ARB" }, OP: { id: "optimism", symbol: "OP" },
  WBTC: { id: "wrapped-bitcoin", symbol: "WBTC" }, DAI: { id: "dai", symbol: "DAI" },
  SHIB: { id: "shiba-inu", symbol: "SHIB" },
};

export interface CsvRow { assetId: string; symbol: string; amount: number; }
export interface CsvParseResult { rows: CsvRow[]; errors: string[]; }

const MAX_LINES = 500; // guardrail: a holdings CSV is small by nature

export function parseHoldingsCsv(text: string): CsvParseResult {
  const rows: CsvRow[] = [];
  const errors: string[] = [];
  const seen = new Map<string, number>();

  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0);
  if (lines.length > MAX_LINES) {
    return { rows: [], errors: [`File has too many rows (max ${MAX_LINES})`] };
  }

  for (let i = 0; i < lines.length; i++) {
    const parts = lines[i].split(",").map(p => p.trim());
    if (parts.length < 2) { errors.push(`Line ${i + 1}: expected "symbol,amount"`); continue; }

    const symbol = parts[0].toUpperCase();
    if (i === 0 && symbol === "SYMBOL") continue; // optional header

    const mapped = SYMBOL_MAP[symbol];
    if (!mapped) { errors.push(`Line ${i + 1}: unsupported symbol "${symbol.slice(0, 20)}"`); continue; }

    const amount = Number(parts[1]);
    if (!Number.isFinite(amount) || amount < 0) {
      errors.push(`Line ${i + 1}: invalid amount "${parts[1].slice(0, 20)}"`); continue;
    }
    seen.set(mapped.id, (seen.get(mapped.id) ?? 0) + amount);
  }

  for (const [assetId, amount] of seen) {
    const entry = Object.values(SYMBOL_MAP).find(m => m.id === assetId)!;
    rows.push({ assetId, symbol: entry.symbol, amount });
  }
  return { rows, errors };
}
