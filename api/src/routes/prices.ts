import { Router } from "express";
import { getPrices } from "../services/coingecko";

const router = Router();

const DEFAULT_IDS = ["bitcoin", "ethereum", "solana"];

// GET /api/prices?ids=bitcoin,ethereum&vs=usd
router.get("/", async (req, res) => {
  const ids = typeof req.query.ids === "string" && req.query.ids.length > 0
    ? req.query.ids.split(",").map(s => s.trim().toLowerCase()).filter(Boolean).slice(0, 25)
    : DEFAULT_IDS;
  const vs = typeof req.query.vs === "string" ? req.query.vs : "usd";
  try {
    const prices = await getPrices(ids, vs);
    res.json({ prices, cachedFor: "60s" });
  } catch (err) {
    const e = err as Error & { status?: number };
    res.status(e.status ?? 502).json({ error: e.message });
  }
});

export default router;
