import { Router } from "express";
import { requireAuth } from "../middleware/auth";
import { getEthBalance } from "../services/etherscan";

const router = Router();

// GET /api/wallets/:address/balance  (protected — Week 2 Etherscan spike)
router.get("/:address/balance", requireAuth, async (req, res) => {
  try {
    const balance = await getEthBalance(req.params.address);
    res.json(balance);
  } catch (err) {
    const e = err as Error & { status?: number };
    res.status(e.status ?? 502).json({ error: e.message });
  }
});

export default router;
