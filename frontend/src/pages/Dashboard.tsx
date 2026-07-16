import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { getPrices, getPortfolio, PriceMap } from "../api/client";
import Layout from "../components/Layout";

const TRACKED = ["bitcoin", "ethereum", "solana"];

export default function Dashboard() {
  const [prices, setPrices] = useState<PriceMap | null>(null);
  const [total, setTotal] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const load = () => {
      getPrices(TRACKED)
        .then(r => active && setPrices(r.prices))
        .catch(e => active && setError((e as Error).message));
      getPortfolio()
        .then(v => active && setTotal(v.totalValueUsd))
        .catch(() => {});
    };
    load();
    const id = setInterval(load, 60_000);
    return () => { active = false; clearInterval(id); };
  }, []);

  return (
    <Layout title="Dashboard">
      {total !== null && (
        <div className="rounded-xl bg-slate-50 border border-slate-200 px-5 py-4 mb-6 inline-block">
          <p className="text-xs text-slate-500">Portfolio Total</p>
          <p className="text-2xl font-bold text-slate-800">
            {total.toLocaleString(undefined, { style: "currency", currency: "USD" })}
          </p>
          <Link to="/portfolio" className="text-xs text-teal-600">Manage portfolio →</Link>
        </div>
      )}

      <h2 className="text-sm font-semibold text-slate-600 mb-1">Live Prices</h2>
      <p className="text-xs text-slate-400 mb-4">Live CoinGecko data via the API's Redis cache (60s TTL).</p>

      {error && <p className="text-sm text-red-600 mb-4">{error}</p>}
      {!prices && !error && <p className="text-sm text-slate-400">Loading prices…</p>}

      {prices && (
        <table className="w-full max-w-xl text-sm border-t border-slate-200">
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
    </Layout>
  );
}
