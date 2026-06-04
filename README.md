# MariData

A self-hosted platform to upload and manage a large people database (~80M rows / 30 GB TSV):
streaming import, full-text + fuzzy search, an AND/OR filter builder with facets, record
CRUD, dedup/merge, saved segments, and streaming export.

Stack: PostgreSQL (FTS + pg_trgm) · Node + Express + TypeScript (`pg`, raw SQL) ·
React 18 + Vite + TypeScript.

## Quickstart (local dev)

```bash
# 1. Postgres: use the local Homebrew PG (already running) or Docker
createdb maridata                 # local; or: docker compose up -d

# 2. Install deps
npm run install:all

# 3. Configure env
cp .env.example .env              # adjust DATABASE_URL if needed
npm run hash-password -- 'your-admin-password'   # paste output into ADMIN_PASSWORD_HASH
#   also set a long random JWT_SECRET

# 4. Migrate the schema
npm run migrate

# 5. Run API + web
npm run dev                       # API :4000, web :5173
```

## Build process

This repo is built in phases driven by the `.claude/` autopilot system. See
`.claude/README.md` and `docs/project-context.md`. Run `/status` to see progress,
`/phase <n>` to build a phase.

## Scale contract

Streaming `COPY` ingest · index-after-load · keyset pagination · estimated counts ·
parameterized SQL · streaming exports. Details in `.claude/docs/architecture.md`.
