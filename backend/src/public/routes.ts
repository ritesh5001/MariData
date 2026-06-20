import { Router } from "express";
import cors from "cors";
import rateLimit from "express-rate-limit";
import { config } from "../config.js";
import { requireApiKey } from "./apiKey.js";
import { listPersonsHandler, getPersonHandler } from "../routes/persons.js";
import { statsHandler } from "../routes/stats.js";
import { facetsHandler } from "../routes/facets.js";

// Permissive CORS for the public API: it is authenticated by API key (a header), not by
// a browser cookie, so any origin may call it and credentials are never needed.
export const publicCors = cors({ origin: true, credentials: false });

// Per-IP rate limit. Trusts X-Forwarded-For from the Cloudflare Tunnel (see app.set
// "trust proxy" in server.ts) so the limit keys on the real client, not the tunnel.
export const publicRateLimit = rateLimit({
  windowMs: config.publicRateWindowMs,
  max: config.publicRateMax,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "rate limit exceeded" },
});

// Read-only surface exposed to third-party platforms. Mounted under /public/v1 and
// guarded by requireApiKey in server.ts. Deliberately excludes every write/admin route
// (PATCH/DELETE persons, import, bulk, segment edits) — those stay on the cookie-only /api.
export const publicRouter = Router();
publicRouter.use(requireApiKey);
publicRouter.get("/persons", listPersonsHandler);
publicRouter.get("/persons/:id", getPersonHandler);
publicRouter.get("/stats", statsHandler);
publicRouter.get("/facets", facetsHandler);
