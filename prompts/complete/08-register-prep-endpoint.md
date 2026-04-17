# 08 — Server-side registration prep endpoint

## Why

Registration today is 100% client-side: [src/erc8004/agent-registry.js](../../src/erc8004/agent-registry.js) builds the JSON, pins to IPFS, calls the contract. That works but requires the client to hold pinning tokens (web3.storage / Filebase) — which means either shipping them publicly (bad) or forcing each user to bring their own.

This prompt ships a server-side **prep** endpoint that does the non-signing steps — build canonical JSON, pin to IPFS — and returns the CID. The client then only has to sign the `registerAgent(owner, metadataURI)` transaction.

## What to build

### 1. Endpoint

Create `api/agents/register-prep.js`:

- `POST /api/agents/register-prep` — **auth required** via `getSessionUser`.
- Body: `{ name, description, avatarId, brain?, skills?, embedPolicy?, demoSlug? }`.
- Validation:
    - `name`: 1–60 chars.
    - `description`: ≤ 280 chars.
    - `avatarId`: must belong to the authed user (`SELECT * FROM avatars WHERE id = ${avatarId} AND owner_user_id = ${user.id}`). 404 if not.
    - `skills`: array of strings, ≤ 16, each ≤ 40 chars, ascii + hyphen.
- Build the registration JSON — canonical shape per [specs/AGENT_MANIFEST.md](../../specs/AGENT_MANIFEST.md). Must include `_baseURI` ending in `/` (hard rule per repo invariants).
- Pin to IPFS via helpers in [src/ipfs.js](../../src/ipfs.js). If ipfs helpers aren't import-safe from serverless, use direct HTTP against `api.web3.storage` — document which path taken.
- Store a prep record: `INSERT INTO agent_registrations_pending (user_id, cid, payload, created_at, expires_at)` with a 1-hour expiry. (If that table doesn't exist, create a migration SQL file at `scripts/sql/<ts>-create-agent-registrations-pending.sql` — don't auto-apply.)
- Return `{ ok: true, cid, metadataURI: 'ipfs://<cid>', prepId }`.

Rate-limit via `limits.authedWrite`. Never log the full payload body (may contain PII).

### 2. Confirm endpoint

Create `api/agents/register-confirm.js`:

- `POST /api/agents/register-confirm` with `{ prepId, chainId, agentId, txHash }`.
- Verifies the prep record exists, not expired, belongs to the authed user.
- Verifies the tx on-chain via a read-only RPC: fetch the tx receipt, parse the `AgentRegistered` event, check the event's `metadataURI` matches the prep record's `ipfs://<cid>`.
- On success: upsert the `agents` row (or whatever the existing agents table shape requires — read [api/\_lib/db.js](../../api/_lib/db.js) / the schema for authority) with `{ owner_user_id, chain_id, onchain_agent_id, metadata_cid, avatar_id }`.
- Returns `{ ok: true, agentId }`.

This closes the loop without ever needing a private key on the server.

### 3. Docs

Create `api/agents/REGISTER_FLOW.md` — sequence diagram (ascii is fine), endpoints involved, what the client has to do (prep → sign → confirm).

## Files you own

- Create: `api/agents/register-prep.js`
- Create: `api/agents/register-confirm.js`
- Create: `api/agents/REGISTER_FLOW.md`
- Create: `scripts/sql/<timestamp>-create-agent-registrations-pending.sql` (only if the table doesn't exist — check via `Grep` in `scripts/sql/` first)

## Files off-limits

- `src/erc8004/agent-registry.js`, `src/ipfs.js`, `api/_lib/*` — read-only.
- Any other `api/agents/*.js` — read-only. If you need to read the schema, do it via grep, not editing.

## Acceptance

- `POST /api/agents/register-prep` unauth → 401.
- Authed + valid body → 200 + cid + `ipfs://` URI; fetching that URI returns the pinned JSON.
- `POST /api/agents/register-confirm` with a fake txHash → rejected by receipt verification.
- `node --check` passes.
- `npm run build` clean.

## Reporting

IPFS pinning backend used, any schema changes needed (with the migration SQL included in PR), what happens if `agent_registrations_pending` doesn't exist yet.
