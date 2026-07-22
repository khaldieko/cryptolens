import express from "express";
import cors from "cors";
import { config } from "./config";
import authRouter from "./routes/auth";
import pricesRouter from "./routes/prices";
import walletsRouter from "./routes/wallets";
import portfolioRouter from "./routes/portfolio";
import riskRouter from "./routes/risk";

const app = express();
app.use(cors());
app.use(express.json({ limit: "256kb" }));

app.get("/api/health", (_req, res) => res.json({ ok: true, service: "cryptolens-api" }));
app.use("/api/auth", authRouter);
app.use("/api/prices", pricesRouter);
app.use("/api/wallets", walletsRouter);
app.use("/api/portfolio", portfolioRouter);
app.use("/api/risk", riskRouter);

app.listen(config.port, () => {
  console.log(`CryptoLens API listening on http://localhost:${config.port}`);
});
