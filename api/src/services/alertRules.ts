/**
 * Alert rule evaluation — the pure decision logic, extracted in Week 7
 * so it can be unit-tested independently of the database and scheduler.
 */

export type AlertMetric = "portfolio_volatility" | "asset_pct" | "portfolio_value";
export type AlertCondition = "above" | "below";

export const REFIRE_COOLDOWN_MS = 60 * 60 * 1000; // 1 hour

export function fired(value: number, condition: AlertCondition, threshold: number): boolean {
  if (!Number.isFinite(value) || !Number.isFinite(threshold)) return false;
  return condition === "above" ? value > threshold : value < threshold;
}

export function inCooldown(lastFiredAt: string | null, now: number = Date.now()): boolean {
  if (!lastFiredAt) return false;
  const last = new Date(lastFiredAt).getTime();
  if (!Number.isFinite(last)) return false;
  return now - last < REFIRE_COOLDOWN_MS;
}

const LABELS: Record<AlertMetric, string> = {
  portfolio_volatility: "Portfolio volatility",
  asset_pct: "Largest asset concentration",
  portfolio_value: "Portfolio value",
};

export function describe(metric: AlertMetric, condition: AlertCondition,
                        threshold: number, value: number): string {
  const isMoney = metric === "portfolio_value";
  const unit = isMoney ? "$" : "";
  const suffix = isMoney ? "" : "%";
  const v = isMoney ? value.toFixed(0) : value.toFixed(1);
  const t = isMoney ? threshold.toFixed(0) : threshold.toFixed(1);
  return `${LABELS[metric]} is ${unit}${v}${suffix}, ${condition} your threshold of ${unit}${t}${suffix}`;
}

/** Should this rule notify right now? Combines firing + cooldown + enabled. */
export function shouldNotify(args: {
  enabled: boolean; value: number; condition: AlertCondition;
  threshold: number; lastFiredAt: string | null; now?: number;
}): boolean {
  if (!args.enabled) return false;
  if (!fired(args.value, args.condition, args.threshold)) return false;
  return !inCooldown(args.lastFiredAt, args.now ?? Date.now());
}
