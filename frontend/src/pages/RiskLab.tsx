import { useEffect, useState, useCallback } from "react";
import { Link } from "react-router-dom";
import { runSimulation, SimulationResult } from "../api/client";
import Layout from "../components/Layout";

const fmtUsd = (n: number) =>
  Math.abs(n) >= 1000
    ? n.toLocaleString(undefined, { style: "currency", currency: "USD", notation: "compact", maximumFractionDigits: 2 })
    : n.toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 2 });

const PRESETS = [5, 10, 20, 30, 50];

export default function RiskLab() {
  const [drop, setDrop] = useState(20);
  const [result, setResult] = useState<SimulationResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const simulate = useCallback((pct: number) => {
    setLoading(true);
    setError(null);
    runSimulation(pct)
      .then(setResult)
      .catch(e => setError((e as Error).message))
      .finally(() => setLoading(false));
  }, []);

  // Run once on mount, and debounce while dragging the slider
  useEffect(() => {
    const id = setTimeout(() => simulate(drop), 250);
    return () => clearTimeout(id);
  }, [drop, simulate]);

  const empty = result && result.totalBefore === 0;
  const worstAsset = result?.perAsset[0];

  return (
    <Layout title="Risk Lab">
      <p className="text-sm text-slate-500 mb-6 max-w-2xl">
        Drawdown simulator — model how your portfolio would respond to a market drop.
        Each asset is scaled by its <span className="font-medium">beta</span> to the market
        (BTC), so volatile assets fall harder and stablecoins barely move.
      </p>

      {empty && (
        <p className="text-sm text-slate-400">
          Add holdings on the <Link to="/portfolio" className="text-teal-600">Portfolio page</Link> to
          run a simulation.
        </p>
      )}

      {!empty && (
        <>
          {/* Scenario control */}
          <div className="rounded-xl bg-slate-50 border border-slate-200 p-6 mb-6 max-w-2xl">
            <div className="flex items-baseline justify-between mb-2">
              <span className="text-sm font-medium text-slate-600">Market scenario</span>
              <span className="text-2xl font-bold text-[#0B1B33]">−{drop}%</span>
            </div>
            <input
              type="range"
              min={1}
              max={60}
              value={drop}
              onChange={e => setDrop(Number(e.target.value))}
              className="w-full accent-teal-600"
            />
            <div className="flex gap-2 mt-3">
              {PRESETS.map(p => (
                <button
                  key={p}
                  onClick={() => setDrop(p)}
                  className={`px-3 py-1 rounded-full text-xs font-semibold border ${
                    drop === p ? "bg-teal-50 border-teal-500 text-[#0B1B33]" : "border-slate-300 text-slate-500"
                  }`}
                >
                  −{p}%
                </button>
              ))}
            </div>
          </div>

          {error && <p className="text-sm text-red-600 mb-4">{error}</p>}

          {/* Headline projection */}
          {result && result.totalBefore > 0 && (
            <div className="flex flex-wrap gap-4 mb-6">
              <div className="rounded-xl bg-slate-50 border border-slate-200 px-5 py-4 min-w-48">
                <p className="text-xs text-slate-500">Value Now</p>
                <p className="text-2xl font-bold text-slate-800">{fmtUsd(result.totalBefore)}</p>
              </div>
              <div className="rounded-xl bg-slate-50 border border-slate-200 px-5 py-4 min-w-48">
                <p className="text-xs text-slate-500">Projected Value</p>
                <p className="text-2xl font-bold text-slate-800">{fmtUsd(result.totalAfter)}</p>
              </div>
              <div className="rounded-xl bg-red-50 border border-red-200 px-5 py-4 min-w-48">
                <p className="text-xs text-red-500">Projected Loss</p>
                <p className="text-2xl font-bold text-red-600">
                  {fmtUsd(result.projectedLoss)}{" "}
                  <span className="text-base">({result.projectedLossPct.toFixed(1)}%)</span>
                </p>
              </div>
            </div>
          )}

          {loading && !result && <p className="text-sm text-slate-400">Running simulation…</p>}

          {/* Per-asset impact */}
          {result && result.perAsset.length > 0 && (
            <div className="max-w-3xl">
              <h2 className="text-sm font-semibold text-slate-600 mb-3">Per-Asset Impact</h2>
              <div className="space-y-2">
                {result.perAsset.map(a => {
                  const pct = Math.min(100, Math.abs(a.changePct));
                  return (
                    <div key={a.assetId} className="flex items-center gap-3 text-sm">
                      <span className="w-24 font-medium capitalize truncate">{a.assetId}</span>
                      <span className="w-16 text-xs text-slate-400">β {a.beta.toFixed(2)}</span>
                      <div className="flex-1 bg-slate-100 rounded-full h-5 overflow-hidden">
                        <div
                          className={`h-5 ${a.changePct < 0 ? "bg-red-400" : "bg-emerald-400"}`}
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                      <span className={`w-16 text-right ${a.changePct < 0 ? "text-red-600" : "text-emerald-600"}`}>
                        {a.changePct.toFixed(1)}%
                      </span>
                      <span className="w-20 text-right text-slate-500">{fmtUsd(a.valueAfter)}</span>
                    </div>
                  );
                })}
              </div>
              {worstAsset && (
                <p className="text-xs text-slate-400 mt-4">
                  Biggest hit: <span className="font-medium capitalize">{worstAsset.assetId}</span>{" "}
                  (β {worstAsset.beta.toFixed(2)} — moves {worstAsset.beta > 1 ? "more" : "less"} than the market).
                  Simulations are estimates based on 30-day price behavior, not predictions.
                </p>
              )}
            </div>
          )}
        </>
      )}
    </Layout>
  );
}
