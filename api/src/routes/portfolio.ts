import { Router, Response } from "express";
import { z } from "zod";
import { requireAuth, AuthedRequest } from "../middleware/auth";
import { query } from "../db";
import { redis } from "../redis";
import { getWalletHoldings, isValidEthAddress } from "../services/etherscan";
import {
  getDefaultPortfolioId, getPortfolioView, parseHoldingsCsv, upsertHolding,
} from "../services/holdings";

const router = Router();
router.use(requireAuth);

function fail(res: Response, err: unknown) {
  const e = err as Error & { status?: number };
  res.status(e.status ?? 500).json({ error: e.message ?? "Internal error" });
}

/** Clear a user's cached risk metrics so the Dashboard recomputes on next load. */
async function bustRiskCache(userId: number) {
  try { await redis.del(`risk:user:${userId}`); } catch { /* non-fatal */ }
}

/** Replace all holdings for a wallet source with a fresh on-chain read. */
async function syncWalletSource(sourceId: number, address: string): Promise<number> {
  const holdings = await getWalletHoldings(address);
  // Remove holdings that are no longer present, then upsert current ones.
  await query("DELETE FROM holdings WHERE source_id = $1", [sourceId]);
  for (const h of holdings) {
    await upsertHolding(sourceId, h.assetId, h.symbol, h.amount);
  }
  return holdings.length;
}

// GET /api/portfolio — sources + holdings valued in USD
router.get("/", async (req: AuthedRequest, res) => {
  try {
    res.json(await getPortfolioView(req.userId!));
  } catch (err) { fail(res, err); }
});

// POST /api/portfolio/wallets { address } — add a wallet source, sync ETH + ERC-20 tokens
const walletBody = z.object({ address: z.string().trim() });
router.post("/wallets", async (req: AuthedRequest, res) => {
  const parsed = walletBody.safeParse(req.body);
  if (!parsed.success || !isValidEthAddress(parsed.data.address)) {
    return res.status(400).json({ error: "Provide a valid Ethereum address (0x + 40 hex chars)" });
  }
  const address = parsed.data.address.toLowerCase();
  try {
    const portfolioId = await getDefaultPortfolioId(req.userId!);
    // Full address stored as the label; UI shortens it, /sync uses it to refresh.
    const existing = await query<{ id: number }>(
      "SELECT id FROM sources WHERE portfolio_id = $1 AND kind = 'wallet' AND label = $2",
      [portfolioId, address]
    );
    const sourceId = existing.length > 0
      ? existing[0].id
      : (await query<{ id: number }>(
          "INSERT INTO sources (portfolio_id, kind, label) VALUES ($1, 'wallet', $2) RETURNING id",
          [portfolioId, address]
        ))[0].id;

    const assetCount = await syncWalletSource(sourceId, address);
    await bustRiskCache(req.userId!);

    res.status(201).json({ sourceId, address, assets: assetCount });
  } catch (err) { fail(res, err); }
});

// POST /api/portfolio/csv { filename, csv } — import exchange holdings (symbol,amount)
const csvBody = z.object({
  filename: z.string().trim().min(1).max(80).default("import.csv"),
  csv: z.string().min(1).max(100_000),
});
router.post("/csv", async (req: AuthedRequest, res) => {
  const parsed = csvBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Provide { filename, csv }" });

  const { rows, errors } = parseHoldingsCsv(parsed.data.csv);
  if (rows.length === 0) {
    return res.status(400).json({ error: "No valid rows found", details: errors });
  }
  try {
    const portfolioId = await getDefaultPortfolioId(req.userId!);
    const created = await query<{ id: number }>(
      "INSERT INTO sources (portfolio_id, kind, label) VALUES ($1, 'csv', $2) RETURNING id",
      [portfolioId, parsed.data.filename]
    );
    const sourceId = created[0].id;
    for (const r of rows) {
      await upsertHolding(sourceId, r.assetId, r.symbol, r.amount);
    }
    await bustRiskCache(req.userId!);
    res.status(201).json({ sourceId, imported: rows.length, skipped: errors });
  } catch (err) { fail(res, err); }
});

// POST /api/portfolio/sync — refresh all wallet balances (ETH + tokens) from chain
router.post("/sync", async (req: AuthedRequest, res) => {
  try {
    const portfolioId = await getDefaultPortfolioId(req.userId!);
    const wallets = await query<{ id: number; label: string }>(
      "SELECT id, label FROM sources WHERE portfolio_id = $1 AND kind = 'wallet'",
      [portfolioId]
    );
    let refreshed = 0;
    for (const w of wallets) {
      if (isValidEthAddress(w.label)) {
        await syncWalletSource(w.id, w.label);
        refreshed++;
      }
    }
    await bustRiskCache(req.userId!);
    res.json({ refreshed, total: wallets.length });
  } catch (err) { fail(res, err); }
});

// DELETE /api/portfolio/sources/:id — remove a source (holdings cascade)
router.delete("/sources/:id", async (req: AuthedRequest, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: "Invalid source id" });
  try {
    const portfolioId = await getDefaultPortfolioId(req.userId!);
    const deleted = await query(
      "DELETE FROM sources WHERE id = $1 AND portfolio_id = $2 RETURNING id",
      [id, portfolioId]
    );
    if (deleted.length === 0) return res.status(404).json({ error: "Source not found" });
    await bustRiskCache(req.userId!);
    res.json({ deleted: id });
  } catch (err) { fail(res, err); }
});

export default router;
