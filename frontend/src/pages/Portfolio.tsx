import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import {
  PortfolioView, getPortfolio, addWallet, importCsv, removeSource, syncWallets,
} from "../api/client";
import Layout from "../components/Layout";

const fmtUsd = (n: number) =>
  n.toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 2 });

/** Compact display for large totals so the summary card never overflows. */
const fmtUsdCompact = (n: number) =>
  Math.abs(n) >= 1000
    ? n.toLocaleString(undefined, { style: "currency", currency: "USD", notation: "compact", maximumFractionDigits: 2 })
    : fmtUsd(n);

const shorten = (label: string) =>
  label.startsWith("0x") && label.length > 12 ? `${label.slice(0, 6)}...${label.slice(-4)}` : label;

export default function Portfolio() {
  const [view, setView] = useState<PortfolioView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [address, setAddress] = useState("");
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(() => {
    getPortfolio().then(setView).catch(e => setError((e as Error).message));
  }, []);

  useEffect(load, [load]);

  async function run(label: string, fn: () => Promise<unknown>) {
    setBusy(true); setError(null); setNotice(null);
    try {
      await fn();
      setNotice(label);
      load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function onAddWallet(e: FormEvent) {
    e.preventDefault();
    const addr = address.trim();
    if (!addr) return;
    run("Wallet added and synced", async () => { await addWallet(addr); setAddress(""); });
  }

  function onCsvPicked(file: File | undefined) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () =>
      run(`Imported ${file.name}`, async () => {
        const res = await importCsv(file.name, String(reader.result ?? ""));
        if (res.skipped.length > 0) setNotice(`Imported ${res.imported} rows — skipped: ${res.skipped.join("; ")}`);
      });
    reader.readAsText(file);
    if (fileRef.current) fileRef.current.value = "";
  }

  return (
    <Layout title="Portfolio">
      {/* actions */}
      <div className="flex flex-wrap gap-3 mb-5">
        <form onSubmit={onAddWallet} className="flex gap-2">
          <input
            value={address}
            onChange={e => setAddress(e.target.value)}
            placeholder="0x... Ethereum address (read-only)"
            className="w-72 rounded-lg border border-slate-300 px-3 py-2 text-sm"
          />
          <button
            type="submit"
            disabled={busy}
            className="rounded-lg bg-[#0B1B33] text-white text-sm font-semibold px-4 disabled:opacity-60"
          >
            + Add Wallet
          </button>
        </form>

        <input
          ref={fileRef}
          type="file"
          accept=".csv,text/csv"
          className="hidden"
          onChange={e => onCsvPicked(e.target.files?.[0])}
        />
        <button
          onClick={() => fileRef.current?.click()}
          disabled={busy}
          className="rounded-lg border border-slate-300 text-sm font-semibold px-4 py-2 text-slate-700 disabled:opacity-60"
        >
          Import CSV
        </button>
        <button
          onClick={() => run("Wallet balances refreshed", syncWallets)}
          disabled={busy}
          className="rounded-lg border border-slate-300 text-sm font-semibold px-4 py-2 text-slate-700 disabled:opacity-60"
        >
          Sync
        </button>
      </div>

      <p className="text-xs text-slate-400 mb-4">
        CSV format: <code>symbol,amount</code> per line (e.g. <code>BTC,0.5</code>). CryptoLens is
        read-only — public addresses only, never exchange API keys.
      </p>

      {error && <p className="text-sm text-red-600 mb-3">{error}</p>}
      {notice && <p className="text-sm text-emerald-700 mb-3">{notice}</p>}

      {/* summary + sources */}
      {view && (
        <>
          <div className="flex flex-wrap gap-4 mb-6">
            <div className="rounded-xl bg-slate-50 border border-slate-200 px-5 py-4 max-w-xs overflow-hidden">
              <p className="text-xs text-slate-500">Portfolio Total</p>
              <p className="text-2xl font-bold text-slate-800 truncate" title={fmtUsd(view.totalValueUsd)}>
                {fmtUsdCompact(view.totalValueUsd)}
              </p>
              {view.totalValueUsd >= 1000 && (
                <p className="text-xs text-slate-400 truncate">{fmtUsd(view.totalValueUsd)}</p>
              )}
            </div>
            <div className="rounded-xl bg-slate-50 border border-slate-200 px-5 py-4 flex-1 min-w-64">
              <p className="text-xs text-slate-500 mb-2">Connected Sources</p>
              <div className="flex flex-wrap gap-2">
                {view.sources.length === 0 && (
                  <span className="text-sm text-slate-400">None yet — add a wallet or import a CSV</span>
                )}
                {view.sources.map(s => (
                  <span
                    key={s.id}
                    className="inline-flex items-center gap-2 rounded-full bg-teal-50 border border-teal-500 px-3 py-1 text-xs text-[#0B1B33]"
                  >
                    {s.kind === "wallet" ? shorten(s.label) : s.label}
                    <button
                      onClick={() => run("Source removed", () => removeSource(s.id))}
                      className="text-slate-400 hover:text-red-600"
                      title="Remove source"
                    >
                      ✕
                    </button>
                  </span>
                ))}
              </div>
            </div>
          </div>

          {/* holdings table */}
          <table className="w-full text-sm border-t border-slate-200">
            <thead>
              <tr className="text-left text-slate-500">
                <th className="py-2">Asset</th>
                <th className="py-2">Source</th>
                <th className="py-2 text-right">Amount</th>
                <th className="py-2 text-right">Price</th>
                <th className="py-2 text-right">Value (USD)</th>
                <th className="py-2 text-right">% of Portfolio</th>
              </tr>
            </thead>
            <tbody>
              {view.holdings.length === 0 && (
                <tr><td colSpan={6} className="py-6 text-center text-slate-400">No holdings yet</td></tr>
              )}
              {view.holdings.map((h, i) => (
                <tr key={`${h.sourceId}-${h.assetId}-${i}`} className="border-t border-slate-100">
                  <td className="py-2 font-medium">{h.symbol}</td>
                  <td className="py-2 text-slate-500">{shorten(h.sourceLabel)}</td>
                  <td className="py-2 text-right whitespace-nowrap" title={String(h.amount)}>{h.amount.toLocaleString(undefined, { maximumFractionDigits: 4 })}</td>
                  <td className="py-2 text-right">{fmtUsd(h.priceUsd)}</td>
                  <td className="py-2 text-right font-medium whitespace-nowrap" title={fmtUsd(h.valueUsd)}>{fmtUsdCompact(h.valueUsd)}</td>
                  <td className="py-2 text-right">{h.pctOfPortfolio.toFixed(1)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
      {!view && !error && <p className="text-sm text-slate-400">Loading portfolio…</p>}
    </Layout>
  );
}
