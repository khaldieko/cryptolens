import { Router, Response } from "express";
import { z } from "zod";
import { requireAuth, AuthedRequest } from "../middleware/auth";
import { query } from "../db";
import { getEthBalance, isValidEthAddress } from "../services/etherscan";
import {
  getDefaultPortfolioId, getPortfolioView, parseHoldingsCsv, upsertHolding,
} from "../services/holdings";

const router = Router();
router.use(requireAuth);

function fail(res: Response, err: unknown) {
  const e = err as Error & { status?: number };
  res.status(e.status ?? 500).json({ error: e.message ?? "Internal error" });
}

// GET /api/portfolio — sources + holdings valued in USD
router.get("/", async (req: AuthedRequest, res) => {
  try {
    res.json(await getPortfolioView(req.userId!));
  } catch (err) { fail(res, err); }
});

// POST /api/portfolio/wallets { address } — add an ETH wallet source and sync its balance
const walletBody = z.object({ address: z.string().trim() });
router.post("/wallets", async (req: AuthedRequest, res) => {
  const parsed = walletBody.safeParse(req.body);
  if (!parsed.success || !isValidEthAddress(parsed.data.address)) {
    return res.status(400).json({ error: "Provide a valid Ethereum address (0x + 40 hex chars)" });
  }
  const address = parsed.data.address.toLowerCase();
  try {
    const portfolioId = await getDefaultPortfolioId(req.userId!);
    // Store the FULL address as the label — the UI shortens it for display,
    // and /sync needs the full address to refresh balances.
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

    const balance = await getEthBalance(address);
    await upsertHolding(sourceId, "ethereum", "ETH", balance.eth);

    res.status(201).json({ sourceId, address, eth: balance.eth });
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
    res.status(201).json({ sourceId, imported: rows.length, skipped: errors });
  } catch (err) { fail(res, err); }
});

// POST /api/portfolio/sync — refresh all wallet balances from Etherscan
router.post("/sync", async (req: AuthedRequest, res) => {
  try {
    const portfolioId = await getDefaultPortfolioId(req.userId!);
    const wallets = await query<{ id: number; label: string }>(
      "SELECT id, label FROM sources WHERE portfolio_id = $1 AND kind = 'wallet'",
      [portfolioId]
    );
    // Wallet source labels hold the full address, so we can refresh directly.
    let refreshed = 0;
    for (const w of wallets) {
      if (isValidEthAddress(w.label)) {
        const balance = await getEthBalance(w.label);
        await upsertHolding(w.id, "ethereum", "ETH", balance.eth);
        refreshed++;
      }
    }
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
    res.json({ deleted: id });
  } catch (err) { fail(res, err); }
});

export default router;
