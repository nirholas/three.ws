# Task 02 — IPFS / Arweave pinning

## Why

On-chain records must point to content-addressed storage, not to our R2 URLs. Without pinning, the chain record decays the moment we reshape R2.

## Read first

- [src/erc8004/agent-registry.js](../../src/erc8004/agent-registry.js) — existing `pinToIPFS()` stub
- [src/ipfs.js](../../src/ipfs.js) — gateway resolution, already handles `ipfs://` and `ar://`
- R2 flow in [api/avatars/index.js](../../api/avatars/index.js) + [api/avatars/presign.js](../../api/avatars/presign.js)
- Pinata / web3.storage / nft.storage / Filebase docs (pick one, justify in code)

## Build this

### 1. Pick a pinning provider

Must support: JSON pins + binary (GLB) pins, dashboard, API keys, free tier. Recommend **Pinata** (most mature API) or **web3.storage** (UCAN-based, slicker). Document the choice at the top of the new `api/pin/` file.

### 2. Server endpoint

`POST /api/pin` (auth required):
```
body: { kind: 'json' | 'glb', uri?: string, data?: object, contentType?: string }
```

- If `kind: 'json'`, `data` is the raw JSON; server pins it directly.
- If `kind: 'glb'`, `uri` points to an existing R2 URL we control; server fetches it server-side and pins. (Never accept arbitrary URLs from the client — only R2 URLs belonging to this user's avatars.)
- Response: `{ cid, gateway: 'https://ipfs.io/ipfs/<cid>', size, pinnedAt }`.
- Store a row in a new `pins` table: `id, user_id, kind, cid, r2_key, size, pinned_at, provider, provider_pin_id`.

### 3. Auto-pin on "Deploy on-chain"

Hook from task 01: before registering, call `/api/pin` for both the GLB and the metadata JSON. Return `ipfs://<cid>` URIs to the caller.

### 4. Redundancy

Pin to **two** providers (primary + secondary) if env configured. Store both provider IDs. Document how to un-pin from one (dashboard link).

### 5. Rate limit

Cap at 10 pins / user / hour. Return 429 with `{ retry_after }` on overflow.

## Don't do this

- Do not delete the R2 source after pinning. R2 stays as the fast-read cache.
- Do not expose pin API keys in client code. Server-only.
- Do not pin to a provider that deletes free-tier content after N days — check the terms.
- Do not re-pin if the `cid` for this `user_id + r2_key` already exists.

## Acceptance

- [ ] `POST /api/pin` signed out → 401.
- [ ] Signed in, pin a JSON → returns a CID, `ipfs cat <cid>` via gateway returns the same JSON.
- [ ] Pin the same JSON twice → second call returns the cached CID (no new upload).
- [ ] Pin the user's avatar GLB → resulting CID loads in the viewer via `ipfs://<cid>`.
- [ ] 11th pin in an hour → 429.
- [ ] `npm run build` passes.

## Reporting

- Provider chosen + why
- Pinata dashboard screenshot (or equivalent) showing pinned content
- `pins` table schema + migration file
- curl transcripts for the success + rate-limit cases
