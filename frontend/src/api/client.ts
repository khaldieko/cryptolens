const BASE = "/api";

function authHeaders(): Record<string, string> {
  const token = localStorage.getItem("cl_token");
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...authHeaders(),
      ...(options.headers ?? {}),
    },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as { error?: string }).error ?? `Request failed (${res.status})`);
  return body as T;
}

export interface PriceMap {
  [assetId: string]: { usd: number; usd_24h_change?: number };
}

export const getPrices = (ids: string[]) =>
  api<{ prices: PriceMap }>(`/prices?ids=${ids.join(",")}`);

export const login = (email: string, password: string) =>
  api<{ token: string }>("/auth/login", { method: "POST", body: JSON.stringify({ email, password }) });

export const register = (email: string, password: string) =>
  api<{ token: string }>("/auth/register", { method: "POST", body: JSON.stringify({ email, password }) });

// ---- Week 3: portfolio ----

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

export const getPortfolio = () => api<PortfolioView>("/portfolio");

export const addWallet = (address: string) =>
  api<{ sourceId: number; address: string; eth: number }>("/portfolio/wallets", {
    method: "POST",
    body: JSON.stringify({ address }),
  });

export const importCsv = (filename: string, csv: string) =>
  api<{ sourceId: number; imported: number; skipped: string[] }>("/portfolio/csv", {
    method: "POST",
    body: JSON.stringify({ filename, csv }),
  });

export const syncWallets = () =>
  api<{ refreshed: number; total: number }>("/portfolio/sync", { method: "POST" });

export const removeSource = (id: number) =>
  api<{ deleted: number }>(`/portfolio/sources/${id}`, { method: "DELETE" });

// ---- Week 4: risk metrics ----

export interface RiskMetrics {
  totalValueUsd: number;
  change24hPct: number;
  volatilityAnnualized: number;
  concentrationHhi: number;
  concentrationRating: "Low" | "Moderate" | "High";
  assetsIncluded: number;
  computedAt: string;
}

export const getRiskMetrics = () => api<RiskMetrics>("/risk/metrics");
