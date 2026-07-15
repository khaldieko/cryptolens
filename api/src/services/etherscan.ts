import { config } from "../config";
import { cached } from "../redis";

/**
 * Week 2 spike: read-only ETH balance for a public address.
 * No private keys, no signing — CryptoLens never holds credentials.
 */

const WEI_PER_ETH = 1e18;

export async function getEthBalance(address: string): Promise<{ address: string; eth: number }> {
  if (!/^0x[a-fA-F0-9]{40}$/.test(address)) {
    throw Object.assign(new Error("Invalid Ethereum address format"), { status: 400 });
  }
  const key = `es:balance:${address.toLowerCase()}`;
  return cached(key, 120, async () => {
    const url = `https://api.etherscan.io/api?module=account&action=balance&address=${address}&tag=latest&apikey=${config.etherscanApiKey}`;
    const res = await fetch(url);
    if (!res.ok) throw Object.assign(new Error(`Etherscan error ${res.status}`), { status: res.status });
    const body = (await res.json()) as { status: string; message: string; result: string };
    if (body.status !== "1") {
      throw Object.assign(new Error(`Etherscan: ${body.message || "request failed"}`), { status: 502 });
    }
    return { address, eth: Number(body.result) / WEI_PER_ETH };
  });
}
