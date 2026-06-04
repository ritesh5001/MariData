---
description: Execute a MariData build phase end-to-end against its acceptance criteria
argument-hint: <phase number 1-6>
---

You are entering **autopilot execution mode** for MariData Phase $1.

## Steps

1. Read `.claude/phases/phase-$1.md` — this is your contract for this phase.
2. Read `docs/project-context.md` for the locked stack, rules, and scale contract.
3. Reference `.claude/docs/schema.md`, `.claude/docs/ingestion.md`,
   `.claude/docs/filters.md`, `.claude/docs/architecture.md` as needed.
4. Use `TodoWrite` to break the phase into ordered tasks — one task per concrete deliverable.
5. Execute every task. Do not stop to ask permission for routine operations (file edits,
   `npm install`, migrations, `npm run dev`, tests).
6. After implementation: run typecheck, lint, and the relevant verification. Fix all errors.
7. Walk the **Acceptance Criteria** at the bottom of `phase-$1.md`. Verify each; report pass/fail.
8. End with a concise summary: what shipped, what's pending, any blockers.

## Hard rules (the scale contract)

- Stack is locked — no library substitutions.
- TypeScript strict mode. No `any` without inline justification.
- Bulk load is streaming `COPY` only — never INSERT loops.
- Build indexes AFTER the bulk load.
- Keyset pagination only; offset banned past page 1.
- No bare `COUNT(*)` on the full table in the request path — use `reltuples` / capped counts.
- All dynamic SQL parameterized (`$n`); identifiers whitelisted against the schema.
- Streaming exports — never buffer a result set in memory.
- Zod-validate every API input. No emoji in source. Comments only when WHY is non-obvious.

## When the phase is done

Update `.claude/phases/phase-$1.md` — change `**Status:**` from `⏳ pending` to
`✅ complete — <YYYY-MM-DD>`.

Do not start phase $(($1 + 1)) until the user explicitly says so.
