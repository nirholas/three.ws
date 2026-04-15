# Task: Diagnose and fix the `GET /api/agents/me` 500

## Context

Repo: `/workspaces/3D`. `/api/agents/me` is called by every page that boots an agent (home, dashboard, embed, studio, `src/agent-identity.js` on every page load). When it 500s, the whole client falls back to a local-only identity, `window.VIEWER.agent` is wrong, and action logging silently fails. The top-level README memo calls this out as a known bug.

The handler lives in [api/agents.js](../../api/agents.js) — specifically `handleList` (branches on `/me`) and `handleGetOrCreateMe` (lines ~55–86). The route is wired up in [vercel.json](../../vercel.json) with:

```
{ "src": "/api/agents/me",       "dest": "/api/agents" }
{ "src": "/api/agents/([^/]+)/wallet", "dest": "/api/agents/[id]" }
{ "src": "/api/agents/([^/]+)",  "dest": "/api/agents/[id]" }
```

`handleGetOrCreateMe` already has a `try/catch` that swallows `42P01` (missing table) — that path returns `{ agent: null, warning: 'agents_table_missing' }`. But other failure modes (e.g. unique-constraint race on the auto-insert, JSON coercion on `skills`, cold-start timeout on Neon) currently bubble up as 500.

Auth is resolved in `resolveAuth()`: session cookie first, then bearer. If neither resolves, anonymous callers hitting `/me` get `200 { agent: null }` — **that behavior must be preserved**.

## Goal

`GET /api/agents/me` returns 200 for 100% of legitimate requests — anonymous, signed-in-with-agent, and signed-in-without-agent. No 500s. A minimal regression test exercises the three cases.

## Deliverable

1. Modified [api/agents.js](../../api/agents.js):
   - `handleGetOrCreateMe` hardened against race on insert (two concurrent requests creating the default agent).
   - Error branches tagged in logs with a stable prefix like `[agents/me]` so future 500s are grep-able.
   - No behavior change for anonymous callers (`auth === null` → `200 { agent: null }`).
2. A minimal regression test file — plain Node, no new dev deps. Either:
   - `scripts/test-agents-me.mjs` — a standalone script that hits the endpoint with three cookie states and asserts status 200 + expected body shape; or
   - Inline `assert` block in an existing test harness if one exists in `scripts/`.
3. Report the exact root cause you found. If the bug was a race, say "race on concurrent insert into `agent_identities`." If it was a schema mismatch, name the column. Don't report "hardened the handler" without a root cause.

## Audit checklist

**Reproduce before fixing**

- [ ] Hit `/api/agents/me` with **no** cookie → expect `200 { agent: null }`. Confirm this branch still works after your change.
- [ ] Hit `/api/agents/me` with a valid session cookie for a user who has **zero** rows in `agent_identities` → this is the suspected 500 path. Capture the actual Postgres error and include it in your report.
- [ ] Hit `/api/agents/me` with a valid session cookie for a user who **already has** a default agent → expect `200 { agent: {...} }`.
- [ ] Fire 10 concurrent requests (`xargs -P10`) for a brand-new user and count the resulting rows in `agent_identities` — must be exactly 1.

**Handler correctness**

- [ ] Auto-create path is race-safe. Options: wrap in a transaction + `select … for update`, or add a partial unique index on `(user_id) where deleted_at is null` and catch `23505` → re-select. Pick one; document why.
- [ ] `skills` default is a real array literal, not a JSON-coerced string. Current code passes `${['greet', ...]}` — Neon's serverless driver should handle this as a Postgres array, but double-check it doesn't become `{greet,…}` text on the insert.
- [ ] The existing `42P01` fallback stays. Don't delete the `agents_table_missing` warning path.
- [ ] Any `catch` added logs with `console.error('[agents/me] …', err)` before returning, so Vercel logs are greppable.
- [ ] `json(res, 200, { agent })` — `decorate(agent)` is called so the response shape matches the happy path.

**Don't regress**

- [ ] `list` path (`/api/agents`, not `/me`) still returns 401 for anonymous callers.
- [ ] `POST /api/agents` still requires auth.
- [ ] The `/me` route rewrite in [vercel.json](../../vercel.json) is untouched.

## Constraints

- **Do not change the route rewrite.** The `vercel.json` plumbing works; the bug is in the handler.
- **Do not add a new runtime dependency.** `sql` from `_lib/db.js`, `zod`, `jose` are all that's allowed.
- **Do not silently swallow unknown errors.** The existing `42P01` swallow is the *only* acceptable silent fallback — anything else must `throw` so `wrap()` can 500 it visibly. The goal is to eliminate 500s by fixing root causes, not by hiding them.
- Keep the file under 300 lines. If your fix balloons the file, move helpers into `_lib/`.

## Verification

1. `node --check api/agents.js`
2. `npx vite build` — should pass (ignore pre-existing `@avaturn/sdk` warning).
3. Run your regression script against a local dev deploy:
   ```bash
   node scripts/test-agents-me.mjs
   ```
   Output should show three passing cases: anonymous → 200 null, fresh user → 200 agent, existing user → 200 agent.
4. Concurrency check — with `DATABASE_URL` pointed at a dev branch:
   ```bash
   for i in {1..10}; do curl -s -b "__Host-sid=$SID" https://localhost/api/agents/me & done; wait
   psql "$DATABASE_URL" -c "select count(*) from agent_identities where user_id = '<uid>' and deleted_at is null"
   ```
   Must return `1`.

## Scope boundaries — do NOT do these

- Do not add logout UX, session refresh, or a "log out everywhere" endpoint. That is task 05.
- Do not redesign how wallets link to users. That is task 03.
- Do not touch SIWE nonce/verify. That is task 02.
- Do not refactor `api/agents.js` into multiple files.
- Do not add a new auth mode.

## Reporting

- Root cause (one sentence).
- The diff summary for [api/agents.js](../../api/agents.js) (which functions changed, which lines).
- The regression-test file path + output.
- Concurrency check result.
- Any unrelated bugs noticed (don't fix — just note).
