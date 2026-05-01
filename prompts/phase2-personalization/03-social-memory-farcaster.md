---
mode: agent
description: 'Phase 2 — Seed agent memory from Farcaster casts using Neynar API (no OAuth, just FID lookup)'
---

# Phase 2 · Social Memory Seeding — Farcaster

**Branch:** `feat/social-memory-farcaster`
**Standalone.** No other prompt must ship first.

## Why it matters

Farcaster is the primary social network for the web3 / agent user base that three.ws targets. Seeding agent memory from a user's casts gives the agent knowledge of their opinions, projects, and communication style from a source that's already pseudonymous and public.

## What to build

### 1. Farcaster link — `POST /api/agents/:id/memory/seed/farcaster`

File: `api/agents/[id]/memory-seed-farcaster.js`

No OAuth needed. Farcaster data is public. The user provides their FID (Farcaster ID) or `fname` (e.g. `@nirholas.eth`).

Input: `{ fid?: number, fname?: string }` — one of the two required.

Flow:
1. Auth: session or bearer; must own the agent.
2. If `fname` provided, resolve to FID via Neynar:
   `GET https://api.neynar.com/v2/farcaster/user/by_username?username={fname}`
   Auth: `api_key: NEYNAR_API_KEY` header.
3. Fetch recent casts:
   `GET https://api.neynar.com/v2/farcaster/feed/user/casts?fid={fid}&limit=50&include_replies=false`
4. Fetch user profile:
   `GET https://api.neynar.com/v2/farcaster/user?fid={fid}`
5. Distill into memory facts using **Claude** (`claude-haiku-4-5-20251001`):
   ```
   System: You distill Farcaster casts into concise memory facts for an AI agent.
           Focus on: recurring topics, opinions, projects, communication style, community ties.
   User:   Profile: {display_name, bio, follower_count}
           Recent casts (newest first):
           {casts[0].text}
           {casts[1].text}
           ... (up to 50)
   Tool:   extract_memory_facts → { facts: string[] } — up to 15 single-sentence facts
   ```
6. Write each fact to `agent_memories`:
   - `tag`: `'farcaster'`
   - `value`: fact string
   - `source`: `'farcaster_seed'`
   Upsert by `(agent_id, tag, value)` so re-seeding is idempotent.
7. Also store the validated `fid` and `fname` on the agent:
   ```sql
   UPDATE agent_identities
   SET farcaster_fid = $fid, farcaster_fname = $fname, farcaster_seeded_at = now()
   WHERE id = $agent_id;
   ```
   Add columns to `api/_lib/schema.sql`:
   ```sql
   ALTER TABLE agent_identities
     ADD COLUMN IF NOT EXISTS farcaster_fid    integer,
     ADD COLUMN IF NOT EXISTS farcaster_fname  text,
     ADD COLUMN IF NOT EXISTS farcaster_seeded_at timestamptz;
   ```
8. Return `{ fid, fname, seeded: N, facts: string[] }`.

Rate limit: 1 seed per agent per 6 hours.

### 2. `GET /api/agents/:id/memory/seed/farcaster`

Returns `{ fid, fname, seeded_at, fact_count }` — used by the UI to show current link status.

### 3. Frontend — Farcaster section in agent editor or settings

Add a "Farcaster" card to the agent editor (`src/editor/manifest-builder.js` — follow the existing section pattern). Show:
- A text input for `fname` (e.g. `nirholas`) with a "Link & Seed" button.
- On success: `@{fname} linked — {N} facts seeded ✓`
- A "Re-seed" button (if already linked).

Alternatively, place this in `public/settings/index.html` in a "Social Accounts" section if a settings page already has that structure. Read the existing file to decide which location integrates more cleanly.

### 4. Manifest / agent detail

Include in the agent detail response:
```json
{ "social": { "farcaster": { "fid": 12345, "fname": "nirholas", "seeded_at": "...", "fact_count": 12 } } }
```

### 5. Route

Add to `vercel.json` (follow existing `agents/[id]` subpath patterns):
```json
{ "src": "/api/agents/([^/]+)/memory/seed/farcaster(/.*)?", "dest": "/api/agents/[id]/memory-seed-farcaster.js" }
```

## Environment variables required

Add to `.env.example` and `api/_lib/env.js`:
```
NEYNAR_API_KEY=
```

If unset, endpoint returns 501 `not_configured`.

## Out of scope

- Likes, replies, or channels — recent top-level casts only.
- Real-time sync via Farcaster hubs or webhooks.
- X / Twitter (separate prompt).

## Acceptance

- [ ] POST with a valid `fname` fetches casts, seeds ≥1 fact, returns `{ fid, facts }`.
- [ ] POST without `NEYNAR_API_KEY` returns 501.
- [ ] POST with unknown `fname` returns 404 `farcaster_user_not_found`.
- [ ] Re-seeding within 6h returns 429.
- [ ] Facts appear in `GET /api/agent-memory/:id`.
- [ ] `node --check api/agents/[id]/memory-seed-farcaster.js` passes.
- [ ] `npx vite build` passes.

## Reporting

- Shipped: …
- Skipped: …
- Broke / regressions: …
- Unrelated bugs noticed: …
