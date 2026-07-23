import { config } from "../config";
import { cached } from "../redis";

/**
 * Read-only wallet reads for a public address via Etherscan API V2.
 * No private keys, no signing — CryptoLens never holds credentials.
 *
 * Week 5: in addition to native ETH, we read a curated set of ERC-20 token
 * balances so a wallet reflects its real holdings (e.g. USDC, USDT), not just ETH.
 */

const WEI_PER_ETH = 1e18;
const ETHERSCAN_V2 = "https://api.etherscan.io/v2/api?chainid=1";

export function isValidEthAddress(address: string): boolean {
  return /^0x[a-fA-F0-9]{40}$/.test(address);
}

/**
 * Curated ERC-20 tokens to check on Ethereum mainnet.
 * assetId = CoinGecko id (for pricing); decimals per token contract.
 */
export const ERC20_TOKENS: Array<{
  assetId: string; symbol: string; contract: string; decimals: number;
}> = [
  { assetId: "usd-coin",   symbol: "USDC", contract: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48", decimals: 6 },
  { assetId: "tether",     symbol: "USDT", contract: "0xdac17f958d2ee523a2206206994597c13d831ec7", decimals: 6 },
  { assetId: "dai",        symbol: "DAI",  contract: "0x6b175474e89094c44da98b954eedeac495271d0f", decimals: 18 },
  { assetId: "chainlink",  symbol: "LINK", contract: "0x514910771af9ca656af840dff83e8264ecf986ca", decimals: 18 },
  { assetId: "uniswap",    symbol: "UNI",  contract: "0x1f9840a85d5af5bf1d1762f925bdaddc4201f984", decimals: 18 },
  { assetId: "wrapped-bitcoin", symbol: "WBTC", contract: "0x2260fac5e5542a773aa44fbcfedf7c193bc2c599", decimals: 8 },
  { assetId: "matic-network", symbol: "MATIC", contract: "0x7d1afa7b718fb893db30a3abc0cfc608aacfebb0", decimals: 18 },
  { assetId: "shiba-inu",  symbol: "SHIB", contract: "0x95ad61b0a150d79219dcf64e1e6cc01f0b64c4ce", decimals: 18 },
];

interface EtherscanResponse {
  status: string;
  message: string;
  result: string;
}

async function esFetch(url: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) throw Object.assign(new Error(`Etherscan error ${res.status}`), { status: res.status });
  const body = (await res.json()) as EtherscanResponse;
  if (body.status !== "1") {
    // Balance calls can return status "0" with a numeric "0" result — that's valid.
    if (/^\d+$/.test(body.result)) return body.result;
    throw Object.assign(new Error(`Etherscan: ${body.result || body.message || "request failed"}`), { status: 502 });
  }
  return body.result;
}

export async function getEthBalance(address: string): Promise<{ address: string; eth: number }> {
  if (!isValidEthAddress(address)) {
    throw Object.assign(new Error("Invalid Ethereum address format"), { status: 400 });
  }
  const key = `es:balance:${address.toLowerCase()}`;
  return cached(key, 120, async () => {
    const url = `${ETHERSCAN_V2}&module=account&action=balance&address=${address}&tag=latest&apikey=${config.etherscanApiKey}`;
    const raw = await esFetch(url);
    return { address, eth: Number(raw) / WEI_PER_ETH };
  });
}

export interface WalletHolding {
  assetId: string;
  symbol: string;
  amount: number;
}

/**
 * Full read of a wallet: native ETH + curated ERC-20 balances.
 * Only non-zero balances are returned. Token reads are best-effort — a single
 * token failure doesn't abort the whole wallet (it's skipped).
 */
export async function getWalletHoldings(address: string): Promise<WalletHolding[]> {
  if (!isValidEthAddress(address)) {
    throw Object.assign(new Error("Invalid Ethereum address format"), { status: 400 });
  }
  const key = `es:wallet:${address.toLowerCase()}`;
  return cached(key, 120, async () => {
    const holdings: WalletHolding[] = [];

    const ethRaw = await esFetch(
      `${ETHERSCAN_V2}&module=account&action=balance&address=${address}&tag=latest&apikey=${config.etherscanApiKey}`
    );
    const eth = Number(ethRaw) / WEI_PER_ETH;
    if (eth > 0) holdings.push({ assetId: "ethereum", symbol: "ETH", amount: eth });

    for (const t of ERC20_TOKENS) {
      try {
        const raw = await esFetch(
          `${ETHERSCAN_V2}&module=account&action=tokenbalance` +
          `&contractaddress=${t.contract}&address=${address}&tag=latest&apikey=${config.etherscanApiKey}`
        );
        const amount = Number(raw) / 10 ** t.decimals;
        if (amount > 0) holdings.push({ assetId: t.assetId, symbol: t.symbol, amount });
      } catch {
        // skip this token on failure; the rest of the wallet still loads
      }
    }
    return holdings;
  });
}
