import type { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { config } from "../config.js";

export const AUTH_COOKIE = "maridata_token";

export interface AuthPayload {
  sub: "admin";
}

// Guards protected routes. Reads the JWT from the httpOnly cookie; 401 if missing/invalid.
export function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const token = req.cookies?.[AUTH_COOKIE];
  if (!token) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }
  try {
    jwt.verify(token, config.jwtSecret);
    next();
  } catch {
    res.status(401).json({ error: "unauthorized" });
  }
}

export function issueToken(): string {
  const payload: AuthPayload = { sub: "admin" };
  return jwt.sign(payload, config.jwtSecret, {
    expiresIn: config.jwtTtlSeconds,
  });
}
