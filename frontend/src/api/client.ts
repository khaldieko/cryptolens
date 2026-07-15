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
