import dotenv from "dotenv";
dotenv.config();

/** Week 7: fail fast in production if critical secrets are missing/default. */
function requiredInProd(name: string, value: string, insecureDefault?: string): string {
  const isProd = process.env.NODE_ENV === "production";
  if (isProd && (!value || (insecureDefault && value === insecureDefault))) {
    throw new Error(`Refusing to start: ${name} must be set to a secure value in production`);
  }
  return value;
}

const jwtSecret = process.env.JWT_SECRET ?? "dev-secret";

export const config = {
  env: process.env.NODE_ENV ?? "development",
  port: Number(process.env.PORT ?? 4000),
  databaseUrl: process.env.DATABASE_URL ?? "postgres://cryptolens:cryptolens@localhost:5432/cryptolens",
  redisUrl: process.env.REDIS_URL ?? "redis://localhost:6379",
  jwtSecret: requiredInProd("JWT_SECRET", jwtSecret, "dev-secret"),
  coingeckoBase: process.env.COINGECKO_BASE ?? "https://api.coingecko.com/api/v3",
  coingeckoApiKey: process.env.COINGECKO_API_KEY ?? "",
  etherscanApiKey: process.env.ETHERSCAN_API_KEY ?? "",
  riskEngineUrl: process.env.RISK_ENGINE_URL ?? "http://localhost:8000",
  resendApiKey: process.env.RESEND_API_KEY ?? "",
  alertsFromEmail: process.env.ALERTS_FROM_EMAIL ?? "alerts@cryptolens.app",
  alertIntervalMs: Number(process.env.ALERT_INTERVAL_MS ?? 300000),
};
