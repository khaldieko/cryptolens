import dotenv from "dotenv";
dotenv.config();

export const config = {
  port: Number(process.env.PORT ?? 4000),
  databaseUrl: process.env.DATABASE_URL ?? "postgres://cryptolens:cryptolens@localhost:5432/cryptolens",
  redisUrl: process.env.REDIS_URL ?? "redis://localhost:6379",
  jwtSecret: process.env.JWT_SECRET ?? "dev-secret",
  coingeckoBase: process.env.COINGECKO_BASE ?? "https://api.coingecko.com/api/v3",
  coingeckoApiKey: process.env.COINGECKO_API_KEY ?? "",
  etherscanApiKey: process.env.ETHERSCAN_API_KEY ?? "",
  riskEngineUrl: process.env.RISK_ENGINE_URL ?? "http://localhost:8000",
  resendApiKey: process.env.RESEND_API_KEY ?? "",
  alertsFromEmail: process.env.ALERTS_FROM_EMAIL ?? "alerts@cryptolens.app",
  alertIntervalMs: Number(process.env.ALERT_INTERVAL_MS ?? 300000), // 5 min
};
