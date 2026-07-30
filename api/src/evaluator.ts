import { config } from "./config";
import { evaluateAllAlerts } from "./services/alerts";

/**
 * Background alert evaluator. Runs on an interval inside the API process
 * (simplest deployment on a single Render service — no separate worker needed).
 * Each sweep checks every user's enabled alerts against fresh metrics.
 */
export function startAlertEvaluator() {
  const run = async () => {
    try {
      const { users, fires } = await evaluateAllAlerts();
      if (fires > 0) console.log(`[alerts] swept ${users} users, ${fires} fired`);
    } catch (err) {
      console.error("[alerts] sweep failed:", (err as Error).message);
    }
  };
  // Kick off after a short delay so the server is fully up, then repeat.
  setTimeout(run, 15000);
  setInterval(run, config.alertIntervalMs);
  console.log(`[alerts] evaluator started (every ${config.alertIntervalMs / 1000}s)`);
}
