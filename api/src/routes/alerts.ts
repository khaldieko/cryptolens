import { Router } from "express";
import { z } from "zod";
import { requireAuth, AuthedRequest } from "../middleware/auth";
import {
  listAlerts, createAlert, setAlertEnabled, deleteAlert,
  listRecentEvents, markEventsSeen,
} from "../services/alerts";

const router = Router();
router.use(requireAuth);

// GET /api/alerts — rules + recent triggered events + unseen count
router.get("/", async (req: AuthedRequest, res) => {
  try {
    const [alerts, events] = await Promise.all([
      listAlerts(req.userId!),
      listRecentEvents(req.userId!),
    ]);
    const unseen = events.filter(e => !e.seen).length;
    res.json({ alerts, events, unseen });
  } catch (err) {
    const e = err as Error & { status?: number };
    res.status(e.status ?? 500).json({ error: e.message });
  }
});

const createBody = z.object({
  metric: z.enum(["portfolio_volatility", "asset_pct", "portfolio_value"]),
  condition: z.enum(["above", "below"]),
  threshold: z.number().finite(),
  channel: z.enum(["in_app", "email"]).default("in_app"),
});

// POST /api/alerts — create a rule
router.post("/", async (req: AuthedRequest, res) => {
  const parsed = createBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
  try {
    const { metric, condition, threshold, channel } = parsed.data;
    const id = await createAlert(req.userId!, metric, condition, threshold, channel);
    res.status(201).json({ id });
  } catch (err) {
    const e = err as Error & { status?: number };
    res.status(e.status ?? 500).json({ error: e.message });
  }
});

// PATCH /api/alerts/:id — enable/disable
router.patch("/:id", async (req: AuthedRequest, res) => {
  const id = Number(req.params.id);
  const enabled = z.boolean().safeParse(req.body?.enabled);
  if (!Number.isInteger(id) || !enabled.success) {
    return res.status(400).json({ error: "Provide { enabled: boolean }" });
  }
  try {
    const ok = await setAlertEnabled(req.userId!, id, enabled.data);
    if (!ok) return res.status(404).json({ error: "Alert not found" });
    res.json({ id, enabled: enabled.data });
  } catch (err) {
    const e = err as Error & { status?: number };
    res.status(e.status ?? 500).json({ error: e.message });
  }
});

// DELETE /api/alerts/:id
router.delete("/:id", async (req: AuthedRequest, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: "Invalid alert id" });
  try {
    const ok = await deleteAlert(req.userId!, id);
    if (!ok) return res.status(404).json({ error: "Alert not found" });
    res.json({ deleted: id });
  } catch (err) {
    const e = err as Error & { status?: number };
    res.status(e.status ?? 500).json({ error: e.message });
  }
});

// POST /api/alerts/seen — mark all triggered events as seen
router.post("/seen", async (req: AuthedRequest, res) => {
  try {
    await markEventsSeen(req.userId!);
    res.json({ ok: true });
  } catch (err) {
    const e = err as Error & { status?: number };
    res.status(e.status ?? 500).json({ error: e.message });
  }
});

export default router;
