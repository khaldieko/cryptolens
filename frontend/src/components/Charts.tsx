import {
  PieChart, Pie, Cell, ResponsiveContainer, Tooltip,
  AreaChart, Area, XAxis, YAxis, CartesianGrid, LineChart, Line,
} from "recharts";

/**
 * Week 6 — Dashboard visuals.
 * Shared chart palette keeps the deep-navy / teal identity consistent with the
 * rest of the app, with enough hue separation to read at a glance.
 */
export const CHART_COLORS = [
  "#0B1B33", "#0FA3A3", "#3DDC97", "#5B7089", "#7FB3D5",
  "#F5B041", "#AF7AC5", "#48C9B0", "#E59866", "#85929E",
];

const usdCompact = (n: number) =>
  Math.abs(n) >= 1000
    ? n.toLocaleString(undefined, { style: "currency", currency: "USD", notation: "compact", maximumFractionDigits: 1 })
    : n.toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 0 });

const usdFull = (n: number) =>
  n.toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 2 });

const shortDay = (iso: string) => {
  const d = new Date(iso + "T00:00:00Z");
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" });
};

/* ---------------- Allocation donut ---------------- */

export interface AllocationSlice {
  symbol: string;
  valueUsd: number;
  pct: number;
}

export function AllocationDonut({ data }: { data: AllocationSlice[] }) {
  if (data.length === 0) {
    return <p className="text-sm text-slate-400">No holdings to chart yet.</p>;
  }
  return (
    <div className="flex items-center gap-4">
      <div style={{ width: 190, height: 190 }}>
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={data}
              dataKey="valueUsd"
              nameKey="symbol"
              innerRadius={55}
              outerRadius={85}
              paddingAngle={2}
              stroke="none"
            >
              {data.map((_, i) => (
                <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
              ))}
            </Pie>
            <Tooltip
              formatter={(value: number, name: string) => [usdFull(value), name]}
              contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid #E2E8ED" }}
            />
          </PieChart>
        </ResponsiveContainer>
      </div>
      <ul className="text-sm space-y-1.5 flex-1 min-w-0">
        {data.slice(0, 6).map((d, i) => (
          <li key={d.symbol} className="flex items-center gap-2">
            <span
              className="inline-block w-3 h-3 rounded-sm shrink-0"
              style={{ background: CHART_COLORS[i % CHART_COLORS.length] }}
            />
            <span className="font-medium">{d.symbol}</span>
            <span className="text-slate-400 ml-auto whitespace-nowrap">
              {d.pct.toFixed(1)}% · {usdCompact(d.valueUsd)}
            </span>
          </li>
        ))}
        {data.length > 6 && (
          <li className="text-xs text-slate-400">+{data.length - 6} more</li>
        )}
      </ul>
    </div>
  );
}

/* ---------------- Portfolio value over time ---------------- */

export interface TrendPoint {
  day: string;
  valueUsd: number;
  volatility: number | null;
}

export function ValueAreaChart({ data }: { data: TrendPoint[] }) {
  if (data.length < 2) {
    return <p className="text-sm text-slate-400">Not enough history yet — it builds up daily.</p>;
  }
  return (
    <div style={{ width: "100%", height: 220 }}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 5, right: 8, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id="valueFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#0FA3A3" stopOpacity={0.35} />
              <stop offset="100%" stopColor="#0FA3A3" stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="#EEF2F5" vertical={false} />
          <XAxis
            dataKey="day"
            tickFormatter={shortDay}
            tick={{ fontSize: 11, fill: "#5B7089" }}
            axisLine={false}
            tickLine={false}
            minTickGap={24}
          />
          <YAxis
            tickFormatter={usdCompact}
            tick={{ fontSize: 11, fill: "#5B7089" }}
            axisLine={false}
            tickLine={false}
            width={58}
          />
          <Tooltip
            labelFormatter={l => shortDay(String(l))}
            formatter={(v: number) => [usdFull(v), "Value"]}
            contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid #E2E8ED" }}
          />
          <Area
            type="monotone"
            dataKey="valueUsd"
            stroke="#0FA3A3"
            strokeWidth={2}
            fill="url(#valueFill)"
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

/* ---------------- Volatility trend ---------------- */

export function VolatilityTrendChart({ data }: { data: TrendPoint[] }) {
  const usable = data.filter(d => d.volatility !== null);
  if (usable.length < 2) {
    return (
      <p className="text-sm text-slate-400">
        Volatility trend needs a few more days of history to fill the rolling window.
      </p>
    );
  }
  const chartData = usable.map(d => ({ day: d.day, volPct: (d.volatility as number) * 100 }));
  return (
    <div style={{ width: "100%", height: 220 }}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={chartData} margin={{ top: 5, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#EEF2F5" vertical={false} />
          <XAxis
            dataKey="day"
            tickFormatter={shortDay}
            tick={{ fontSize: 11, fill: "#5B7089" }}
            axisLine={false}
            tickLine={false}
            minTickGap={24}
          />
          <YAxis
            tickFormatter={(v: number) => `${v.toFixed(0)}%`}
            tick={{ fontSize: 11, fill: "#5B7089" }}
            axisLine={false}
            tickLine={false}
            width={48}
          />
          <Tooltip
            labelFormatter={l => shortDay(String(l))}
            formatter={(v: number) => [`${v.toFixed(1)}%`, "Annualized volatility"]}
            contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid #E2E8ED" }}
          />
          <Line
            type="monotone"
            dataKey="volPct"
            stroke="#0B1B33"
            strokeWidth={2}
            dot={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
