# PHASE 1 — Foundation & Infra

**Status:** ✅ complete — 2026-06-04

---

## Agent Prompt

You are building MariData — a self-hosted platform to manage an 80M-row / 30 GB people
database. Phase 1 lays the foundation: infra, schema, API skeleton, admin auth, and the
React shell. No data features yet.

Stack: PostgreSQL 15+/16, Node + Express + TS (`pg` + raw SQL), React 18 + Vite + TS.
Read `docs/project-context.md` and `.claude/docs/*` first.

---

## Deliverables

### Infra
- `docker-compose.yml` — `pgvector/pgvector:pg16`, named volume, healthcheck, port 5432.
  (Documented path; on this machine we run against local Homebrew Postgres 15.)
- `.env.example` — `DATABASE_URL`, `ADMIN_PASSWORD_HASH`, `JWT_SECRET`, `PORT`,
  `VITE_API_URL`. A real `.env` for local dev points at
  `postgresql://ritesh5001@localhost:5432/maridata`.
- Create the `maridata` database.

### Backend (`backend/`)
- `package.json` (type: module, TS, tsx/nodemon dev), `tsconfig.json` (strict).
- `src/db/pool.ts` — singleton `pg.Pool` from `DATABASE_URL`.
- `src/db/migrate.ts` — tiny migration runner: applies `src/migrations/*.sql` in order,
  tracked in a `_migrations` table. `npm run migrate`.
- Migrations:
  - `001_extensions.sql` — `CREATE EXTENSION IF NOT EXISTS pg_trgm; ... unaccent; ...
    btree_gin;` and a guarded `vector` create that **does not fail** if pgvector is absent
    (wrap in a `DO $$ BEGIN ... EXCEPTION WHEN undefined_file THEN ... END $$;` or check
    `pg_available_extensions`).
  - `002_persons.sql` — `persons` table per `.claude/docs/schema.md` (all 38 source cols +
    platform cols), generated `search_vector`, UNIQUE `external_id`. Add `embedding`
    column only if the `vector` extension is present (guarded).
- `src/server.ts` — Express app, JSON middleware, cookie parser, CORS for the Vite origin,
  `GET /health` (checks DB), mounts `/auth`.
- `src/auth/` — `POST /auth/login` (bcrypt compare vs `ADMIN_PASSWORD_HASH`, issue JWT
  httpOnly cookie ~12h), `POST /auth/logout`, `GET /auth/me`, `requireAuth` middleware.
- A small `scripts/hash-password.ts` to generate `ADMIN_PASSWORD_HASH`.

### Frontend (`frontend/`)
- Vite + React 18 + TS + Tailwind + shadcn/ui base. TanStack Query provider.
- `src/api/client.ts` — fetch wrapper (credentials: include, base = `VITE_API_URL`),
  401 → redirect to `/login`.
- Pages: `/login` (password form → `/auth/login`), protected `AppLayout` (sidebar:
  Dashboard, Import, Browse, Segments; topbar with logout), a placeholder Dashboard.
- Route guard: unauthenticated users hitting any protected route redirect to `/login`
  (check via `GET /auth/me`).

### Root
- `package.json` with a `dev` script running API + web concurrently (`concurrently`).
- `README.md` — quickstart (create db, set env, migrate, dev).

---

## Acceptance Criteria

- [ ] `npm run migrate` runs cleanly against `maridata`; `\d persons` shows all typed
      columns + generated `search_vector`; absence of pgvector does NOT break migration.
- [ ] `GET /health` returns ok and confirms a live DB connection.
- [ ] `POST /auth/login` with the correct password sets a JWT cookie; wrong password 401s.
- [ ] Every `/api/*`-style protected route rejects without a valid JWT; `/health` and
      `/auth/login` are open.
- [ ] Frontend: visiting a protected route while logged out redirects to `/login`; after
      login you land on the Dashboard; logout clears the session.
- [ ] `npm run dev` (root) starts API and Vite concurrently; both reachable.
- [ ] Typecheck passes with zero errors in backend and frontend.
- [ ] `docker-compose.yml` is valid (documented path) even though local dev uses Homebrew PG.
