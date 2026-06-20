import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import { config } from "./config.js";
import { pool } from "./db/pool.js";
import { authRouter } from "./auth/routes.js";
import { requireAuth } from "./auth/middleware.js";
import { importRouter } from "./routes/import.js";
import { personsRouter } from "./routes/persons.js";
import { facetsRouter } from "./routes/facets.js";
import { segmentsRouter } from "./routes/segments.js";
import { dedupRouter } from "./routes/dedup.js";
import { bulkRouter } from "./routes/bulk.js";
import { exportRouter } from "./routes/export.js";
import { statsRouter } from "./routes/stats.js";
import { publicRouter, publicCors, publicRateLimit } from "./public/routes.js";

const app = express();

// Behind the Cloudflare Tunnel there is exactly one proxy hop; trust it so req.ip and the
// rate limiter see the real client IP from X-Forwarded-For (not the tunnel's address).
app.set("trust proxy", 1);

// Credentialed CORS for the cookie-authenticated admin surface (the Vite frontend).
const adminCors = cors({
  origin: config.clientOrigin,
  credentials: true,
});
app.use(express.json({ limit: "2mb" }));
app.use(cookieParser());

// Open endpoints.
app.get("/health", async (_req, res) => {
  try {
    await pool.query("SELECT 1");
    res.json({ status: "ok", db: "up" });
  } catch {
    res.status(503).json({ status: "degraded", db: "down" });
  }
});

app.use("/auth", adminCors, authRouter);

// Public, read-only API for third-party platforms. Authenticated by API key (not cookie),
// so it gets its own permissive CORS and a per-IP rate limit. Read-only by construction —
// only safe GET endpoints are mounted in publicRouter.
app.use("/public/v1", publicCors, publicRateLimit, publicRouter);

// Protected API surface. Feature routers (persons, import, segments, export, stats) mount
// here in later phases; all inherit requireAuth.
const api = express.Router();
api.use(adminCors);
api.use(requireAuth);
api.get("/ping", (_req, res) => res.json({ pong: true }));
api.use(importRouter);
api.use(personsRouter);
api.use(facetsRouter);
api.use(segmentsRouter);
api.use(dedupRouter);
api.use(bulkRouter);
api.use(exportRouter);
api.use(statsRouter);
app.use("/api", api);

app.listen(config.port, () => {
  // eslint-disable-next-line no-console
  console.log(`MariData API listening on http://localhost:${config.port}`);
});
