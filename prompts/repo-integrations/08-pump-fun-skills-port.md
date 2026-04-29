# 08 — Port missing skills from pump-fun-skills repo

**Branch:** `feat/pump-fun-skills-port`
**Source repo:** https://github.com/nirholas/pump-fun-skills
**One PR. Standalone. No other prompt is required to be shipped first.**

## Why it matters

The pump-fun-skills repo is a curated list of pump.fun skills for AI agents. Some are likely already implemented in [src/agent-skills-pumpfun*.js](../../src/) and some are not. Diffing and porting the missing ones increases the agent's pump.fun capability surface without inventing new ideas.

## Read these first

| File | Why |
| :--- | :--- |
| [src/agent-skills-pumpfun.js](../../src/agent-skills-pumpfun.js) | Core skill registry. |
| [src/agent-skills-pumpfun-watch.js](../../src/agent-skills-pumpfun-watch.js) | Streaming/watch skills. |
| [src/agent-skills-pumpfun-compose.js](../../src/agent-skills-pumpfun-compose.js) | Higher-level composed skills. |
| [src/agent-skills-pumpfun-autonomous.js](../../src/agent-skills-pumpfun-autonomous.js) | Loop/autonomous skills. |
| [src/agent-skills-pumpfun-hooks.js](../../src/agent-skills-pumpfun-hooks.js) | Lifecycle hooks. |
| https://github.com/nirholas/pump-fun-skills | Source list of skills. |

## Build this

1. Audit: enumerate every skill described in pump-fun-skills (read its README + each skill file/manifest). Build a skill-name → "have / missing / superseded" table.
2. Output the audit as `docs/pump-fun-skills-audit.md` (one new doc file allowed). Columns: `name | description | status (have / missing / superseded) | local file`.
3. For each skill marked `missing`, port it into the most appropriate file under `src/agent-skills-pumpfun*.js`. Keep the existing registration pattern — do not create a new file unless there are 5+ ported skills with no good home, in which case add `src/agent-skills-pumpfun-ports.js`.
4. Each ported skill must have:
    - Args validation matching the existing skills' validation style.
    - A short LLM-facing description.
    - One vitest test in `tests/pumpfun-ported-skills.test.js`.

## Out of scope

- Skills that depend on external paid APIs (note them in the audit as `skipped: needs API key`; do not port).
- UI changes.
- Adding new dependencies — if a port requires a new package, note it in the audit and skip.

## Acceptance

- [ ] Audit doc lists every upstream skill with a status.
- [ ] Every `missing` skill is either ported or has a documented reason in the audit.
- [ ] `npx vitest run tests/pumpfun-ported-skills.test.js` passes (or is empty if none ported).
- [ ] `npx vite build` passes.

## Test plan

1. Diff the audit against pump-fun-skills' actual list manually; confirm no upstream skill is missed.
2. Call each ported skill from the agent (or via a unit test) with valid args.
3. Run the full pumpfun test suite; confirm green.

## Reporting

- Shipped (count + names): …
- Skipped + reasons: …
- Broke / regressions: …
- Unrelated bugs noticed: …
