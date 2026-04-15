# 06-12 — Onchain: IPFS pinning with fallback

**Branch:** `feat/ipfs-pinning-fallback`
**Stack layer:** 6 (Onchain portability)
**Depends on:** nothing

## Why it matters

Manifests and GLBs pinned to web3.storage today rely on a single gateway. If web3.storage rate-limits or goes down, every embed across every host breaks. Pinning to a second pinning service and serving via a fallback gateway list makes the system robust.

## Read these first

| File | Why |
|:---|:---|
| [src/erc8004/agent-registry.js](../../src/erc8004/agent-registry.js) | Today's pin path. |
| [src/ipfs.js](../../src/ipfs.js) | IPFS helpers. |
| [.env.example](../../.env.example) | Document new env vars. |

## Build this

1. Add a second pinning provider — `pinata` (no SDK, plain `fetch` to `https://api.pinata.cloud/pinning/pinFileToIPFS`). Configurable via `PINATA_JWT`. If unset, skip silently.
2. Pin in parallel; the upload returns the union `{ cid, providers: ['web3', 'pinata'] }`. Persist in `pins` table.
3. **Gateway list** in `src/ipfs.js`:
   ```js
   export const IPFS_GATEWAYS = [
     'https://w3s.link/ipfs/',
     'https://gateway.pinata.cloud/ipfs/',
     'https://ipfs.io/ipfs/',
     'https://cloudflare-ipfs.com/ipfs/',
   ];
   export async function fetchFromIpfs(cid, opts) { /* race + fallback */ }
   ```
   Race the first 2; if both fail/timeout (3s), fall back to the rest serially.
4. Update [src/manifest.js](../../src/manifest.js) and any GLB loader that takes `ipfs://` URLs to use `fetchFromIpfs`.
5. Add `scripts/repin.mjs <cid>` — utility to re-pin an existing CID to all configured providers.

## Out of scope

- Do not run our own IPFS node.
- Do not implement Filecoin deals.
- Do not migrate existing pins yet — only new ones use the dual-pin path.

## Acceptance

- [ ] New uploads pin to web3.storage + pinata when both env vars present.
- [ ] `fetchFromIpfs` returns the first successful gateway.
- [ ] If the primary gateway 5xx's, the secondary serves the manifest in < 5s.
- [ ] `scripts/repin.mjs` re-pins an existing CID.

## Test plan

1. Set `PINATA_JWT`. Upload a new manifest. Confirm both providers return success.
2. Block `w3s.link` in /etc/hosts. Reload an agent — it still resolves via fallback.
3. Run `scripts/repin.mjs bafyTest…` — confirm both providers acknowledge.
