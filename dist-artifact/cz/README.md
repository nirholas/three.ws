# CZ Demo — Landing & Claim Flow

The CZ landing page is served at `/cz/` and provides:

- Full-bleed dark landing page with centered three.ws avatar
- **Claim CZ** button — initiates wallet connection and claim flow
- **Copy embed** button — copies `<agent-3d>` snippet to clipboard
- Footer — displays on-chain state (chain, agentId, metadataURI)
- Custom event analytics via `window.dispatchEvent('cz-demo-event', ...)`

## Files

- `index.html` — Main landing page
- `boot.js` — Client-side initialization and claim flow UI
- `state.json` — On-chain state stub (updated by `prompts/cz-demo/01-pre-register.js`)

## State Schema

`state.json` is a JSON file with this shape:

```json
{
	"status": "pre-onchain" | "onchain",
	"chainId": null | number,
	"agentId": null | number,
	"metadataURI": null | string,
	"ownerAddress": null | "0x0..." | string,
	"avatarUrl": "/avatars/cz.glb" | string
}
```

**Fields:**

- `status` — `"pre-onchain"` (not yet registered) or `"onchain"` (registered)
- `chainId` — Chain ID (e.g., `8453` for Base, `84532` for Base Sepolia), or `null`
- `agentId` — Token ID from IdentityRegistry, or `null`
- `metadataURI` — IPFS/HTTPS URL of the full registration JSON, or `null`
- `ownerAddress` — Current owner address, `"0x0..."` (unclaimed), or `null`
- `avatarUrl` — GLB URL (default `/avatars/cz.glb`)

The landing page footer displays the state. In `pre-onchain`, it shows "Not yet onchain".

## Claim Flow

The `startClaim()` function in `src/cz-flow.js` handles:

1. **Pre-onchain** — Shows modal: "Claim opens when CZ is registered"
2. **Unclaimed** (`ownerAddress === "0x0..."`): Calls `IdentityRegistry.claim(agentId)`
3. **Demo EOA transfer**: Guides user through `transferOwner()`
4. **Already owned**: Shows modal with current owner

All steps emit progress via `onProgress({ step, status, txHash?, error? })` and fire custom events:

- `landing_view` — Page loaded
- `claim_start` — Claim button clicked
- `claim_wallet_connected` — Wallet connected (implicit in flow)
- `claim_tx_sent` — Transaction sent
- `claim_complete` — Claim successful
- `claim_error` — Error occurred
- `embed_copied` — Embed snippet copied

Listen for these on `window`:

```js
window.addEventListener('cz-demo-event', (e) => {
	console.log(e.detail.event, e.detail.props);
});
```

## Routing

The page is served at `/cz/` by the Vite dev server and Vercel (`public/cz/` → `/cz/`).

To add `/cz` (without trailing slash) or a custom route, edit:

- **Local dev**: `vite.config.js` — `vercel-rewrites` plugin
- **Production**: `vercel.json` — `rewrites` array

Example for `vercel.json`:

```json
{
	"rewrites": [
		{ "source": "/cz", "destination": "/cz/" }
	]
}
```

Then run `npm run deploy` to push changes.

## Integration with `prompts/cz-demo/01-pre-register.js`

When the onchain pre-registration is ready, that script will:

1. Deploy / verify the ERC-8004 IdentityRegistry if needed
2. Call `register()` with the GLB and metadata
3. Write an updated `public/cz/state.json` with real `chainId`, `agentId`, `metadataURI`, `ownerAddress`

The landing page will automatically reflect this state on next load.

## Accessibility

- Semantic `<h1>` for the headline
- `aria-label` on all buttons
- Focus rings visible (2px outline with 2px offset)
- Reduced motion support (`prefers-reduced-motion`)
- Modal keyboard-escapable

## Testing

```bash
npm run dev
# Open http://localhost:3000/cz/

# Should show:
# - Avatar loading from /avatars/cz.glb
# - "Claim CZ" button clickable
# - "Copy embed" button copies snippet to clipboard
# - Footer shows "Not yet onchain"
```

Test the claim flow:

```js
// Open browser console on /cz/
window.addEventListener('cz-demo-event', (e) => {
	console.log('CZ demo event:', e.detail);
});

// Click "Claim CZ" → follow wallet prompts
```
