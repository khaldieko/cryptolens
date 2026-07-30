import { query } from "../db";
import { config } from "../config";
import { getRiskMetrics } from "./risk";
import { getPortfolioView } from "./holdings";

/**
 * Week 5 — Alerts.
 * Users define rules on three metrics: portfolio volatility, portfolio value,
 * or any single asset's % of portfolio. A background evaluator checks every
 * user's rules against fresh metrics and records/notifies on trigger.
 */

export type AlertMetric = "portfolio_volatility" | "asset_pct" | "portfolio_value";
export type AlertCondition = "above" | "below";
export type AlertChannel = "in_app" | "email";

export interface Alert {
  id: number;
  metric: AlertMetric;
  condition: AlertCondition;
  threshold: number;
  channel: AlertChannel;
  enabled: boolean;
  lastFiredAt: string | null;
}

// Re-fire suppression: don't notify the same rule more than once per hour.
const REFIRE_COOLDOWN_MS = 60 * 60 * 1000;

export async function listAlerts(userId: number): Promise<Alert[]> {
  const rows = await query<{
    id: number; metric: AlertMetric; condition: AlertCondition;
    threshold: string; channel: AlertChannel; enabled: boolean; last_fired_at: string | null;
  }>(
    `SELECT id, metric, condition, threshold, channel, enabled, last_fired_at
     FROM alerts WHERE user_id = $1 ORDER BY id DESC`,
    [userId]
  );
  return rows.map(r => ({
    id: r.id, metric: r.metric, condition: r.condition,
    threshold: Number(r.threshold), channel: r.channel,
    enabled: r.enabled, lastFiredAt: r.last_fired_at,
  }));
}

export async function createAlert(
  userId: number, metric: AlertMetric, condition: AlertCondition,
  threshold: number, channel: AlertChannel
): Promise<number> {
  const rows = await query<{ id: number }>(
    `INSERT INTO alerts (user_id, metric, condition, threshold, channel)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [userId, metric, condition, threshold, channel]
  );
  return rows[0].id;
}

export async function setAlertEnabled(userId: number, id: number, enabled: boolean): Promise<boolean> {
  const rows = await query(
    "UPDATE alerts SET enabled = $3 WHERE id = $1 AND user_id = $2 RETURNING id",
    [id, userId, enabled]
  );
  return rows.length > 0;
}

export async function deleteAlert(userId: number, id: number): Promise<boolean> {
  const rows = await query(
    "DELETE FROM alerts WHERE id = $1 AND user_id = $2 RETURNING id",
    [id, userId]
  );
  return rows.length > 0;
}

export interface AlertEvent {
  id: number;
  alertId: number;
  metric: AlertMetric;
  valueAtTrigger: number;
  message: string;
  seen: boolean;
  triggeredAt: string;
}

export async function listRecentEvents(userId: number, limit = 20): Promise<AlertEvent[]> {
  const rows = await query<{
    id: number; alert_id: number; metric: AlertMetric;
    value_at_trigger: string; message: string; seen: boolean; triggered_at: string;
  }>(
    `SELECT e.id, e.alert_id, a.metric, e.value_at_trigger, e.message, e.seen, e.triggered_at
     FROM alert_events e JOIN alerts a ON a.id = e.alert_id
     WHERE a.user_id = $1 ORDER BY e.triggered_at DESC LIMIT $2`,
    [userId, limit]
  );
  return rows.map(r => ({
    id: r.id, alertId: r.alert_id, metric: r.metric,
    valueAtTrigger: Number(r.value_at_trigger), message: r.message ?? "",
    seen: r.seen, triggeredAt: r.triggered_at,
  }));
}

export async function markEventsSeen(userId: number): Promise<void> {
  await query(
    `UPDATE alert_events SET seen = true
     WHERE seen = false AND alert_id IN (SELECT id FROM alerts WHERE user_id = $1)`,
    [userId]
  );
}

/** Compute the current value of a metric for a user. */
async function metricValue(userId: number, metric: AlertMetric): Promise<number | null> {
  if (metric === "portfolio_volatility") {
    const m = await getRiskMetrics(userId);
    return m.volatilityAnnualized * 100; // as a percentage
  }
  if (metric === "portfolio_value") {
    const m = await getRiskMetrics(userId);
    return m.totalValueUsd;
  }
  if (metric === "asset_pct") {
    // Largest single-asset concentration as a percentage
    const view = await getPortfolioView(userId);
    if (view.totalValueUsd <= 0) return 0;
    const byAsset = new Map<string, number>();
    for (const h of view.holdings) byAsset.set(h.assetId, (byAsset.get(h.assetId) ?? 0) + h.valueUsd);
    const maxVal = Math.max(...byAsset.values(), 0);
    return (maxVal / view.totalValueUsd) * 100;
  }
  return null;
}

function fired(value: number, condition: AlertCondition, threshold: number): boolean {
  return condition === "above" ? value > threshold : value < threshold;
}

function describe(metric: AlertMetric, condition: AlertCondition, threshold: number, value: number): string {
  const labels: Record<AlertMetric, string> = {
    portfolio_volatility: "Portfolio volatility",
    asset_pct: "Largest asset concentration",
    portfolio_value: "Portfolio value",
  };
  const unit = metric === "portfolio_value" ? "$" : "";
  const suffix = metric === "portfolio_value" ? "" : "%";
  const v = metric === "portfolio_value" ? value.toFixed(0) : value.toFixed(1);
  const t = metric === "portfolio_value" ? threshold.toFixed(0) : threshold.toFixed(1);
  return `${labels[metric]} is ${unit}${v}${suffix}, ${condition} your threshold of ${unit}${t}${suffix}`;
}

/** Best-effort email via Resend (if configured). No-op when no key is set. */
async function sendEmail(to: string, subject: string, body: string): Promise<void> {
  if (!config.resendApiKey) return;
  try {
    await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.resendApiKey}`,
      },
      body: JSON.stringify({
        from: config.alertsFromEmail,
        to, subject, text: body,
      }),
    });
  } catch {
    // delivery is best-effort; the in-app event is still recorded
  }
}

/**
 * Evaluate every enabled alert for one user. Records an alert_event and
 * (for email channel) sends a message when a rule fires and isn't in cooldown.
 * Returns the number of alerts that fired this run.
 */
export async function evaluateUserAlerts(userId: number, email?: string): Promise<number> {
  const alerts = (await listAlerts(userId)).filter(a => a.enabled);
  if (alerts.length === 0) return 0;

  // Cache metric values within this run so we don't recompute per alert
  const cache = new Map<AlertMetric, number | null>();
  const getVal = async (m: AlertMetric) => {
    if (!cache.has(m)) cache.set(m, await metricValue(userId, m));
    return cache.get(m)!;
  };

  let fires = 0;
  const now = Date.now();
  for (const a of alerts) {
    const value = await getVal(a.metric);
    if (value === null) continue;
    if (!fired(value, a.condition, a.threshold)) continue;

    // Cooldown: skip if fired within the last hour
    if (a.lastFiredAt && now - new Date(a.lastFiredAt).getTime() < REFIRE_COOLDOWN_MS) continue;

    const message = describe(a.metric, a.condition, a.threshold, value);
    await query(
      "INSERT INTO alert_events (alert_id, value_at_trigger, message) VALUES ($1, $2, $3)",
      [a.id, value, message]
    );
    await query("UPDATE alerts SET last_fired_at = now() WHERE id = $1", [a.id]);
    if (a.channel === "email" && email) {
      await sendEmail(email, "CryptoLens alert", message);
    }
    fires++;
  }
  return fires;
}

/** Evaluate alerts for all users who have at least one enabled alert. */
export async function evaluateAllAlerts(): Promise<{ users: number; fires: number }> {
  const users = await query<{ user_id: number; email: string }>(
    `SELECT DISTINCT a.user_id, u.email
     FROM alerts a JOIN users u ON u.id = a.user_id
     WHERE a.enabled = true`
  );
  let totalFires = 0;
  for (const u of users) {
    try {
      totalFires += await evaluateUserAlerts(u.user_id, u.email);
    } catch {
      // one user's failure shouldn't stop the whole sweep
    }
  }
  return { users: users.length, fires: totalFires };
}
