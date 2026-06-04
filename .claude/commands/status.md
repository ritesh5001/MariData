---
description: Show MariData build progress across all phases
---

Report the current build status of MariData.

## Steps

1. Read the `**Status:**` line from each `.claude/phases/phase-*.md` (1–6).
2. Render a compact table: phase #, name, status (✅ complete + date / ⏳ pending /
   🚧 in progress).
3. Note which phase is next and its one-line goal.
4. If a phase is in progress, summarize what's done vs. remaining from its acceptance criteria.

## Output format

```
MariData — Build Status

| # | Phase                       | Status              |
|---|-----------------------------|---------------------|
| 1 | Foundation & Infra          | ✅ 2026-06-04       |
| 2 | Ingestion Engine            | ⏳ pending          |
| ...                                                   |

Next: Phase N — <goal>. Run `/phase N` to build it.
```

Keep it to the table plus the "Next" line unless a phase is mid-build.
