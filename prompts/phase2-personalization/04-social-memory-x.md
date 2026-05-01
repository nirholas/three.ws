---
mode: agent
description: 'Phase 2 — Seed agent memory from X (Twitter) timeline via OAuth 2.0 PKCE + Twitter v2 API'
---

# Phase 2 · Social Memory Seeding — X (Twitter)

**Branch:** `feat/social-memory-x`
**Standalone.** No other prompt must ship first.

## Why it matters

X is where most of the target user base posts opinions, threads, and links. Seeding agent memory from tweets gives the agent the user's voice, strong opinions, and interests in their most natural form.

## What to build

### 1. X OAuth 2.0 PKCE connect flow

X v2 API uses OAuth 2.0 with PKCE (not OAuth 1.0a). Scopes needed: `tweet.read users.read offline.access`.

**`GET /api/auth/x/connect`**
- Generate a `code_verifier` (random 43–128 char base64url string) and derive `code_challenge = base64url(sha256(code_verifier))`.
- Store `{ code_verifier, userId, agentId }` in a short-lived Redis key (`x_oauth:{state}`, TTL 600s). Use `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` — already in env.
- Redirect to:
  ```
  https://twitter.com/i/oauth2/authorize
    ?response_type=code
    &client_id={X_OAUTH_CLIENT_ID}
    &redirect_uri={PUBLIC_APP_ORIGIN}/api/auth/x/callback
    &scope=tweet.read+users.read+offline.access
    &state={state}
    &code_challenge={code_challenge}
    &code_challenge_method=S256
  ```

**`GET /api/auth/x/callback`**
- Retrieve `code_verifier` from Redis by `state`; delete the Redis key immediately.
- POST to `https://api.twitter.com/2/oauth2/token` with `code`, `code_verifier`, `redirect_uri`, `client_id` (Basic Auth with `X_OAUTH_CLIENT_ID:X_OAUTH_CLIENT_SECRET`).
- Fetch profile: `GET https://api.twitter.com/2/users/me?user.fields=name,username,description,public_metrics` with `Authorization: Bearer {access_token}`.
- Store in `social_connections` table (same table used by GitHub prompt — use `provider = 'x'`). Encrypt `access_token` and `refresh_token` with AES-256-GCM (same pattern as agent wallet keys, derive key from `JWT_SECRET` + HKDF info `x-token`).
- Redirect to `/settings?tab=connected-accounts&x=connected`.

File: `api/auth/x/[action].js` dispatching on `connect` vs `callback`.

### 2. Token refresh helper

X tokens expire in 2 hours. Before using a stored token, check `expires_at`. If expired, POST to `https://api.twitter.com/2/oauth2/token` with `grant_type=refresh_token`. Update stored token.

### 3. Memory seeding — `POST /api/agents/:id/memory/seed/x`

File: `api/agents/[id]/memory-seed-x.js`

Auth: session user must own the agent AND have an `x` row in `social_connections`.

Flow:
1. Load + decrypt `access_token` for this user's X connection; refresh if expired.
2. Fetch from X v2 API:
   - `GET https://api.twitter.com/2/users/me?user.fields=name,username,description,public_metrics` → profile
   - `GET https://api.twitter.com/2/users/{id}/tweets?max_results=100&exclude=retweets,replies&tweet.fields=text,created_at` → 100 most recent original tweets
3. Distill into memory facts using **Claude** (`claude-haiku-4-5-20251001`):
   ```
   System: You distill tweets into concise memory facts for an AI agent.
           Focus on: recurring topics, strong opinions, projects, communication style, humor.
   User:   Profile: @{username} | {description} | {followers_count} followers
           Recent tweets (newest first):
           {tweet.text}
           ...
   Tool:   extract_memory_facts → { facts: string[] } — up to 15 single-sentence facts
   ```
4. Write to `agent_memories` — `tag: 'x'`, `source: 'x_seed'`. Upsert idempotently.
5. Store on agent:
   ```sql
   UPDATE agent_identities
   SET x_username = $username, x_seeded_at = now()
   WHERE id = $agent_id;
   ```
   Add to `api/_lib/schema.sql`:
   ```sql
   ALTER TABLE agent_identities
     ADD COLUMN IF NOT EXISTS x_username   text,
     ADD COLUMN IF NOT EXISTS x_seeded_at  timestamptz;
   ```
6. Return `{ username, seeded: N, facts: string[] }`.

Rate limit: 1 seed per agent per 6 hours.

### 4. `GET /api/agents/:id/memory/seed/x`

Returns `{ connected: bool, username, seeded_at, fact_count }`.

### 5. Frontend

Add an "X" card to `public/settings/index.html` in the "Connected Accounts" section (same place as GitHub). Show:
- "Connect X" button → `/api/auth/x/connect?agent_id={id}`
- After connection: `@{username}` + "Seed memory" button
- Status: "Last seeded N hours ago"

### 6. Routes

Add to `vercel.json`:
```json
{ "src": "/api/auth/x/(.+)", "dest": "/api/auth/x/[action].js" },
{ "src": "/api/agents/([^/]+)/memory/seed/x(/.*)?", "dest": "/api/agents/[id]/memory-seed-x.js" }
```

## Environment variables required

Add to `.env.example` and `api/_lib/env.js`:
```
X_OAUTH_CLIENT_ID=
X_OAUTH_CLIENT_SECRET=
```

If unset, `GET /api/auth/x/connect` returns 501 `not_configured`.

X OAuth apps must be created at https://developer.twitter.com — the app needs "Read" permissions and a callback URL registered.

## Out of scope

- Posting tweets on behalf of the user.
- Reading DMs.
- Replying to tweets.
- Real-time timeline streaming.

## Acceptance

- [ ] `/api/auth/x/connect` redirects with correct PKCE challenge.
- [ ] Callback exchanges code, stores encrypted tokens, redirects.
- [ ] Token refresh runs automatically when `expires_at` is past.
- [ ] POST `/api/agents/:id/memory/seed/x` fetches tweets, seeds facts, returns them.
- [ ] Re-seeding within 6h returns 429.
- [ ] Facts appear in `GET /api/agent-memory/:id`.
- [ ] `node --check` passes on all new files.
- [ ] `npx vite build` passes.

## Reporting

- Shipped: …
- Skipped: …
- Broke / regressions: …
- Unrelated bugs noticed: …
