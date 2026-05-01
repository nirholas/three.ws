---
mode: agent
description: 'Phase 2 — Seed agent memory from GitHub activity: repos, languages, commit style, README writing style'
---

# Phase 2 · Social Memory Seeding — GitHub

**Branch:** `feat/social-memory-github`
**Standalone.** No other prompt must ship first.

## Why it matters

An agent that knows the user's real tech stack, open-source contributions, and communication style from their GitHub profile feels like *them*, not a generic assistant. This prompt connects a GitHub OAuth app to the agent memory system so the agent can say "I maintain X and Y, I mostly write Go and Rust, here's my commit style."

## What to build

### 1. GitHub OAuth connect flow

**`GET /api/auth/github/connect`** — redirects to GitHub OAuth with scopes `read:user,public_repo`.
- `client_id`: `GITHUB_OAUTH_CLIENT_ID` env var
- `redirect_uri`: `${PUBLIC_APP_ORIGIN}/api/auth/github/callback`
- `state`: HMAC-signed `{ userId, agentId }` to prevent CSRF

**`GET /api/auth/github/callback`** — handles the GitHub OAuth callback.
- Validate `state` (HMAC verify with `JWT_SECRET`).
- Exchange `code` for `access_token` via `https://github.com/login/oauth/access_token`.
- Fetch user profile: `GET https://api.github.com/user` (Authorization: `token {access_token}`).
- Store in a new table:
  ```sql
  CREATE TABLE IF NOT EXISTS social_connections (
    id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id      uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    provider     text        NOT NULL,          -- 'github', 'x', 'farcaster'
    provider_uid text        NOT NULL,          -- GitHub user ID (string)
    username     text        NOT NULL,
    access_token text        NOT NULL,          -- encrypt with AES-256-GCM using key derived from JWT_SECRET via HKDF (same pattern as agent wallet keys)
    scopes       text        NOT NULL,
    connected_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE(user_id, provider)
  );
  ```
  Add this table to `api/_lib/schema.sql`.
- Redirect to `/settings?tab=connected-accounts&github=connected`.

File: `api/auth/github/[action].js` dispatching on `connect` vs `callback`.

### 2. Memory seeding — `POST /api/agents/:id/memory/seed/github`

File: `api/agents/[id]/memory-seed.js`

Auth: session user must own the agent AND have a `github` row in `social_connections`.

Flow:
1. Load the stored (encrypted) `access_token` for this user's GitHub connection; decrypt it.
2. Fetch from GitHub API (use `Authorization: token {access_token}` on every call):
   - `GET /user` → login, name, bio, company, location
   - `GET /user/repos?sort=pushed&per_page=30` → name, description, language, stargazers_count, pushed_at
   - `GET /search/commits?q=author:{login}&sort=author-date&per_page=20` (or `GET /repos/{owner}/{repo}/commits?author={login}&per_page=5` on top 3 repos) → commit messages
3. Distill into agent memory entries using **Claude** (`claude-haiku-4-5-20251001`) — this keeps cost low:
   ```
   System: You distill GitHub activity into concise memory facts for an AI agent.
   User:   {JSON of repos + commits + profile}
   Tool:   extract_memory_facts → { facts: string[] } — up to 15 single-sentence facts
   ```
4. Write each fact to `agent_memories` (the existing memory table — read `api/agent-memory.js` for the exact schema and `sql` patterns).
   - `tag`: `'github'`
   - `value`: the fact string
   - `source`: `'github_seed'`
   - `created_at`: now()
   - Upsert by `(agent_id, tag, value)` so re-seeding is idempotent.
5. Return `{ seeded: N, facts: string[] }`.

Rate limit: 1 seed per agent per 24 hours (`limits.memorySeed(agentId)` — add this limiter following existing patterns in `api/_lib/rate-limit.js`).

### 3. Frontend — Connected Accounts settings panel

The settings page is at `public/settings/index.html`. Add a "Connected Accounts" section with a GitHub card showing:
- "Connect GitHub" button → links to `/api/auth/github/connect?agent_id={current agent id}`
- After connection: username, avatar, "Seed memory" button → POST `/api/agents/:id/memory/seed/github`
- Status: "Last seeded 2h ago" (use `seeded_at` returned from the seed endpoint).

This is a vanilla HTML/JS page; no Svelte. Fetch `/api/auth/status` (or `GET /api/agents/:id` which includes user info) to know if already connected.

Add `GET /api/auth/github/status` → `{ connected: bool, username, connected_at }`.

### 4. Manifest inclusion

When `GET /api/agents/:id` or `/api/agents/:id/manifest` is called, include a summary block if GitHub is seeded:
```json
{ "social": { "github": { "username": "nirholas", "seeded_at": "...", "fact_count": 12 } } }
```

## Environment variables required

Add to `.env.example`:
```
GITHUB_OAUTH_CLIENT_ID=
GITHUB_OAUTH_CLIENT_SECRET=
```

Both are loaded via `api/_lib/env.js` using the `opt()` helper. If unset, `GET /api/auth/github/connect` returns 501 `not_configured`.

## Encryption

Reuse the AES-256-GCM encryption pattern already used for agent wallet private keys in `api/_lib/crypto.js` (search for `encryptSecret` / `decryptSecret` or equivalent). Derive the key from `JWT_SECRET` via HKDF with info `github-token`.

## Out of scope

- Private repo access (public_repo scope only).
- Webhook or incremental sync — seed is manual + rate-limited.
- Automated re-seeding via cron.
- X or Farcaster (separate prompts).

## Acceptance

- [ ] `/api/auth/github/connect` redirects to GitHub with correct `client_id` and signed `state`.
- [ ] Callback exchanges code, stores encrypted token, redirects.
- [ ] POST `/api/agents/:id/memory/seed/github` returns facts and writes them to `agent_memories`.
- [ ] Re-running seed within 24h returns 429.
- [ ] Agent memories are visible via `GET /api/agent-memory/:id`.
- [ ] `node --check` passes on all new files.
- [ ] `npx vite build` passes.

## Reporting

- Shipped: …
- Skipped: …
- Broke / regressions: …
- Unrelated bugs noticed: …
