# Agent Registration Flow — Server-side Prep + Client-side Sign

## Overview

ERC-8004 agent registration is a two-step flow that keeps the private key on the client:

1. **Prep** (server): Build canonical JSON, pin to IPFS, store transient record → get CID
2. **Sign** (client): Sign the registration tx, submit to blockchain
3. **Confirm** (server): Verify tx succeeded, metadata CID matches, update database

The server-side prep endpoint eliminates the need for users to manage IPFS pinning tokens (web3.storage / Filebase), while keeping blockchain operations fully client-controlled.

---

## Sequence Diagram

```
┌────────┐                    ┌──────────────┐                ┌─────────────────┐
│ Client │                    │ Our Servers  │                │ IPFS / Blockchain│
└───┬────┘                    └──────┬───────┘                └────────┬────────┘
    │                                │                                 │
    │ 1. POST /api/agents/register-prep        │                       │
    │    {name, description, avatarId, ...}   │                       │
    ├─────────────────────────────────────────>│                       │
    │                                 │                                 │
    │                        (validate input,  │                       │
    │                         build JSON,      │                       │
    │                         pin to IPFS)     │                       │
    │                                 │                                 │
    │                                 ├────────────────────────────────>│
    │                                 │  Pin registration.json          │
    │                                 │<────────────────────────────────┤
    │                                 │  CID returned                   │
    │                                 │                                 │
    │                        (store prep record,│                       │
    │                         1-hour expiry)   │                       │
    │<─────────────────────────────────────────┤                       │
    │ {ok: true, cid, metadataURI, prepId}    │                       │
    │                                 │                                 │
    │ 2. Sign tx locally               │                       │
    │    (registerAgent(owner, metadataURI))  │                       │
    │                                 │                                 │
    │ 3. Submit tx to blockchain       │                                 │
    │────────────────────────────────────────────────────────────────>│
    │                                 │                                 │
    │                                 │                         (wait for confirmation)
    │<─────────────────────────────────────────────────────────────────┤
    │ tx.hash returned                │                                 │
    │                                 │                                 │
    │ 4. POST /api/agents/register-confirm     │                       │
    │    {prepId, chainId, agentId, txHash}   │                       │
    ├─────────────────────────────────────────>│                       │
    │                                 │                                 │
    │                        (fetch tx receipt,│                       │
    │                         parse event,     │                       │
    │                         verify CID match)│                       │
    │                                 ├────────────────────────────────>│
    │                                 │  getTransactionReceipt(txHash)  │
    │                                 │<────────────────────────────────┤
    │                                 │  Receipt with logs              │
    │                                 │                                 │
    │                        (upsert agent_    │                       │
    │                         identities,      │                       │
    │                         consume prep)    │                       │
    │<─────────────────────────────────────────┤                       │
    │ {ok: true, agentId}             │                                 │
    │                                 │                                 │
```

---

## Endpoints

### 1. `POST /api/agents/register-prep`

**Purpose:** Build, pin, and reserve a registration JSON for the next 1 hour.

**Authentication:** Session cookie (`getSessionUser`) required.

**Rate limit:** `limits.authIp` (per-user, 30 per 10 min).

**Request body:**

```json
{
	"name": "Coach Leo",
	"description": "A football coach who reviews your form.",
	"avatarId": "<uuid of owned avatar>",
	"brain": {
		"provider": "anthropic",
		"model": "claude-opus-4-6",
		"instructions": "instructions.md"
	},
	"skills": ["wave", "dance"],
	"embedPolicy": {},
	"demoSlug": "coach-leo"
}
```

**Validation:**

- `name`: 1–60 chars.
- `description`: ≤ 280 chars.
- `avatarId`: Must belong to the authed user (404 if not).
- `skills`: Array of ≤ 16 strings, each 1–40 chars, alphanumeric + hyphen.
- `brain`, `embedPolicy`, `demoSlug`: Optional.

**Response (200 OK):**

```json
{
	"ok": true,
	"cid": "bafkreigenerated...",
	"metadataURI": "ipfs://bafkreigenerated...",
	"prepId": "<uuid>"
}
```

**Pinning strategy:**

- If `WEB3_STORAGE_TOKEN` is set: pins to web3.storage, returns real CID.
- Otherwise: stores to R2, generates stub CID from content hash.

**Error responses:**

- 401: Not authenticated.
- 404: Avatar not found or doesn't belong to user.
- 429: Rate limited.

---

### 2. `POST /api/agents/register-confirm`

**Purpose:** Verify on-chain registration tx, confirm metadata CID, upsert agent record.

**Authentication:** Session cookie required. Must match the `prepId` owner.

**Rate limit:** `limits.authIp` (per-user, 30 per 10 min).

**Request body:**

```json
{
	"prepId": "<uuid from register-prep>",
	"chainId": 8453,
	"agentId": "1234",
	"txHash": "0x..."
}
```

**Verification steps:**

1. Prep record exists, belongs to authed user, not expired (> now).
2. TX receipt fetched from the chain's RPC (status = 1, success).
3. Registered event parsed from logs.
4. Event's `agentURI` (metadataURI) matches prep record's `metadataURI`.
5. Agent record upserted to `agent_identities` table.

**Response (200 OK):**

```json
{
	"ok": true,
	"agentId": "<agent_identities.id>"
}
```

**Side effects:**

- Prep record is deleted (consumed), preventing reuse.
- Agent identity row is inserted or updated.

**Error responses:**

- 400: Chain unsupported, TX not found, TX failed, event parse failed, CID mismatch.
- 401: Not authenticated.
- 404: Prep not found or expired.
- 409: Metadata URI mismatch.
- 429: Rate limited.

---

## Notes

### IPFS / Pinning

- **Server-side benefit:** Users don't need to manage keys or tokens; prep endpoint owns the pinning.
- **Fallback:** If web3.storage isn't configured, the JSON is stored to R2 and a stub CID is generated.
- **Client-side GLB:** The client still manages its own GLB pinning (via `pinFile()` in `src/erc8004/agent-registry.js`). The prep endpoint only pins the registration JSON.

### Prep record expiry

- Prep records expire after **1 hour**. If the user signs and submits a TX after 1 hour, the confirm endpoint will reject it.
- This is by design: stale preps cannot be confirmed, protecting against accidental delayed confirms or pre-signed TXs that sit unsigned for too long.

### On-chain event verification

- The confirm endpoint fetches the TX receipt from the chain's public RPC (from `SERVER_CHAIN_META`).
- It decodes the `Registered` event from the logs to extract the `agentURI`.
- The `agentURI` must exactly match the `ipfs://CID` that was reserved in the prep step.

### Database schema

**agent_registrations_pending:**

- `id` (uuid, PK)
- `user_id` (uuid, FK to users)
- `cid` (text) — IPFS CID
- `metadata_uri` (text) — `ipfs://CID` or http URL
- `payload` (jsonb) — the full registration JSON
- `created_at`, `expires_at` (timestamptz)

**agent_identities** (updated by confirm):

- `user_id`, `name`, `description`, `avatar_id`
- `chain_id`, `erc8004_agent_id`, `erc8004_registry`, `registration_cid`

---

## Example flow (Happy path)

1. User fills out form → `POST /api/agents/register-prep`.
2. Server returns `{cid, metadataURI, prepId}`.
3. Client calls `registerAgent()` on-chain with `metadataURI` → gets `agentId` + `txHash`.
4. Client calls `POST /api/agents/register-confirm` with `txHash`.
5. Server verifies, upserts agent identity → returns success.
6. Dashboard shows "Agent registered on-chain as #1234".
