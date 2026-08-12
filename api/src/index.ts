import express from "express";
import cors from "cors";
import { config } from "./config";
import authRouter from "./routes/auth";
import pricesRouter from "./routes/prices";
import walletsRouter from "./routes/wallets";
import portfolioRouter from "./routes/portfolio";
import riskRouter from "./routes/risk";
import alertsRouter from "./routes/alerts";
import { startAlertEvaluator } from "./evaluator";
import { securityHeaders, rateLimit, startRateLimitCleanup } from "./middleware/security";
import { errorHandler, notFoundHandler } from "./middleware/errors";

const app = express();
app.disable("x-powered-by");
app.set("trust proxy", 1);           // behind Render's proxy — needed for real client IPs
app.use(securityHeaders);
app.use(cors());
app.use(express.json({ limit: "256kb" }));

// Rate limits: strict on auth (credential stuffing), moderate on compute-heavy
// risk endpoints, generous elsewhere.
app.use("/api/auth", rateLimit({ windowMs: 15 * 60_000, max: 20, keyPrefix: "auth" }));
app.use("/api/risk", rateLimit({ windowMs: 60_000, max: 60, keyPrefix: "risk" }));
app.use("/api", rateLimit({ windowMs: 60_000, max: 240, keyPrefix: "api" }));

app.get("/api/health", (_req, res) => res.json({ ok: true, service: "cryptolens-api" }));
app.use("/api/auth", authRouter);
app.use("/api/prices", pricesRouter);
app.use("/api/wallets", walletsRouter);
app.use("/api/portfolio", portfolioRouter);
app.use("/api/risk", riskRouter);
app.use("/api/alerts", alertsRouter);

app.use(notFoundHandler);
app.use(errorHandler);

app.listen(config.port, () => {
  console.log(`CryptoLens API listening on http://localhost:${config.port} [${config.env}]`);
  startRateLimitCleanup();
  startAlertEvaluator();
});
