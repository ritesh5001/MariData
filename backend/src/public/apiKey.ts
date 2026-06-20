import { timingSafeEqual } from "node:crypto";
import type { Request, Response, NextFunction } from "express";
import { config } from "../config.js";

// Constant-time membership test so a wrong key can't be discovered by timing.
function isValidKey(candidate: string): boolean {
  const a = Buffer.from(candidate);
  let ok = false;
  for (const key of config.apiKeys) {
    const b = Buffer.from(key);
    // timingSafeEqual throws on length mismatch; comparing against a same-length
    // copy of `a` keeps the comparison constant-time regardless of the real key.
    const ref = b.length === a.length ? b : a;
    if (timingSafeEqual(a, ref) && b.length === a.length) ok = true;
  }
  return ok;
}

// Reads the key from `Authorization: Bearer <key>` (falling back to `X-API-Key`)
// and checks it against config.apiKeys. Mirrors requireAuth's 401 shape.
export function requireApiKey(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  if (config.apiKeys.length === 0) {
    res.status(503).json({ error: "public api disabled" });
    return;
  }

  const header = req.header("authorization");
  const bearer =
    header && header.toLowerCase().startsWith("bearer ")
      ? header.slice(7).trim()
      : undefined;
  const key = bearer ?? req.header("x-api-key")?.trim();

  if (!key || !isValidKey(key)) {
    res.status(401).json({ error: "invalid api key" });
    return;
  }
  next();
}
