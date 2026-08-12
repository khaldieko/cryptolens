import { Request, Response, NextFunction } from "express";

/**
 * Week 7 — Security hardening.
 * Lightweight, dependency-free middleware (no helmet needed for a JSON API).
 */

/** Standard security response headers for an API that serves no HTML. */
export function securityHeaders(_req: Request, res: Response, next: NextFunction) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Cross-Origin-Resource-Policy", "same-site");
  res.setHeader("Permissions-Policy", "geolocation=(), microphone=(), camera=()");
  // The API returns JSON only — a restrictive CSP costs nothing here.
  res.setHeader("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'");
  res.removeHeader("X-Powered-By");
  next();
}

/**
 * In-memory fixed-window rate limiter, keyed by client IP + route group.
 * Deliberately simple: the API runs as a single instance on Render, so a shared
 * store isn't warranted. Protects auth endpoints from credential stuffing and
 * the expensive risk endpoints from accidental hammering.
 */
interface Bucket { count: number; resetAt: number; }
const buckets = new Map<string, Bucket>();

export function rateLimit(opts: { windowMs: number; max: number; keyPrefix: string }) {
  const { windowMs, max, keyPrefix } = opts;
  return (req: Request, res: Response, next: NextFunction) => {
    const ip = (req.headers["x-forwarded-for"] as string)?.split(",")[0].trim()
      || req.socket.remoteAddress || "unknown";
    const key = `${keyPrefix}:${ip}`;
    const now = Date.now();

    let bucket = buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      bucket = { count: 0, resetAt: now + windowMs };
      buckets.set(key, bucket);
    }
    bucket.count++;

    const remaining = Math.max(0, max - bucket.count);
    res.setHeader("X-RateLimit-Limit", String(max));
    res.setHeader("X-RateLimit-Remaining", String(remaining));

    if (bucket.count > max) {
      const retryAfter = Math.ceil((bucket.resetAt - now) / 1000);
      res.setHeader("Retry-After", String(retryAfter));
      return res.status(429).json({ error: "Too many requests — please slow down" });
    }
    next();
  };
}

/** Periodic cleanup so the bucket map can't grow unbounded. */
export function startRateLimitCleanup(intervalMs = 600000) {
  const timer = setInterval(() => {
    const now = Date.now();
    for (const [key, b] of buckets) if (b.resetAt <= now) buckets.delete(key);
  }, intervalMs);
  timer.unref?.();
}

/** Test seam — resets limiter state between test runs. */
export function __resetRateLimits() { buckets.clear(); }
