import dotenv from "dotenv";
import { fileURLToPath } from "node:url";
import path from "node:path";

// Load the repo-root .env (one level above backend/) and any local backend/.env.
const here = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(here, "../../.env") });
// Local backend/.env overrides the repo-root .env so per-machine dev settings win.
dotenv.config({ path: path.resolve(here, "../.env"), override: true });

function required(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback;
  if (v === undefined || v === "") {
    throw new Error(`Missing required env var: ${name}`);
  }
  return v;
}

export const config = {
  databaseUrl: required(
    "DATABASE_URL",
    "postgresql://localhost:5432/maridata"
  ),
  port: Number(process.env.PORT ?? 4000),
  clientOrigin: (process.env.CLIENT_ORIGIN ?? "http://localhost:5173")
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean),
  jwtSecret: process.env.JWT_SECRET ?? "dev-insecure-secret-change-me",
  adminPasswordHash: process.env.ADMIN_PASSWORD_HASH ?? "",
  // ~12h sessions
  jwtTtlSeconds: 60 * 60 * 12,
  isProd: process.env.NODE_ENV === "production",
};
