# 06-04 — Pull-from-chain manifest resolver

## Why it matters

This is the payoff for Layer 6. Given an onchain agent id, any host — Lobehub, Claude, a cold wallet, a random web page — should be able to load and render the agent *without* our server. The resolver is the code path that turns `erc8004://<chain>:<id>` into a runnable manifest + GLB, using only public RPC and IPFS. If this works, the product escapes us.

## Context

- Existing resolver: [src/agent-resolver.js](../../src/agent-resolver.js) (DB-backed today).
- Manifest spec: [specs/AGENT_MANIFEST.md](../../specs/AGENT_MANIFEST.md).
- ERC-8004 ABI: [src/erc8004/abi.js](../../src/erc8004/abi.js).
- Web component: [src/element.js](../../src/element.js) (consumer).
- Requires: 06-01 merged.

## What to build

### URL / URN scheme

Accept any of:

- `erc8004://<chain>:<onchain_id>`
- `https://3dagent.vercel.app/a/<uuid>` (database-backed shortcut — still works, but redirects to the chain form if the agent is onchain)
- A raw hex `onchain_id` with chain explicit in an attribute

### Resolver function — `src/agent-resolver.js` (extend)

```js
export async function resolveAgent(urn, { rpcUrl, ipfsGateway } = {}) {
  // 1. parse urn -> { chain_id, onchain_id }
  // 2. fetch IdentityRegistry(chain_id).getAgent(onchain_id)
  // 3. read manifest_cid, controller, updated_at
  // 4. fetch manifest JSON via ipfs gateway(s) with fallback
  // 5. resolve GLB and thumbnails (ipfs:// → https:// via gateway)
  // 6. attach reputation / validation rollups (lightweight; 06-02/06-03)
  // 7. return a normalized manifest object
}
```

- Support multiple IPFS gateway fallbacks (`ipfs.io`, `w3s.link`, a configured primary). Race with `Promise.any`.
- Cache resolved manifests in-memory for 5 minutes keyed by `(chain, id, updated_at)`.
- Validate the resolved manifest against [specs/AGENT_MANIFEST.md](../../specs/AGENT_MANIFEST.md). Reject on schema mismatch.

### Web component integration

`<agent-3d src="erc8004://base:42">` must work offline-of-us:

- If `src` is an `erc8004://` URI, the component goes straight to the resolver. No call to our API unless the optional `registry-proxy` attribute is set.
- If `src` is a uuid or URL form, fallback to the existing DB resolver.

### Optional proxy — `api/resolve.js`

- `GET /api/resolve?urn=erc8004://base:42` → returns the resolved manifest JSON.
- Used by hosts that can't run web3 in-browser (legacy Claude Artifact CSP, etc.).
- Cached 5 minutes. Respects `If-None-Match` via manifest CID as ETag.

### CLI — `scripts/resolve-agent.mjs`

`node scripts/resolve-agent.mjs erc8004://base:42` prints the resolved manifest. Useful for debugging and for the portability smoke test (06-06).

## Out of scope

- Writing the in-component rendering path (that's already solved for local manifests).
- Supporting non-EVM chains.
- Pinning manifests from the resolver (pinning lives in 06-01).
- Any reliance on our database for the pure chain path.

## Acceptance

1. Resolve an agent by `erc8004://base-sepolia:<id>` using only a public RPC and an IPFS gateway — returns a valid manifest.
2. The same agent resolves via `https://…/a/<uuid>` and produces an equivalent manifest object.
3. Kill the primary IPFS gateway in config → resolution still succeeds via fallback.
4. Point `<agent-3d src="erc8004://…">` at a known agent → the avatar renders with the correct GLB and animation set.
5. `node scripts/resolve-agent.mjs erc8004://base:<id>` prints JSON.
6. `node --check` passes on modified files.
