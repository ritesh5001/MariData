# .claude/ — MariData Build System

Project-level Claude Code configuration. Drives the autopilot 6-phase build of MariData,
a large-scale (80M-row / 30 GB) people-database management platform.

```
.claude/
├── settings.json          # Autopilot permissions (bypassPermissions mode)
├── README.md              # This file
├── phases/                # One agent-ready contract per phase
│   ├── phase-1.md         # Foundation & Infra
│   ├── phase-2.md         # Ingestion Engine (streaming COPY)
│   ├── phase-3.md         # Search & Browse
│   ├── phase-4.md         # Filters & Facets
│   ├── phase-5.md         # CRUD, Dedup & Bulk ops
│   └── phase-6.md         # Export, Dashboard & Polish
├── docs/                  # Cross-phase technical specs
│   ├── schema.md          # 38-column TSV -> Postgres type + index map
│   ├── ingestion.md       # COPY pipeline contract
│   ├── filters.md         # filter-field spec + operator -> SQL rules
│   └── architecture.md    # stack, scaling decisions, count/pagination rules
├── commands/              # Custom slash commands
│   ├── phase.md           # /phase <n> — execute build phase N
│   └── status.md          # /status   — show build progress
└── agents/                # Custom subagents
    └── data-reviewer.md   # SQL-safety + scale-discipline reviewer (read-only)
```

## How to use

When a phase is ready to build:

> `/phase 1`

Claude reads `phases/phase-1.md`, plans tasks via TodoWrite, executes end-to-end against
the acceptance criteria, and marks the phase complete only when every box is checked.

Check progress at any time:

> `/status`

Audit after a phase ships:

> Use the **data-reviewer** agent on the current branch.

## Autopilot mode

`settings.json` sets `permissions.defaultMode = "bypassPermissions"`. Claude won't stop to
ask for routine file edits, installs, migrations, or test runs. Destructive ops
(`rm -rf /`, `git push --force`, `git reset --hard`, `sudo rm`) stay denied.

## Source of truth

`docs/project-context.md` (repo root) is authoritative for stack, rules, and decisions.
The `.claude/docs/*` files hold the detailed technical specs each phase references.

## Phase rules

1. **One phase at a time.** Phase N+1 does not start until N is acceptance-complete and the
   user signals to continue.
2. **Stack is locked.** No library substitutions without user approval.
3. **Acceptance criteria are the contract.** Phase done = every box checked.
4. **The scale contract is non-negotiable:** streaming COPY, index-after-load, keyset
   pagination, estimated counts, parameterized SQL, streaming exports.
