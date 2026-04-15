# 06-02 — Render an agent *from chain* into a host app

**Branch:** `feat/onchain-agent-resolution`
**Stack layer:** 6 (Onchain identity — the novel unlock)
**Depends on:** 06-01, 05-01 or 05-02 (a host integration to validate against)
**Blocks:** nothing — this is the top of the stack

## Why it matters

This is the entire strategic bet: a host app (Claude Artifact, Lobehub, anything) takes an ERC-8004 agent id and renders the agent embodied — pulling the identity, avatar URL, skills, and reputation directly from chain, with our platform only serving the runtime. When this works, *other people's apps* can render *our* agents without knowing or caring about our backend.

## Read these first

| File | Why |
|:---|:---|
| [src/erc8004/agent-registry.js](../../src/erc8004/agent-registry.js) | `registerAgent()` + JSON shape — the mirror of resolution. |
| [src/erc8004/abi.js](../../src/erc8004/abi.js) | ABIs, deployed addresses, chain constants. |
| [src/element.js](../../src/element.js) | `<agent-3d>` — gets a new attribute mode. |
| [src/agent-resolver.js](../../src/agent-resolver.js) | Existing manifest resolver; extend it. |
| [specs/](../../specs/) | Manifest spec — confirm agent JSON matches. |

## Build this

### New `<agent-3d>` attribute: `chain-id` + `onchain-id`

Usage:
```html
<agent-3d chain-id="84532" onchain-id="123"></agent-3d>
```

On connect, the component:
1. Reads a free/public RPC for the given `chain-id` (configurable via `rpc-url` attr; defaults to a set of known public RPCs keyed by chain id).
2. Calls `IdentityRegistry.getAgent(onchainId)` → returns `{ registrationURI, owner }`.
3. Fetches the registration JSON from `registrationURI` (HTTP or IPFS gateway).
4. Reads `avatarUrl`, `name`, `skills`, `webPresence` from the JSON.
5. Loads the GLB directly from `avatarUrl` (no dependency on our backend).
6. Renders, exactly as if `agent-id` had been used.

### Extend `src/agent-resolver.js`

Add `resolveFromChain({ chainId, onchainId, rpcUrl })`. Cache the registration JSON in memory (in-tab) and in `localStorage` with a short TTL (hours). Document the cache in the PR description.

### Ship a test artifact

A static HTML file (not a new endpoint — just something committed under `examples/onchain/`) that includes only:

```html
<script type="module" src="https://3dagent.vercel.app/dist-lib/agent-3d.js"></script>
<agent-3d chain-id="84532" onchain-id="<known-registered-id>"></agent-3d>
```

Open this file in a fresh browser profile. The agent must render using only the committed HTML and on-chain data — no cookies, no login, no 3dagent.vercel.app session.

### Failure modes

- Unknown agent id → visible fallback ("Agent not found on chain").
- IPFS gateway slow / offline → try a second gateway, then fail visibly.
- RPC down → friendly error + retry button.

## Out of scope

- Do not implement reputation / validation reads in this prompt — follow-up.
- Do not add an on-chain discovery UI (listing agents by chain) — the user's flow is always "I have an id, render it".
- Do not build a custom IPFS gateway.

## Acceptance

- [ ] Open the committed `examples/onchain/<sample>.html` in a private window; agent renders.
- [ ] Agent renders the same across Claude Artifact, Lobehub, and the raw HTML test — same attributes, same result.
- [ ] Turning off the 3dagent.vercel.app backend (simulate by blocking the domain in devtools) does **not** break the render, because all data comes from chain + IPFS + the raw `avatarUrl`.
- [ ] Unknown onchain id → friendly error, not a broken canvas.
- [ ] `npm run build:lib` bundles the new resolver without growing the lib over 500 KB gzipped.
