# 36 — Pump.fun integration architecture doc

**Branch:** `docs/pump-architecture`
**One PR. Standalone. No other prompt is required to be shipped first.**

## Why it matters

Pump.fun integration is now spread across `services/`, `api/`, `src/pump/`, and several `agent-skills-pumpfun-*.js` files. A single architecture doc reduces ramp-up time for new contributors and prevents new prompts from re-inventing existing primitives.

## Read these first

| File | Why |
| :--- | :--- |
| [services/pump-graduations/](../../services/pump-graduations/) | Map every file. |
| [src/pump/](../../src/pump/) | Same. |
| [api/pump-fun-mcp.js](../../api/pump-fun-mcp.js) | Tool registry. |
| [api/pump/](../../api/pump/) | All HTTP handlers. |
| [src/agent-skills-pumpfun.js](../../src/agent-skills-pumpfun.js) and siblings | Skill registry. |

## Build this

1. Add `docs/pump-fun-architecture.md`. Sections:
    - **Overview** — one paragraph: what we expose and why.
    - **Module map** — table: file → responsibility → consumers.
    - **Data sources** — RPC, SDK, indexer, paid APIs, with env vars.
    - **Skill / MCP / HTTP surface matrix** — table mapping each skill name to its MCP tool name and HTTP route (if any).
    - **Adding a new signal** — 5-bullet recipe.
    - **Open issues** — bullets only; no fixes.
2. Generate the matrix by reading skill registrations + MCP registrations + handlers. Do not invent rows. If a skill has no MCP counterpart, leave that cell blank.
3. Add a one-line link to the new doc in the project's main [README.md](../../README.md) under any existing "Docs" section. If none exists, do not invent one — instead link from [docs/](../../docs/) index if that exists, else add a "## Architecture" section heading at the bottom of README.md (one heading; no other edits).

## Out of scope

- Rewriting code.
- Renaming files for consistency.
- Generating a diagram (text tables only).

## Acceptance

- [ ] Doc exists and renders cleanly on GitHub.
- [ ] Matrix accurately reflects current code (spot-check 5 entries by reading source).
- [ ] No stale TODOs or invented features documented.
- [ ] `npx vite build` passes (build doesn't depend on docs but should not regress).

## Test plan

1. Read the doc end-to-end. Pick three table entries; confirm each matches code.
2. Confirm README link points at the new doc.

## Reporting

- Shipped: …
- Skipped: …
- Open issues identified during the pass: …
- Unrelated bugs noticed: …
