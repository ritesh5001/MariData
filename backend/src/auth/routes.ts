import { Router } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { config } from "../config.js";
import { AUTH_COOKIE, issueToken, requireAuth } from "./middleware.js";

export const authRouter = Router();

const loginSchema = z.object({ password: z.string().min(1) });

authRouter.post("/login", (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "password required" });
    return;
  }
  if (!config.adminPasswordHash) {
    res.status(500).json({ error: "ADMIN_PASSWORD_HASH not configured" });
    return;
  }
  const ok = bcrypt.compareSync(parsed.data.password, config.adminPasswordHash);
  if (!ok) {
    res.status(401).json({ error: "invalid credentials" });
    return;
  }
  res.cookie(AUTH_COOKIE, issueToken(), {
    httpOnly: true,
    sameSite: "lax",
    secure: config.isProd,
    maxAge: config.jwtTtlSeconds * 1000,
  });
  res.json({ ok: true });
});

authRouter.post("/logout", (_req, res) => {
  res.clearCookie(AUTH_COOKIE);
  res.json({ ok: true });
});

authRouter.get("/me", requireAuth, (_req, res) => {
  res.json({ authenticated: true, user: "admin" });
});
