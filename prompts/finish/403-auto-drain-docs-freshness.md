# 403. Drain the docs-freshness backlog: 127 docs describe code that moved

How to run: paste this file's repo path into a fresh Claude Code chat in this repository and say "run this work order". Runnable now, no gate. Written 2026-10-23 as the remainder of [402](402-auto-restore-green-gate.md), which refreshed 30 docs (commit 38d2e8eec) and could not drain the rest in one session.

## Measurement

`npm run check:docs-freshness` reports 127 stale docs. `data/docs-freshness-budget.json` carries `maxStale: 130` for now, with a dated reason citing order 402. This order brings it back to 5.

## Task

1. Run the docs-freshness workflow in batches of 30 (`Workflow({ name: "docs-freshness", args: { limit: 30 } })`) until `npm run check:docs-freshness` reports at most 5 stale.
2. Commit each batch topically with explicit paths (the doc edits, `data/docs-freshness-reviews.json`, `public/docs-freshness*.json`). No dashes of the em or en kind in added lines.
3. After every batch, lower `maxStale` in the budget file to the measured count plus 3, with a dated history entry.
4. Generated docs (for example `docs/agent-abilities/ABILITIES.md`) are fixed by editing their source and regenerating, never by hand.

## Done when

`npm run check:docs-freshness` exits 0 with `maxStale` at 5, `npm run audit:docs` is clean, and this file is removed with a dated entry in `prompts/finish/_context/production-100-PROGRESS.md`.
