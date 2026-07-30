import { Router } from "express";
import { z } from "zod";
import { requireAuth, AuthedRequest } from "../middleware/auth";
import { getRiskMetrics } from "../services/risk";
import { runSimulation } from "../services/simulation";

const router = Router();
router.use(requireAuth);

// GET /api/risk/metrics — volatility, concentration, and portfolio stats
router.get("/metrics", async (req: AuthedRequest, res) => {
  try {
    res.json(await getRiskMetrics(req.userId!));
  } catch (err) {
    const e = err as Error & { status?: number };
    res.status(e.status ?? 500).json({ error: e.message });
  }
});

// GET /api/risk/simulate?drop=20 — model a market drop (drop given as positive %)
router.get("/simulate", async (req: AuthedRequest, res) => {
  const dropRaw = typeof req.query.drop === "string" ? Number(req.query.drop) : 20;
  const parsed = z.number().min(0).max(100).safeParse(dropRaw);
  if (!parsed.success) return res.status(400).json({ error: "drop must be between 0 and 100" });
  try {
    // API takes a positive % for convenience; engine expects negative
    const result = await runSimulation(req.userId!, -parsed.data);
    res.json(result);
  } catch (err) {
    const e = err as Error & { status?: number };
    res.status(e.status ?? 500).json({ error: e.message });
  }
});

export default router;
