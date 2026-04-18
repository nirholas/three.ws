# Task 12 — `GET /api/permissions/metadata` (public, embed-facing)

## Why

An embed (Claude artifact, LobeHub plugin, iframe on a random site) needs a CORS-open, unauthenticated way to learn what delegations an agent holds so its skills can decide whether to offer a "Tip the creator" or "Subscribe" button, and so the SDK can pre-seed its delegation cache. This is distinct from `/list` — metadata is cacheable, always public-view only, and is the canonical input to the manifest-derived `permissions` field.

## Read first

- [00-README.md](./00-README.md) — canonical endpoint
- [specs/AGENT_MANIFEST.md](../../specs/AGENT_MANIFEST.md) — task 02 adds the `permissions.delegations[]` shape; mirror it in the response
- [api/agent-oembed.js](../../api/agent-oembed.js) — good example of a public embed-facing GET endpoint with aggressive cache headers
- [api/\_lib/http.js](../../api/_lib/http.js) — `json`, `cors`, `wrap`

## Build this

Create `api/permissions/metadata.js` (GET only):

1. Method/CORS (wide-open: `*`)/rate-limit (`limits.read` or looser, this is cache-friendly).
2. **Query**: `agentId` (uuid) — required. Optional `chainId` (int) filter.
3. **SQL**: select only `active` delegations for that agent, ordered `expires_at DESC`. Do NOT return revoked/expired ones — the embed only cares about what's currently usable.
4. **Shape** (must match `specs/AGENT_MANIFEST.md` `permissions.delegations[]`):
    ```jsonc
    {
        "ok": true,
        "agentId": "...",
        "spec": "erc-7715/0.1",
        "delegationManager": "0x...", // resolved from abi.js per chainId
        "delegations": [
            {
                "chainId": 84532,
                "delegator": "0x...",
                "delegate": "0x...",
                "hash": "0x...",
                "scope": {
                    /* from column, redacted signatures */
                },
                "expiresAt": "...",
                "createdAt": "...",
                "envelope": {
                    /* full signed envelope INCLUDING signature — it's on-chain verifiable, not secret */
                }
            }
        ]
    }
    ```
    Signatures are NOT secret — they're meant to be on-chain-verifiable. Including the envelope is what lets an embed redeem without a round-trip. This is the intentional difference from `/list`'s public view.
5. **Cache**: `Cache-Control: public, max-age=60, s-maxage=300, stale-while-revalidate=600`. Set `ETag` from a hash of the JSON response.
6. **CORS**: `Access-Control-Allow-Origin: *`. This endpoint is the fastest path for embeds.
7. **404** if agentId doesn't exist; return `{ ok: false, error: 'agent_not_found' }`.
8. **Empty `delegations: []`** is not an error — just return `ok: true` with an empty array.
9. **Add a `Last-Modified`** header derived from `MAX(created_at, revoked_at)` of the agent's delegations.

## Don't do this

- Do not require auth. This is the public metadata path. (If you think a particular agent should be private → that's an agent-level privacy flag, not this endpoint's job.)
- Do not return `id` (the internal UUID) — embeds don't need it and it's an internal handle. `hash` is the stable identifier.
- Do not return `delegation_json` minus signature — always send the full signed envelope or nothing.
- Do not do per-chain pagination. If an agent has >50 delegations across chains, respond with all of them.

## Acceptance

- [ ] Endpoint responds CORS-open, cacheable.
- [ ] Envelope shape matches manifest spec byte-compatible.
- [ ] ETag / Last-Modified / Cache-Control all set correctly.
- [ ] Empty-agent case returns `[]`, not 404.
- [ ] Unknown agent returns 404 with `agent_not_found`.
- [ ] `node --check` + `npm run build` pass.

## Reporting

- `curl -I` output showing all cache headers.
- `curl` of a seeded agent showing the full response.
- Time-to-first-byte measurement (should be sub-200ms from a warm cache).
