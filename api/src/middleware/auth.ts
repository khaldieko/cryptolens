import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { config } from "../config";

export interface AuthedRequest extends Request {
  userId?: number;
}

export function requireAuth(req: AuthedRequest, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Missing Authorization header" });
  }
  try {
    const payload = jwt.verify(header.slice(7), config.jwtSecret);
    const sub = typeof payload === "object" && payload !== null ? Number(payload.sub) : NaN;
    if (!Number.isFinite(sub)) return res.status(401).json({ error: "Invalid token payload" });
    req.userId = sub;
    next();
  } catch {
    return res.status(401).json({ error: "Invalid or expired token" });
  }
}
