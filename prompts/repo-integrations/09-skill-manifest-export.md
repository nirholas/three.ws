# 09 — Skill manifest export endpoint

**Branch:** `feat/skill-manifest-export`
**Source repo:** https://github.com/nirholas/pump-fun-skills (format reference)
**One PR. Standalone. No other prompt is required to be shipped first.**

## Why it matters

Other agent platforms (LobeHub, ElizaOS, Claude skills) want a machine-readable manifest of what an agent can do. The pump-fun-skills repo describes a manifest format. Exporting our agent's skills in the same format makes our agent portable to those hosts without per-host glue.

## Read these first

| File | Why |
| :--- | :--- |
| [src/agent-skills.js](../../src/agent-skills.js) | Top-level skill registry — has the in-memory list. |
| [src/agent-skills-pumpfun.js](../../src/agent-skills-pumpfun.js) | Per-skill metadata shape. |
| [api/openapi-json.js](../../api/openapi-json.js) | Existing JSON-served-from-API pattern. |
| https://github.com/nirholas/pump-fun-skills | Manifest format reference. |

## Build this

1. Add `api/skills-manifest.js` — GET endpoint serving:
    ```jsonc
    // GET /api/skills-manifest
    // → {
    //   "agent": { "id": "<agent-id-or-platform>", "version": "<package.json version>" },
    //   "skills": [
    //     { "name": "pumpfun.listClaims", "description": "...", "args": { "creator": "string", "limit": "number?" } },
    //     ...
    //   ]
    // }
    ```
2. Add `src/skill-manifest.js` exporting `buildSkillManifest({ agentId, version, skills })`. The HTTP endpoint is a thin wrapper that pulls the live skill list.
3. Reflect each skill's name, description, and arg schema. If a skill lacks a description, omit it (do not invent one) and surface a console.warn during build.
4. Add `tests/skill-manifest.test.js` asserting:
    - Output matches the documented JSON shape.
    - Every registered skill appears in the manifest.

## Out of scope

- Translating to LobeHub-specific or Eliza-specific format (that's a downstream adapter).
- Auth — manifest is public.
- Versioning the manifest schema; v1 is implicit.

## Acceptance

- [ ] `node --check api/skills-manifest.js` and `node --check src/skill-manifest.js` pass.
- [ ] `npx vitest run tests/skill-manifest.test.js` passes.
- [ ] `curl http://localhost:3000/api/skills-manifest` returns valid JSON with all current skills.
- [ ] `npx vite build` passes.

## Test plan

1. Boot dev server. Hit `/api/skills-manifest`. Confirm count matches `getSkills().length`.
2. Add a temporary skill registration in code, restart, re-hit; confirm it appears.
3. Remove it; re-hit; confirm it's gone.

## Reporting

- Shipped: …
- Skipped: …
- Broke / regressions: …
- Unrelated bugs noticed: …
