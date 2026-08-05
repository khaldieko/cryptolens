import { Router } from "express";
import { z } from "zod";
import { requireAuth, AuthedRequest } from "../middleware/auth";
import { getRiskMetrics } from "../services/risk";
import { runSimulation } from "../services/simulation";
import { getTrend } from "../services/trend";

const router = Router();
router.use(requireAuth);

function fail(res: import("express").Response, err: unknown) {
  const e = err as Error & { status?: number };
  res.status(e.status ?? 500).json({ error: e.message });
}

// GET /api/risk/metrics — volatility, concentration, and portfolio stats
router.get("/metrics", async (req: AuthedRequest, res) => {
  try { res.json(await getRiskMetrics(req.userId!)); } catch (err) { fail(res, err); }
});

// GET /api/risk/simulate?drop=20 — model a market drop (drop given as positive %)
router.get("/simulate", async (req: AuthedRequest, res) => {
  const dropRaw = typeof req.query.drop === "string" ? Number(req.query.drop) : 20;
  const parsed = z.number().min(0).max(100).safeParse(dropRaw);
  if (!parsed.success) return res.status(400).json({ error: "drop must be between 0 and 100" });
  try { res.json(await runSimulation(req.userId!, -parsed.data)); } catch (err) { fail(res, err); }
});

// GET /api/risk/trend?days=30&window=7 — portfolio value + rolling volatility series
router.get("/trend", async (req: AuthedRequest, res) => {
  const days = z.number().min(7).max(90).safeParse(
    typeof req.query.days === "string" ? Number(req.query.days) : 30);
  const window = z.number().min(3).max(30).safeParse(
    typeof req.query.window === "string" ? Number(req.query.window) : 7);
  if (!days.success || !window.success) {
    return res.status(400).json({ error: "days must be 7–90 and window 3–30" });
  }
  try { res.json(await getTrend(req.userId!, days.data, window.data)); } catch (err) { fail(res, err); }
});

export default router;
