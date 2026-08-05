import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  getPortfolio, getRiskMetrics, getTrend,
  PortfolioView, RiskMetrics, TrendResult,
} from "../api/client";
import Layout from "../components/Layout";
import { AllocationDonut, ValueAreaChart, VolatilityTrendChart, AllocationSlice } from "../components/Charts";

const fmtUsd = (n: number) =>
  n.toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 2 });

const fmtUsdCompact = (n: number) =>
  Math.abs(n) >= 1000
    ? n.toLocaleString(undefined, { style: "currency", currency: "USD", notation: "compact", maximumFractionDigits: 2 })
    : fmtUsd(n);

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

function Panel({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl bg-white border border-slate-200 p-5">
      <div className="mb-3">
        <h2 className="text-sm font-semibold text-slate-700">{title}</h2>
        {subtitle && <p className="text-xs text-slate-400 mt-0.5">{subtitle}</p>}
      </div>
      {children}
    </div>
  );
}

export default function Dashboard() {
  const [risk, setRisk] = useState<RiskMetrics | null>(null);
  const [portfolio, setPortfolio] = useState<PortfolioView | null>(null);
  const [trend, setTrend] = useState<TrendResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const load = () => {
      getRiskMetrics().then(m => active && setRisk(m)).catch(e => active && setError((e as Error).message));
      getPortfolio().then(p => active && setPortfolio(p)).catch(() => {});
      getTrend(30, 7).then(t => active && setTrend(t)).catch(() => {});
    };
    load();
    const id = setInterval(load, 60_000);
    return () => { active = false; clearInterval(id); };
  }, []);

  const vol = risk ? volatilityLabel(risk.volatilityAnnualized) : null;
  const hasHoldings = !!risk && risk.totalValueUsd > 0;

  // Aggregate holdings by asset for the donut (a portfolio can hold one asset
  // across several sources — the chart should show one slice per asset).
  const allocation: AllocationSlice[] = (() => {
    if (!portfolio || portfolio.totalValueUsd <= 0) return [];
    const byAsset = new Map<string, { symbol: string; valueUsd: number }>();
    for (const h of portfolio.holdings) {
      const prev = byAsset.get(h.assetId);
      byAsset.set(h.assetId, { symbol: h.symbol, valueUsd: (prev?.valueUsd ?? 0) + h.valueUsd });
    }
    return [...byAsset.values()]
      .map(a => ({ ...a, pct: (a.valueUsd / portfolio.totalValueUsd) * 100 }))
      .sort((a, b) => b.valueUsd - a.valueUsd);
  })();

  return (
    <Layout title="Dashboard">
      {error && <p className="text-sm text-red-600 mb-4">{error}</p>}

      {/* Stat cards */}
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
          sub={risk && risk.assetsIncluded > 0 ? `annualized · ${risk.assetsIncluded} assets · 30d` : undefined}
        >
          {risk && risk.assetsIncluded > 0
            ? <span className={vol!.cls}>{(risk.volatilityAnnualized * 100).toFixed(1)}% · {vol!.label}</span>
            : "—"}
        </StatCard>
        <StatCard
          label="Concentration Rating"
          sub={risk && risk.totalValueUsd > 0 ? `HHI ${risk.concentrationHhi.toFixed(2)}` : undefined}
        >
          {risk && risk.totalValueUsd > 0
            ? <span className={ratingColor(risk.concentrationRating)}>{risk.concentrationRating}</span>
            : "—"}
        </StatCard>
      </div>

      {!hasHoldings && risk && (
        <p className="text-sm text-slate-400 mb-6">
          Add holdings on the <Link to="/portfolio" className="text-teal-600">Portfolio page</Link> to
          unlock risk metrics and charts.
        </p>
      )}

      {hasHoldings && (
        <>
          <p className="text-xs text-slate-400 mb-5">
            Metrics computed by the Python risk engine from your holdings + 30-day price history ·{" "}
            <Link to="/portfolio" className="text-teal-600">Manage portfolio →</Link>
          </p>

          {/* Charts */}
          <div className="grid gap-5 lg:grid-cols-2 mb-5">
            <Panel title="Allocation by Asset" subtitle="Share of total portfolio value">
              <AllocationDonut data={allocation} />
            </Panel>

            <Panel
              title="Portfolio Value Over Time"
              subtitle={trend?.note ?? "Last 30 days"}
            >
              <ValueAreaChart data={trend?.points ?? []} />
            </Panel>
          </div>

          <Panel
            title="Volatility Trend"
            subtitle={`Rolling ${trend?.window ?? 7}-day annualized volatility of your portfolio value`}
          >
            <VolatilityTrendChart data={trend?.points ?? []} />
          </Panel>

          <div className="mt-5 flex flex-wrap gap-3 text-sm">
            <Link to="/risk" className="text-teal-600 font-medium">Run a drawdown simulation →</Link>
            <Link to="/alerts" className="text-teal-600 font-medium">Set up alerts →</Link>
          </div>
        </>
      )}
    </Layout>
  );
}
