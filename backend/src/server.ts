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

const app = express();

app.use(
  cors({
    origin: config.clientOrigin,
    credentials: true,
  })
);
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

app.use("/auth", authRouter);

// Protected API surface. Feature routers (persons, import, segments, export, stats) mount
// here in later phases; all inherit requireAuth.
const api = express.Router();
api.use(requireAuth);
api.get("/ping", (_req, res) => res.json({ pong: true }));
api.use(importRouter);
api.use(personsRouter);
api.use(facetsRouter);
api.use(segmentsRouter);
api.use(dedupRouter);
api.use(bulkRouter);
app.use("/api", api);

app.listen(config.port, () => {
  // eslint-disable-next-line no-console
  console.log(`MariData API listening on http://localhost:${config.port}`);
});
