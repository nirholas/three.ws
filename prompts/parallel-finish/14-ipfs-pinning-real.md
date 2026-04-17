# Task: Make `/api/erc8004/pin` return real IPFS CIDs

## Context

Repo root: `/workspaces/3D-Agent`. Read [contracts/CLAUDE.md](../../contracts/CLAUDE.md) first.

The ERC-8004 registration flow ([src/erc8004/agent-registry.js](../../src/erc8004/agent-registry.js)) pins the agent's registration JSON via one of two paths:

1. **Pinata JWT path** — real IPFS. Good.
2. **Internal `/api/erc8004/pin` path** — currently uploads to R2 and returns an `https://...` URL. The on-chain `tokenURI` then points at a centralized R2 URL. Not truly decentralized.

We want path 2 to also return an `ipfs://<cid>` URI by uploading to an IPFS service (web3.storage, nft.storage, or a self-hosted IPFS node) and optionally _also_ mirroring to R2 for speed. The client is already happy with an `ipfs://` return value.

## Files you own (exclusive)

- [api/erc8004/pin.js](../../api/erc8004/pin.js) — the only file you edit.

**Do not edit** anything else. Not the client, not the registry, not the crawler.

## Requirements

- **Prefer:** `WEB3_STORAGE_TOKEN` env var → upload via web3.storage HTTP API, return `ipfs://<cid>/<filename>`.
- **Fallback:** `NFT_STORAGE_TOKEN` env var → upload via nft.storage, same return format.
- **Final fallback:** if neither is set, _and_ `R2_BUCKET` is configured, keep the existing R2 path but also return `{ url, ipfs: null, warning: 'R2-only pin — not decentralized' }` so the client can surface a clear warning.
- **Response shape:**

    ```
    { cid: string | null, uri: string, url: string, warning?: string }
    ```

    - `uri` is the preferred value to pin on-chain (`ipfs://...` when possible).
    - `url` is an HTTPS gateway URL (always set, even for IPFS — use `https://w3s.link/ipfs/<cid>`).
    - `cid` is the raw CID string when available.

- **Content-addressing:** if the same bytes are uploaded twice, the same `cid` comes back (web3.storage and nft.storage both guarantee this). Verify this in a comment.

- **Rate limit:** apply `limits.authIp(ip)` from `api/_lib/rate-limit.js`.

- **Auth:** require `getSessionUser()` — this endpoint is not public.

- **Size limit:** enforce 25 MB max (avatar GLBs can legitimately reach ~20 MB). Return `413 payload_too_large` otherwise.

- **Mime validation:** accept `application/json`, `model/gltf-binary`, `image/png`, `image/jpeg`, `image/webp`. Reject others with `415 unsupported_media_type`.

## Non-goals

- Do not remove the existing R2 code entirely — keep it as the final fallback.
- Do not change the Pinata path in [src/erc8004/agent-registry.js](../../src/erc8004/agent-registry.js).
- Do not introduce a background job to re-pin expired content (web3.storage retains ≥ 30 days by default — document but don't automate).
- Do not add a new DB table to track pinned CIDs. Idempotent by CID is enough.

## Verification

```bash
node --check api/erc8004/pin.js
npm run build
```

Manually (requires a web3.storage token):

```
curl -X POST localhost:3000/api/erc8004/pin \
  -H 'content-type: application/json' \
  -H 'cookie: __Host-sid=...' \
  -d '{"filename":"test.json","content":"{\"hello\":\"world\"}","contentType":"application/json"}'
```

Expected: `{ cid: "bafy...", uri: "ipfs://bafy.../test.json", url: "https://w3s.link/ipfs/bafy.../test.json" }`.

## Report back

File edited, commands + output, which IPFS service you primarily used + why, what happens when all env vars are missing (should still work with R2-only + warning, not 500).
