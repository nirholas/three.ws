# 09 — CZ landing page + claim flow

## Why

cz-demo is the ship target. [prompts/cz-demo/](../cz-demo/) has the task list but nothing is shipped. Task 01 (pre-register onchain) requires a real broadcast tx — **out of scope for this prompt**. We can still ship everything around it so the moment the tx fires, the demo is live.

This prompt builds the landing page + claim flow that reads state from chain (or from a stub JSON when chain is not yet live).

## What to build

### 1. Landing page

Create `public/cz/index.html`:

- Full-bleed dark theme.
- Centered `<agent-3d>` loading `/avatars/cz.glb` (pre-baked, already in repo).
- Headline, subhead, single CTA: **"Claim CZ"** (opens claim flow) + secondary: **"Copy embed"**.
- Footer shows chain + agentId + metadata-URI (read from `public/cz/state.json` if present, fall back to "Not yet onchain" placeholder).
- Meets accessibility basics: semantic headings, `aria-label` on CTAs, focus ring visible.

### 2. State source

Create `public/cz/state.json` with a stub shape:

```json
{
	"status": "pre-onchain",
	"chainId": null,
	"agentId": null,
	"metadataURI": null,
	"ownerAddress": null,
	"avatarUrl": "/avatars/cz.glb"
}
```

When task 01 from `prompts/cz-demo/` is run, it writes over this file. For now, ship the stub so the landing page behaves deterministically in CI.

### 3. Claim flow module

Create `src/cz-flow.js` — standalone ES module:

```js
export async function startClaim({ state, onProgress }) {
	// 1. connectWallet() via src/erc8004/agent-registry.js
	// 2. If state.status === 'pre-onchain' → show "Claim opens when CZ is registered" modal.
	// 3. If state.ownerAddress === '0x0' → call claim() on IdentityRegistry.
	// 4. If state.ownerAddress is a known demo EOA → guide user through transferOwner flow.
	// 5. Emit progress via onProgress({ step, status, txHash? })
}

export function mountEmbedCopy(container, { state }) {
	/* CTA that copies an <agent-3d> snippet */
}
```

Imports allowed: [src/erc8004/agent-registry.js](../../src/erc8004/agent-registry.js), [src/erc8004/abi.js](../../src/erc8004/abi.js). Do **not** re-implement wallet connection.

### 4. Embed snippet

The embed-copy CTA writes this to clipboard:

```html
<agent-three.ws="cz" chain="84532" src="/avatars/cz.glb" eager></agent-3d>
<script src="https://three.ws/dist-lib/agent-3d.umd.cjs"></script>
```

When `state.chainId` / `state.agentId` are present, interpolate them in.

### 5. Analytics (no-op if unconfigured)

Fire `window.dispatchEvent(new CustomEvent('cz-demo-event', { detail: { event, props } }))` at key moments:

- `landing_view`
- `claim_start`
- `claim_wallet_connected`
- `claim_tx_sent`
- `claim_complete`
- `embed_copied`

Don't wire a real analytics provider — keep it as a custom event anyone can hook.

### 6. Routing

`public/cz/` is served at `/cz/` by default. If you want `/cz` without a trailing slash to also work, that requires `vite.config.js` / `vercel.json` edits — **skip that.** Document in the README that operators should add the route in a follow-up.

Also create `public/cz/README.md` with the above note + copy-paste lines for when the operator is ready.

## Files you own

- Create: `public/cz/index.html`
- Create: `public/cz/state.json`
- Create: `public/cz/boot.js`
- Create: `public/cz/README.md`
- Create: `src/cz-flow.js`

## Files off-limits

- `prompts/cz-demo/*` — those are task specs, read-only.
- `src/erc8004/*`, `src/agent-*.js`, `src/element.js` — read-only.
- `vite.config.js`, `vercel.json` — skip routing edits; document instead.

## Acceptance

- `http://localhost:3000/cz/` renders the landing page, avatar loads from `/avatars/cz.glb`.
- "Claim CZ" button works in `pre-onchain` state (shows explainer modal).
- "Copy embed" copies a valid snippet to clipboard.
- `node --check src/cz-flow.js` passes.
- `npm run build` clean.

## Reporting

Files shipped, state.json schema frozen, claim-flow behavior in each `status` branch, analytics events wired, accessibility checklist run.
