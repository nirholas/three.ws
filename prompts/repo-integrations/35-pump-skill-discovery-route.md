# 35 — Skill discovery route for pump.fun tools

**Branch:** `feat/pump-skill-discovery`
**One PR. Standalone. No other prompt is required to be shipped first.**

## Why it matters

The agent already exposes skills, but discovery is implicit. A `/api/pump/skills` route returning a typed list of pump.fun-specific skills (and their MCP tool counterparts) makes it easy for hosts (LobeHub, Claude) to render a UI listing them.

## Read these first

| File | Why |
| :--- | :--- |
| [src/agent-skills-pumpfun.js](../../src/agent-skills-pumpfun.js) | Skill metadata source. |
| [src/agent-skills-pumpfun-watch.js](../../src/agent-skills-pumpfun-watch.js) | Same. |
| [src/agent-skills-pumpfun-compose.js](../../src/agent-skills-pumpfun-compose.js) | Same. |
| [src/agent-skills.js](../../src/agent-skills.js) | Top-level registry. |

## Build this

1. Add `api/pump/skills.js`:
    ```js
    // GET /api/pump/skills
    // → { skills: [{ name, description, args, mcpTool? }] }
    ```
2. Filter to skills whose namespace starts with `pumpfun.` or `kol.` or `social.`. Inspect each skill's metadata (name, description, args).
3. If the skill has a known MCP-tool counterpart (e.g. `pumpfun.listClaims` → `pumpfun_list_claims`), include `mcpTool` field.
4. Add `tests/pump-skills-route.test.js` asserting only pump-related skills appear and that namespaces are honored.

## Out of scope

- A UI consumer for this route.
- Modifying skill metadata in-place beyond what's necessary to publish via this endpoint.

## Acceptance

- [ ] `node --check api/pump/skills.js` passes.
- [ ] `npx vitest run tests/pump-skills-route.test.js` passes.
- [ ] `curl /api/pump/skills` returns valid JSON with all pump-namespaced skills.
- [ ] `npx vite build` passes.

## Test plan

1. Hit endpoint. Sanity-check listed skills against `getSkills()` output.
2. Add a temporary `unrelated.example` skill; confirm it does not appear.

## Reporting

- Shipped: …
- Skipped: …
- Broke / regressions: …
- Unrelated bugs noticed: …
