import { config } from "../config";
import { cached } from "../redis";

/**
 * Read-only ETH balance for a public address.
 * No private keys, no signing — CryptoLens never holds credentials.
 */

const WEI_PER_ETH = 1e18;

export function isValidEthAddress(address: string): boolean {
  return /^0x[a-fA-F0-9]{40}$/.test(address);
}

export async function getEthBalance(address: string): Promise<{ address: string; eth: number }> {
  if (!isValidEthAddress(address)) {
    throw Object.assign(new Error("Invalid Ethereum address format"), { status: 400 });
  }
  const key = `es:balance:${address.toLowerCase()}`;
  return cached(key, 120, async () => {
    const url = `https://api.etherscan.io/v2/api?chainid=1&module=account&action=balance&address=${address}&tag=latest&apikey=${config.etherscanApiKey}`;
    const res = await fetch(url);
    if (!res.ok) throw Object.assign(new Error(`Etherscan error ${res.status}`), { status: res.status });
    const body = (await res.json()) as { status: string; message: string; result: string };
    if (body.status !== "1") {
      throw Object.assign(new Error(`Etherscan: ${body.result || body.message || "request failed"}`), { status: 502 });
    }
    return { address, eth: Number(body.result) / WEI_PER_ETH };
  });
}
