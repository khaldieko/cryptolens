import { useEffect, useState } from "react";
import { getPrices, PriceMap } from "../api/client";
import { useAuth } from "../context/AuthContext";

const TRACKED = ["bitcoin", "ethereum", "solana"];

export default function Dashboard() {
  const [prices, setPrices] = useState<PriceMap | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { setToken } = useAuth();

  useEffect(() => {
    let active = true;
    const load = () =>
      getPrices(TRACKED)
        .then(r => active && setPrices(r.prices))
        .catch(e => active && setError((e as Error).message));
    load();
    const id = setInterval(load, 60_000); // matches API cache TTL
    return () => { active = false; clearInterval(id); };
  }, []);

  return (
    <div className="min-h-screen bg-white">
      <header className="bg-[#0B1B33] text-white px-6 py-4 flex items-center justify-between">
        <span className="font-bold text-lg">CryptoLens</span>
        <button onClick={() => setToken(null)} className="text-sm text-teal-300">Sign out</button>
      </header>

      <main className="max-w-3xl mx-auto p-6">
        <h1 className="text-xl font-bold text-slate-800 mb-1">Live Prices</h1>
        <p className="text-sm text-slate-500 mb-6">
          Week 2 skeleton — live CoinGecko data via the API's Redis cache (60s TTL).
        </p>

        {error && <p className="text-sm text-red-600 mb-4">{error}</p>}
        {!prices && !error && <p className="text-sm text-slate-400">Loading prices…</p>}

        {prices && (
          <table className="w-full text-sm border-t border-slate-200">
            <thead>
              <tr className="text-left text-slate-500">
                <th className="py-2">Asset</th>
                <th className="py-2">Price (USD)</th>
                <th className="py-2">24h</th>
              </tr>
            </thead>
            <tbody>
              {TRACKED.map(id => {
                const p = prices[id];
                if (!p) return null;
                const change = p.usd_24h_change ?? 0;
                return (
                  <tr key={id} className="border-t border-slate-100">
                    <td className="py-2 font-medium capitalize">{id}</td>
                    <td className="py-2">${p.usd.toLocaleString()}</td>
                    <td className={`py-2 ${change >= 0 ? "text-emerald-600" : "text-red-600"}`}>
                      {change.toFixed(2)}%
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </main>
    </div>
  );
}
