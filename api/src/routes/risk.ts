import { Router } from "express";
import { requireAuth, AuthedRequest } from "../middleware/auth";
import { getRiskMetrics } from "../services/risk";

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

export default router;
