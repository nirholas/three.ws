# 18 — IPFS / Arweave pinning endpoint

## Why

Before on-chain registration, the agent manifest + GLB should be pinned to a content-addressed network so that the URI recorded on-chain is permanent. Without this, on-chain records point to R2 URLs that could rot.

## Parallel-safety

New endpoint, no edits elsewhere.

## Files you own

- Create: `api/pinning/pin.js`
- Create: `api/pinning/status.js`

## Read first

- [api/avatars/presign.js](../../api/avatars/presign.js) — confirm the R2 URL shape.
- [.env.example](../../.env.example) — check for existing pinning creds (`PINATA_JWT`, `WEB3_STORAGE_TOKEN`, `ARWEAVE_KEY`).
- [api/_lib/http.js](../../api/_lib/http.js), [api/_lib/auth.js](../../api/_lib/auth.js).

## Deliverable

### `POST /api/pinning/pin`

- Auth required (session or bearer).
- Body: `{ sourceUrl: string, kind: 'manifest' | 'glb' }`.
- Steps:
  1. Validate `sourceUrl` is an R2 URL we own OR a `data:` URL under 10 MB.
  2. HEAD the source — reject >50 MB.
  3. Pin via Pinata (preferred; use `PINATA_JWT` if set) or Web3.Storage (fallback). If neither env var is present, return `503 pinning-unconfigured` with a clear message.
  4. Return `{ ok: true, cid, gatewayUrl: 'https://ipfs.io/ipfs/' + cid, provider }`.
  5. Record the pin in a `pins` table: `{ user_id, source_url, cid, provider, kind, created_at }` — create the table lazily via `if not exists` on first call.
- Rate limit: `30/hour per user`.

### `GET /api/pinning/status?cid=...`

- Public, rate-limited `60/min per IP`.
- Returns `{ cid, pinned: boolean, provider, gatewayUrls: string[] }`.

## Constraints

- No new deps — use `fetch` against the pinning provider's HTTP API directly.
- Never log the pinning JWT.
- Gracefully handle missing env; never crash on import.

## Acceptance

- `node --check` clean on both endpoints.
- `npm run build` clean.
- If `PINATA_JWT` is set locally: curl with a test R2 URL → returns CID → `status?cid=...` confirms pinned.

## Report

- Which provider you implemented first + why.
- Whether the `pins` table creation is idempotent.
- Full env-var list you touched (add to [.env.example](../../.env.example) if missing — that edit is in scope).
