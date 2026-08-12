import { Request, Response, NextFunction } from "express";

/**
 * Week 7 — Centralized error handling.
 * Goal: clients get an actionable message, never a stack trace or internal
 * detail (table names, connection strings, driver errors).
 */

export interface HttpError extends Error { status?: number; expose?: boolean; }

/** Messages we're willing to show a client, keyed by status. */
const SAFE_FALLBACKS: Record<number, string> = {
  400: "Invalid request",
  401: "Authentication required",
  403: "Not permitted",
  404: "Not found",
  409: "Conflict with existing data",
  429: "Too many requests — please slow down",
  502: "An upstream service is unavailable",
  503: "Service is starting up — please try again shortly",
};

export function notFoundHandler(_req: Request, res: Response) {
  res.status(404).json({ error: "Not found" });
}

export function errorHandler(err: HttpError, req: Request, res: Response, _next: NextFunction) {
  const status = Number.isInteger(err.status) ? (err.status as number) : 500;

  // Always log the full error server-side for debugging.
  const detail = err.stack ?? err.message;
  console.error(`[error] ${req.method} ${req.path} -> ${status}: ${detail}`);

  // 4xx errors we raise ourselves carry user-safe messages; 5xx never do.
  const message = status < 500 && err.message
    ? err.message
    : SAFE_FALLBACKS[status] ?? "Something went wrong on our end";

  if (res.headersSent) return;
  res.status(status).json({ error: message });
}

/** Wraps async route handlers so rejected promises reach the error handler. */
export function asyncRoute<T extends (req: Request, res: Response, next: NextFunction) => Promise<unknown>>(fn: T) {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}
