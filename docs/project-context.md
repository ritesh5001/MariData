# MariData — Project Context (Source of Truth)

MariData is a self-hosted platform to **upload, manage, search, and export a large
people database** — on the order of **80 million rows / 30 GB** ingested from TSV.

This document is the authoritative spec. If a phase prompt and this file disagree,
this file wins.

---

## What it does

Import a 38-column people TSV (names, titles, functions, seniority, email + status,
phone, LinkedIn, organization, full location, `predictive_scores`, etc.) and provide a
full DBMS over it: bulk import with live progress, full-text + fuzzy search, an AND/OR
filter builder with faceted counts, record CRUD, dedup/merge, saved segments, and
streaming export.

## Locked decisions

- **Search:** Postgres FTS (`tsvector`/GIN) + `pg_trgm` fuzzy. **No embedding pipeline now.**
  `pgvector` is reserved (extension + nullable `embedding` column) for future semantic search.
- **Deployment:** Local Postgres. Documented path is Docker (`pgvector/pgvector:pg16`);
  on this machine we run against the local Homebrew PostgreSQL 15. All DB config is
  env-driven (`DATABASE_URL`) so it moves to cloud Postgres with zero code change.
- **Access:** Single internal **admin** — one password (`ADMIN_PASSWORD_HASH`) → JWT.
  No multi-user, no roles.
- **Frontend:** React 18 + Vite + TypeScript SPA against a Node/Express API.

## Stack (locked — no substitutions without approval)

| Layer | Choice |
|---|---|
| Database | PostgreSQL 15+ (16 in Docker); extensions `pg_trgm`, `unaccent`, `btree_gin`, `vector` (optional) |
| Backend | Node.js + Express + TypeScript |
| DB access | `pg` (node-postgres) Pool + raw **parameterized** SQL. No ORM on the hot path. |
| Bulk load | `pg-copy-streams` (`COPY ... FROM STDIN`) |
| Validation | Zod |
| Migrations | Plain SQL files run by a small in-repo runner |
| Frontend | React 18 + Vite + TS |
| Data table | TanStack Table (virtualized) + TanStack Query |
| UI | shadcn/ui (Radix + Tailwind) |
| Live progress | Server-Sent Events (SSE) |

## Hard rules (the scale contract)

1. **Ingest via streaming `COPY`, never INSERT loops.** TSV → `persons_staging` (all TEXT)
   → single transforming `INSERT INTO persons SELECT cast(...)`.
2. **Build indexes after the bulk load**, not before.
3. **Keyset (cursor) pagination** for browsing. Offset pagination is banned past page 1.
4. **No bare `COUNT(*)`** on the full table in the request path. Use `pg_class.reltuples`
   for the global estimate; filtered counts run under `statement_timeout` and cap at
   `"10,000+"`.
5. **All dynamic SQL is parameterized.** Filters go through `filterConfigToWhereClause`
   which emits `$1,$2,...` placeholders + a values array. Identifiers are whitelisted
   against the known column set — never interpolated from user input.
6. **Streaming exports** (server-side cursor → chunked CSV/TSV). Never buffer a result
   set in memory.
7. TypeScript strict mode. Zod-validate every API input. No emoji in source. Comments
   only when the WHY is non-obvious.

## Repo layout

```
MariData/
├── docker-compose.yml      # documented Postgres 16 + pgvector path
├── .env.example
├── docs/project-context.md # this file
├── backend/                # Express + TS API, migrations, ingest, search
├── frontend/               # React + Vite + TS SPA
└── .claude/                # phased autopilot build system
```

## Local environment (this machine)

- PostgreSQL 15 running via Homebrew, user `ritesh5001`, socket `/tmp:5432`.
- `pg_trgm` + `unaccent` available; `pgvector` NOT installed (vector features skipped
  gracefully).
- Default `DATABASE_URL=postgresql://ritesh5001@localhost:5432/maridata`.

## Build process

One phase at a time via `/phase <n>` (see `.claude/phases/`). A phase is done only when
every Acceptance Criterion is checked. Phase N+1 does not start until the user says so.
