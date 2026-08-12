import { describe, it, expect, run } from "./harness";
import { parseHoldingsCsv, SYMBOL_MAP } from "../src/services/csv";
import {
  fired, inCooldown, describe as describeAlert, shouldNotify, REFIRE_COOLDOWN_MS,
} from "../src/services/alertRules";
import { rateLimit, securityHeaders, __resetRateLimits } from "../src/middleware/security";
import { errorHandler, notFoundHandler, HttpError } from "../src/middleware/errors";
import type { Request, Response } from "express";

/* ---------------- helpers to exercise middleware without a live server ---------------- */

function mockRes() {
  const headers: Record<string, string> = {};
  let statusCode = 200;
  let body: unknown = null;
  const res = {
    setHeader: (k: string, v: string) => { headers[k] = v; },
    removeHeader: (k: string) => { delete headers[k]; },
    status(code: number) { statusCode = code; return this; },
    json(payload: unknown) { body = payload; return this; },
    get headersSent() { return false; },
  } as unknown as Response;
  return {
    res,
    get headers() { return headers; },
    get statusCode() { return statusCode; },
    get body() { return body as Record<string, unknown> | null; },
  };
}

function mockReq(ip = "1.2.3.4", path = "/api/test", method = "GET") {
  return {
    headers: { "x-forwarded-for": ip },
    socket: { remoteAddress: ip },
    path, method,
  } as unknown as Request;
}

/* ---------------- CSV parsing ---------------- */

describe("CSV import parsing", () => {
  it("parses a well-formed file with a header row", () => {
    const { rows, errors } = parseHoldingsCsv("symbol,amount\nBTC,0.5\nETH,2.1\nSOL,10");
    expect(rows).toHaveLength(3);
    expect(errors).toHaveLength(0);
  });

  it("maps symbols to the correct CoinGecko ids", () => {
    const { rows } = parseHoldingsCsv("BTC,1");
    expect(rows[0].assetId).toBe("bitcoin");
    expect(rows[0].symbol).toBe("BTC");
  });

  it("works without a header row", () => {
    const { rows } = parseHoldingsCsv("BTC,0.5\nETH,1");
    expect(rows).toHaveLength(2);
  });

  it("is case-insensitive on symbols", () => {
    const { rows } = parseHoldingsCsv("btc,1\neTh,2");
    expect(rows).toHaveLength(2);
  });

  it("aggregates duplicate symbols rather than double-counting rows", () => {
    const { rows } = parseHoldingsCsv("BTC,1\nBTC,0.25");
    expect(rows).toHaveLength(1);
    expect(rows[0].amount).toBe(1.25);
  });

  it("reports unsupported symbols instead of silently dropping them", () => {
    const { rows, errors } = parseHoldingsCsv("FAKECOIN,5\nETH,3");
    expect(rows).toHaveLength(1);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("FAKECOIN");
  });

  it("rejects non-numeric amounts with a line number", () => {
    const { errors } = parseHoldingsCsv("ETH,abc");
    expect(errors[0]).toContain("Line 1");
    expect(errors[0]).toContain("abc");
  });

  it("rejects negative amounts", () => {
    const { rows, errors } = parseHoldingsCsv("BTC,-4");
    expect(rows).toHaveLength(0);
    expect(errors).toHaveLength(1);
  });

  it("flags malformed lines missing a column", () => {
    const { rows, errors } = parseHoldingsCsv("justonecolumn");
    expect(rows).toHaveLength(0);
    expect(errors).toHaveLength(1);
  });

  it("handles empty and whitespace-only input safely", () => {
    expect(parseHoldingsCsv("").rows).toHaveLength(0);
    expect(parseHoldingsCsv("\n\n   \n").rows).toHaveLength(0);
  });

  it("tolerates Windows line endings", () => {
    const { rows } = parseHoldingsCsv("symbol,amount\r\nBTC,1\r\nETH,2\r\n");
    expect(rows).toHaveLength(2);
  });

  it("tolerates extra whitespace around values", () => {
    const { rows } = parseHoldingsCsv("  BTC ,  0.5  ");
    expect(rows).toHaveLength(1);
    expect(rows[0].amount).toBe(0.5);
  });

  it("guards against oversized files", () => {
    const huge = Array.from({ length: 600 }, () => "BTC,1").join("\n");
    const { rows, errors } = parseHoldingsCsv(huge);
    expect(rows).toHaveLength(0);
    expect(errors[0]).toContain("too many rows");
  });

  it("truncates untrusted symbol text in error messages", () => {
    const nasty = "A".repeat(200) + ",1";
    const { errors } = parseHoldingsCsv(nasty);
    expect(errors[0].length).toBeLessThan(80);
  });

  it("every mapped symbol has a unique CoinGecko id", () => {
    const ids = Object.values(SYMBOL_MAP).map(m => m.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

/* ---------------- alert rules ---------------- */

describe("Alert rule evaluation", () => {
  it("fires when a value rises above the threshold", () => {
    expect(fired(60, "above", 50)).toBeTruthy();
  });

  it("does not fire when below an 'above' threshold", () => {
    expect(fired(40, "above", 50)).toBeFalsy();
  });

  it("fires when a value drops below the threshold", () => {
    expect(fired(30, "below", 50)).toBeTruthy();
  });

  it("treats the exact threshold as not-yet-crossed", () => {
    expect(fired(50, "above", 50)).toBeFalsy();
    expect(fired(50, "below", 50)).toBeFalsy();
  });

  it("never fires on non-finite values", () => {
    expect(fired(NaN, "above", 50)).toBeFalsy();
    expect(fired(Infinity, "below", 50)).toBeFalsy();
  });

  it("reports no cooldown for a rule that has never fired", () => {
    expect(inCooldown(null)).toBeFalsy();
  });

  it("suppresses a rule that fired moments ago", () => {
    const justNow = new Date(Date.now() - 60_000).toISOString();
    expect(inCooldown(justNow)).toBeTruthy();
  });

  it("allows re-firing once the cooldown has elapsed", () => {
    const old = new Date(Date.now() - REFIRE_COOLDOWN_MS - 1000).toISOString();
    expect(inCooldown(old)).toBeFalsy();
  });

  it("ignores an unparseable last-fired timestamp", () => {
    expect(inCooldown("not-a-date")).toBeFalsy();
  });

  it("formats percentage metrics with a % suffix", () => {
    const msg = describeAlert("portfolio_volatility", "above", 50, 63.2);
    expect(msg).toContain("63.2%");
    expect(msg).toContain("above");
  });

  it("formats value metrics with a currency prefix", () => {
    const msg = describeAlert("portfolio_value", "below", 10000, 8500);
    expect(msg).toContain("$8500");
    expect(msg).toContain("$10000");
  });

  it("names the concentration metric clearly", () => {
    expect(describeAlert("asset_pct", "above", 40, 67.4)).toContain("concentration");
  });

  it("does not notify when the rule is disabled", () => {
    expect(shouldNotify({ enabled: false, value: 99, condition: "above", threshold: 1, lastFiredAt: null })).toBeFalsy();
  });

  it("notifies for an enabled, crossed, non-cooled-down rule", () => {
    expect(shouldNotify({ enabled: true, value: 99, condition: "above", threshold: 50, lastFiredAt: null })).toBeTruthy();
  });

  it("does not notify while cooling down even if still crossed", () => {
    const justNow = new Date(Date.now() - 5000).toISOString();
    expect(shouldNotify({ enabled: true, value: 99, condition: "above", threshold: 50, lastFiredAt: justNow })).toBeFalsy();
  });
});

/* ---------------- security middleware ---------------- */

describe("Security headers", () => {
  it("sets nosniff and frame protections", () => {
    const m = mockRes();
    securityHeaders(mockReq(), m.res, () => {});
    expect(m.headers["X-Content-Type-Options"]).toBe("nosniff");
    expect(m.headers["X-Frame-Options"]).toBe("DENY");
  });

  it("sets a restrictive content security policy", () => {
    const m = mockRes();
    securityHeaders(mockReq(), m.res, () => {});
    expect(m.headers["Content-Security-Policy"]).toContain("default-src 'none'");
  });

  it("calls next so the request continues", () => {
    let called = false;
    securityHeaders(mockReq(), mockRes().res, () => { called = true; });
    expect(called).toBeTruthy();
  });
});

describe("Rate limiting", () => {
  it("allows requests under the limit", () => {
    __resetRateLimits();
    const limiter = rateLimit({ windowMs: 60_000, max: 3, keyPrefix: "t1" });
    let passes = 0;
    for (let i = 0; i < 3; i++) limiter(mockReq("9.9.9.1"), mockRes().res, () => { passes++; });
    expect(passes).toBe(3);
  });

  it("blocks requests once the limit is exceeded", () => {
    __resetRateLimits();
    const limiter = rateLimit({ windowMs: 60_000, max: 2, keyPrefix: "t2" });
    for (let i = 0; i < 2; i++) limiter(mockReq("9.9.9.2"), mockRes().res, () => {});
    const blocked = mockRes();
    let nextCalled = false;
    limiter(mockReq("9.9.9.2"), blocked.res, () => { nextCalled = true; });
    expect(nextCalled).toBeFalsy();
    expect(blocked.statusCode).toBe(429);
  });

  it("returns a Retry-After header when blocking", () => {
    __resetRateLimits();
    const limiter = rateLimit({ windowMs: 60_000, max: 1, keyPrefix: "t3" });
    limiter(mockReq("9.9.9.3"), mockRes().res, () => {});
    const blocked = mockRes();
    limiter(mockReq("9.9.9.3"), blocked.res, () => {});
    expect(blocked.headers["Retry-After"]).toBeTruthy();
  });

  it("tracks each client IP independently", () => {
    __resetRateLimits();
    const limiter = rateLimit({ windowMs: 60_000, max: 1, keyPrefix: "t4" });
    limiter(mockReq("10.0.0.1"), mockRes().res, () => {});
    let secondClientPassed = false;
    limiter(mockReq("10.0.0.2"), mockRes().res, () => { secondClientPassed = true; });
    expect(secondClientPassed).toBeTruthy();
  });

  it("exposes remaining-quota headers", () => {
    __resetRateLimits();
    const limiter = rateLimit({ windowMs: 60_000, max: 5, keyPrefix: "t5" });
    const m = mockRes();
    limiter(mockReq("10.0.0.3"), m.res, () => {});
    expect(m.headers["X-RateLimit-Limit"]).toBe("5");
    expect(m.headers["X-RateLimit-Remaining"]).toBe("4");
  });

  it("uses the forwarded client IP behind a proxy", () => {
    __resetRateLimits();
    const limiter = rateLimit({ windowMs: 60_000, max: 1, keyPrefix: "t6" });
    const req1 = { headers: { "x-forwarded-for": "203.0.113.5, 10.0.0.1" },
                   socket: { remoteAddress: "10.0.0.1" }, path: "/", method: "GET" } as unknown as Request;
    limiter(req1, mockRes().res, () => {});
    const blocked = mockRes();
    limiter(req1, blocked.res, () => {});
    expect(blocked.statusCode).toBe(429);
  });
});

/* ---------------- error handling ---------------- */

describe("Error handling", () => {
  it("returns 404 JSON for unknown routes", () => {
    const m = mockRes();
    notFoundHandler(mockReq(), m.res);
    expect(m.statusCode).toBe(404);
    expect(m.body?.error).toBe("Not found");
  });

  it("passes through safe 4xx messages", () => {
    const m = mockRes();
    const err: HttpError = Object.assign(new Error("Invalid Ethereum address format"), { status: 400 });
    errorHandler(err, mockReq(), m.res, () => {});
    expect(m.statusCode).toBe(400);
    expect(m.body?.error).toBe("Invalid Ethereum address format");
  });

  it("never leaks internal detail on a 500", () => {
    const m = mockRes();
    const err: HttpError = new Error('relation "users" does not exist at Pool._query');
    errorHandler(err, mockReq(), m.res, () => {});
    expect(m.statusCode).toBe(500);
    expect(String(m.body?.error)).toBe("Something went wrong on our end");
  });

  it("does not expose stack traces to clients", () => {
    const m = mockRes();
    const err: HttpError = new Error("boom");
    errorHandler(err, mockReq(), m.res, () => {});
    expect(String(m.body?.error)).toBeTruthy();
    expect(JSON.stringify(m.body)).toBeTruthy();
    expect(JSON.stringify(m.body).includes("at ")).toBeFalsy();
  });

  it("maps known statuses to friendly fallbacks", () => {
    const m = mockRes();
    const err: HttpError = Object.assign(new Error("upstream exploded"), { status: 502 });
    errorHandler(err, mockReq(), m.res, () => {});
    expect(m.statusCode).toBe(502);
  });

  it("defaults an unknown status to 500", () => {
    const m = mockRes();
    const err: HttpError = Object.assign(new Error("odd"), { status: "not-a-number" as unknown as number });
    errorHandler(err, mockReq(), m.res, () => {});
    expect(m.statusCode).toBe(500);
  });
});

run().then(failed => process.exit(failed > 0 ? 1 : 0));
