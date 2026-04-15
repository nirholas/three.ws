---
mode: agent
description: "Hydrate an embodied agent into any host directly from its on-chain record"
---

# Stack Layer 6: Hydrate Agent From Chain

## Problem

The novel unlock: a host app (LobeHub, Claude, any site) can render an embodied agent given only a chain id + agent id, with zero dependency on 3dagent.vercel.app for data. The JS library reads the chain record, fetches the manifest from IPFS, renders the agent.

## Implementation

### Library API ([dist-lib/agent-3d.js](dist-lib/agent-3d.js) / [src/element.js](src/element.js))

Web component usage:
```html
<script src="https://3dagent.vercel.app/dist-lib/agent-3d.js"></script>
<agent-3d chain="base-sepolia" agent-id="42"></agent-3d>
```

Programmatic:
```js
import { renderAgent } from '3d-agent';
renderAgent(document.getElementById('host'), { chain: 'base-sepolia', agentId: 42 });
```

### Resolution chain

Inside [src/agent-resolver.js](src/agent-resolver.js):
1. Accept `(chain, agentId)` OR `(manifestCid)` OR `(slug)` OR `(url)`.
2. If `(chain, agentId)`: read the on-chain registry (read-only RPC — default to a free public RPC for Base; let host override).
3. Get `manifestURI` (usually `ipfs://...`).
4. Fetch manifest from IPFS via multi-gateway fallback.
5. Verify `ownerSignature` against the `createdBy` address in the manifest.
6. Fetch GLB from IPFS.
7. Boot the viewer + agent runtime with the hydrated spec.

### Zero-infra path

Note the critical property: once registered, an agent can be rendered in a host even if **3dagent.vercel.app is offline**. Everything needed lives on-chain + IPFS + the library JS (bundlable into host).

### Caching

- `localStorage` cache of `chain:agentId → manifestCid` with short TTL + ETag-style revalidation on next load.
- `Cache-Control: public, max-age=31536000, immutable` for GLB fetches from IPFS gateways.

### Skill execution without origin

Skills that require a backend (e.g., `remember`) can POST to `createdBy`'s trusted endpoint (from manifest) OR degrade gracefully. For v1, presentational skills work fully (animation, emotion); network skills show "disabled in unhosted mode".

### Chain support

Start with Base Sepolia (dev) and Base (mainnet). Extensible: map chain name → RPC URL → deployed contract address in a small registry at [src/erc8004/chains.js](src/erc8004/chains.js).

## Validation

- `<agent-3d chain="base-sepolia" agent-id="42">` on a blank HTML page → avatar renders, animates, responds to local skills.
- Disable network to 3dagent.vercel.app (block in devtools) → agent still renders from IPFS.
- Tampered manifest (wrong signature) → refuses to render, shows "Unverified".
- `npm run build:lib` produces a working `dist-lib/agent-3d.js` that supports chain hydration.
- `npm run build` passes.

## Do not do this

- Do NOT require a 3dagent.vercel.app API key for public chain-hydrated render.
- Do NOT hardcode one IPFS gateway — use fallbacks.
