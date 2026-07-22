import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { getPrices, getRiskMetrics, PriceMap, RiskMetrics } from "../api/client";
import Layout from "../components/Layout";

const TRACKED = ["bitcoin", "ethereum", "solana"];

const fmtUsd = (n: number) =>
  n.toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 2 });

/** Compact display for big portfolios: $1.23K / $4.56M / $170.7B — keeps stat cards from overflowing. */
const fmtUsdCompact = (n: number) => {
  const abs = Math.abs(n);
  if (abs >= 1000) {
    return n.toLocaleString(undefined, {
      style: "currency", currency: "USD",
      notation: "compact", maximumFractionDigits: 2,
    });
  }
  return fmtUsd(n);
};

function ratingColor(r: RiskMetrics["concentrationRating"]) {
  return r === "Low" ? "text-emerald-600" : r === "Moderate" ? "text-amber-600" : "text-red-600";
}

function volatilityLabel(v: number) {
  if (v < 0.3) return { label: "Calm", cls: "text-emerald-600" };
  if (v < 0.7) return { label: "Elevated", cls: "text-amber-600" };
  return { label: "Extreme", cls: "text-red-600" };
}

function StatCard({
  label, children, sub, title,
}: { label: string; children: React.ReactNode; sub?: string; title?: string }) {
  return (
    <div className="rounded-xl bg-slate-50 border border-slate-200 px-5 py-4 min-w-44 flex-1 overflow-hidden">
      <p className="text-xs text-slate-500">{label}</p>
      <div className="text-2xl font-bold text-slate-800 truncate" title={title}>{children}</div>
      {sub && <p className="text-xs text-slate-400 mt-1 truncate">{sub}</p>}
    </div>
  );
}

export default function Dashboard() {
  const [prices, setPrices] = useState<PriceMap | null>(null);
  const [risk, setRisk] = useState<RiskMetrics | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const load = () => {
      getPrices(TRACKED)
        .then(r => active && setPrices(r.prices))
        .catch(e => active && setError((e as Error).message));
      getRiskMetrics()
        .then(m => active && setRisk(m))
        .catch(e => active && setError((e as Error).message));
    };
    load();
    const id = setInterval(load, 60_000);
    return () => { active = false; clearInterval(id); };
  }, []);

  const vol = risk ? volatilityLabel(risk.volatilityAnnualized) : null;

  return (
    <Layout title="Dashboard">
      {error && <p className="text-sm text-red-600 mb-4">{error}</p>}

      {/* Week 4: the four risk stat cards from the Week 1 wireframe */}
      <div className="flex flex-wrap gap-4 mb-2">
        <StatCard
          label="Total Value (USD)"
          title={risk ? fmtUsd(risk.totalValueUsd) : undefined}
          sub={risk && risk.totalValueUsd >= 1000 ? fmtUsd(risk.totalValueUsd) : undefined}
        >
          {risk ? fmtUsdCompact(risk.totalValueUsd) : "—"}
        </StatCard>
        <StatCard label="24h Change">
          {risk ? (
            <span className={risk.change24hPct >= 0 ? "text-emerald-600" : "text-red-600"}>
              {risk.change24hPct >= 0 ? "+" : ""}{risk.change24hPct.toFixed(2)}%
            </span>
          ) : "—"}
        </StatCard>
        <StatCard
          label="Volatility Score"
          sub={risk && risk.assetsIncluded > 0 ? `annualized, ${risk.assetsIncluded} assets, 30d history` : undefined}
        >
          {risk ? (
            risk.assetsIncluded > 0 ? (
              <span className={vol!.cls}>{(risk.volatilityAnnualized * 100).toFixed(1)}% · {vol!.label}</span>
            ) : "—"
          ) : "—"}
        </StatCard>
        <StatCard
          label="Concentration Rating"
          sub={risk && risk.totalValueUsd > 0 ? `HHI ${risk.concentrationHhi.toFixed(2)}` : undefined}
        >
          {risk && risk.totalValueUsd > 0 ? (
            <span className={ratingColor(risk.concentrationRating)}>{risk.concentrationRating}</span>
          ) : "—"}
        </StatCard>
      </div>

      {risk && risk.totalValueUsd === 0 && (
        <p className="text-sm text-slate-400 mb-6">
          Add holdings on the <Link to="/portfolio" className="text-teal-600">Portfolio page</Link> to
          unlock risk metrics.
        </p>
      )}
      {risk && risk.totalValueUsd > 0 && (
        <p className="text-xs text-slate-400 mb-6">
          Metrics computed by the Python risk engine from your holdings + 30-day price history ·{" "}
          <Link to="/portfolio" className="text-teal-600">Manage portfolio →</Link>
        </p>
      )}

      <h2 className="text-sm font-semibold text-slate-600 mb-1">Live Prices</h2>
      <p className="text-xs text-slate-400 mb-4">Live CoinGecko data via the API's Redis cache (60s TTL).</p>

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
