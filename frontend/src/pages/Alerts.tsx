import { FormEvent, useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  AlertsView, AlertMetric, AlertCondition, AlertChannel,
  getAlerts, createAlert, toggleAlert, deleteAlert,
} from "../api/client";
import Layout from "../components/Layout";

const METRIC_LABEL: Record<AlertMetric, string> = {
  portfolio_volatility: "Portfolio volatility (%)",
  asset_pct: "Largest asset concentration (%)",
  portfolio_value: "Portfolio value ($)",
};

const metricUnit = (m: AlertMetric) => (m === "portfolio_value" ? "$" : "%");

function formatTriggered(iso: string) {
  const d = new Date(iso);
  return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

export default function Alerts() {
  const [view, setView] = useState<AlertsView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // form state
  const [metric, setMetric] = useState<AlertMetric>("portfolio_volatility");
  const [condition, setCondition] = useState<AlertCondition>("above");
  const [threshold, setThreshold] = useState("50");
  const [channel, setChannel] = useState<AlertChannel>("in_app");

  const load = useCallback(() => {
    getAlerts().then(setView).catch(e => setError((e as Error).message));
  }, []);

  useEffect(load, [load]);

  async function run(fn: () => Promise<unknown>) {
    setBusy(true); setError(null);
    try { await fn(); load(); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }

  function onCreate(e: FormEvent) {
    e.preventDefault();
    const t = Number(threshold);
    if (!Number.isFinite(t)) { setError("Threshold must be a number"); return; }
    run(() => createAlert(metric, condition, t, channel));
  }

  return (
    <Layout title="Alerts">
      {error && <p className="text-sm text-red-600 mb-4">{error}</p>}

      <div className="grid gap-6 lg:grid-cols-2 max-w-5xl">
        {/* Create rule */}
        <div className="rounded-xl bg-slate-50 border border-slate-200 p-5">
          <h2 className="text-sm font-semibold text-slate-700 mb-4">Create Rule</h2>
          <form onSubmit={onCreate} className="space-y-3">
            <label className="block">
              <span className="text-xs text-slate-500">Metric</span>
              <select
                value={metric}
                onChange={e => setMetric(e.target.value as AlertMetric)}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm bg-white"
              >
                {Object.entries(METRIC_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </label>

            <div className="flex gap-3">
              <label className="flex-1">
                <span className="text-xs text-slate-500">Condition</span>
                <select
                  value={condition}
                  onChange={e => setCondition(e.target.value as AlertCondition)}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm bg-white"
                >
                  <option value="above">above</option>
                  <option value="below">below</option>
                </select>
              </label>
              <label className="flex-1">
                <span className="text-xs text-slate-500">Threshold ({metricUnit(metric)})</span>
                <input
                  value={threshold}
                  onChange={e => setThreshold(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                />
              </label>
            </div>

            <div>
              <span className="text-xs text-slate-500">Deliver via</span>
              <div className="flex gap-2 mt-1">
                {(["in_app", "email"] as AlertChannel[]).map(c => (
                  <button
                    type="button"
                    key={c}
                    onClick={() => setChannel(c)}
                    className={`px-3 py-1.5 rounded-full text-xs font-semibold border ${
                      channel === c ? "bg-teal-50 border-teal-500 text-[#0B1B33]" : "border-slate-300 text-slate-500"
                    }`}
                  >
                    {c === "in_app" ? "In-app" : "Email"}
                  </button>
                ))}
              </div>
            </div>

            <button
              type="submit"
              disabled={busy}
              className="w-full py-2.5 rounded-lg bg-[#0B1B33] text-white font-semibold text-sm disabled:opacity-60"
            >
              Save rule
            </button>
          </form>
          <p className="text-xs text-slate-400 mt-3">
            Rules are checked every few minutes against fresh metrics. Email delivery
            requires an email provider to be configured; in-app always works.
          </p>
        </div>

        {/* Active rules */}
        <div className="rounded-xl bg-slate-50 border border-slate-200 p-5">
          <h2 className="text-sm font-semibold text-slate-700 mb-4">Active Rules</h2>
          {view && view.alerts.length === 0 && (
            <p className="text-sm text-slate-400">No rules yet — create one to get notified.</p>
          )}
          <div className="space-y-2">
            {view?.alerts.map(a => (
              <div key={a.id} className="flex items-center gap-3 bg-white rounded-lg border border-slate-200 px-3 py-2">
                <div className="flex-1 text-sm">
                  <span className="font-medium">{METRIC_LABEL[a.metric].replace(/ \(.*\)/, "")}</span>{" "}
                  <span className="text-slate-500">{a.condition}</span>{" "}
                  <span className="font-medium">{metricUnit(a.metric) === "$" ? "$" : ""}{a.threshold}{metricUnit(a.metric) === "%" ? "%" : ""}</span>
                  <span className="ml-2 text-xs text-slate-400">{a.channel === "email" ? "email" : "in-app"}</span>
                </div>
                <button
                  onClick={() => run(() => toggleAlert(a.id, !a.enabled))}
                  className={`text-xs font-semibold px-2 py-1 rounded ${a.enabled ? "text-emerald-600" : "text-slate-400"}`}
                  title={a.enabled ? "Enabled — click to pause" : "Paused — click to enable"}
                >
                  {a.enabled ? "On" : "Off"}
                </button>
                <button
                  onClick={() => run(() => deleteAlert(a.id))}
                  className="text-slate-400 hover:text-red-600 text-sm"
                  title="Delete rule"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Triggered history */}
      <div className="mt-6 max-w-5xl">
        <h2 className="text-sm font-semibold text-slate-700 mb-3">Triggered History</h2>
        {view && view.events.length === 0 && (
          <p className="text-sm text-slate-400">
            Nothing triggered yet. Set a rule near your current metrics (check the{" "}
            <Link to="/" className="text-teal-600">Dashboard</Link>) to see it fire.
          </p>
        )}
        {view && view.events.length > 0 && (
          <table className="w-full text-sm border-t border-slate-200">
            <thead>
              <tr className="text-left text-slate-500">
                <th className="py-2">Time</th>
                <th className="py-2">Alert</th>
                <th className="py-2 text-right">Value</th>
              </tr>
            </thead>
            <tbody>
              {view.events.map(ev => (
                <tr key={ev.id} className="border-t border-slate-100">
                  <td className="py-2 text-slate-500 whitespace-nowrap">{formatTriggered(ev.triggeredAt)}</td>
                  <td className="py-2">{ev.message}</td>
                  <td className="py-2 text-right whitespace-nowrap">
                    {ev.metric === "portfolio_value"
                      ? `$${ev.valueAtTrigger.toFixed(0)}`
                      : `${ev.valueAtTrigger.toFixed(1)}%`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </Layout>
  );
}
