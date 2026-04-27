# Prompt 04 — ERC-8004 Passport Widget

**Branch:** `feat/widget-erc8004-passport`
**Depends on:** `feat/studio-foundation` (Prompt 00) merged.
**Parallel with:** 01, 02, 03, 05.

## Goal

Ship the ERC-8004 Passport widget: a public, embeddable 3D avatar _plus_ its verifiable on-chain identity. Visitors see the avatar, its registered wallet, the chain it's registered on, its reputation score, and a link to the registration JSON. This is the widget that makes "agent-as-infrastructure" visible — a provable digital identity in an iframe.

This widget is what turns an ERC-8004-registered agent into a badge you can put in a GitHub README, a personal site, or an X bio.

## Prerequisites

- Prompt 00 merged.
- ERC-8004 registry deployment addresses must be filled in for at least one chain. If `REGISTRY_DEPLOYMENTS` in [src/erc8004/abi.js](../../src/erc8004/abi.js) still has `TODO` stubs, coordinate with the project owner before shipping — otherwise the widget has nothing to query.

## Read these first

| File                                                                           | Why                                                                                            |
| :----------------------------------------------------------------------------- | :--------------------------------------------------------------------------------------------- |
| [src/erc8004/index.js](../../src/erc8004/index.js) — all exports               | Understand what's available: identity registry, reputation, validation recorder.               |
| [src/erc8004/abi.js](../../src/erc8004/abi.js)                                 | Contract ABIs + deployment addresses. Confirm which chains are live.                           |
| [src/erc8004/agent-registry.js](../../src/erc8004/agent-registry.js)           | `buildRegistrationJSON` and `registerAgent` — understand what's on-chain for a given token id. |
| [src/erc8004/reputation.js](../../src/erc8004/reputation.js)                   | `getReputation`, `getFeedbackRange` — you'll render these.                                     |
| [src/erc8004/validation-recorder.js](../../src/erc8004/validation-recorder.js) | `getLatestValidation` — optional "last validated" proof.                                       |
| [src/erc8004/register-ui.js](../../src/erc8004/register-ui.js)                 | Reference for how the project currently renders identity info.                                 |
| [features.html](../../features.html)                                           | Visual style for ERC-8004 presentation. Match this feel.                                       |
| Prompt 01                                                                      | Copy the turntable's base visual polish — this widget extends it.                              |

## Build this

### 1. Config schema

Extend `src/widget-types.js`:

```js
const PASSPORT_DEFAULTS = {
	chain: 'base', // 'base' | 'base-sepolia' | 'ethereum' | 'optimism' (whatever REGISTRY_DEPLOYMENTS supports)
	agentId: null, // on-chain token id (bigint as string)
	wallet: null, // cached address; widget also refetches from chain
	// What to show
	showReputation: true,
	showRecentFeedback: true, // last 5 feedback entries
	showValidation: false, // last validation recorder entry
	showRegistrationJSON: true, // "view passport JSON" link
	// Visual layout
	layout: 'portrait', // 'portrait' (avatar top, passport below) | 'landscape' (avatar left, passport right) | 'badge' (tiny inline card)
	badgeSize: 'medium', // 'small' (80px) | 'medium' (120px) | 'large' (200px) — badge layout only
	// Autorotate (inherits from turntable)
	autoRotate: true,
	rotationSpeed: 0.6,
	// Chain reader
	rpcURL: '', // optional owner-supplied RPC; fallback to a public one
	refreshIntervalSec: 60, // how often to re-poll reputation (0 = never after initial load)
};
```

### 2. Studio form controls

When `state.type === 'passport'`:

- **Chain** — dropdown of deployed chains. Show chain id and registry contract address below.
- **Agent token id** — number input. Add a "lookup by wallet" helper: paste a wallet, find any token(s) owned by it via `balanceOf` + `tokenOfOwnerByIndex` (ERC-721). Show a list and let the owner pick.
- **Display toggles:** checkboxes for reputation / feedback / validation / passport JSON.
- **Layout:** radio portrait / landscape / badge. For badge, also show size selector.
- **RPC URL** (advanced, collapsed): optional override.
- **Refresh cadence:** select 0 / 30s / 60s / 5m / on-demand.

Live preview reads from chain as the user changes values. Cache lookups in localStorage by `chain:agentId` for fast iteration.

### 3. Widget runtime

Create `src/widgets/passport.js`:

```js
export async function mountPassport(viewer, config, container, widgetId) {
	// 1. Hide everything except the canvas and passport panel.
	// 2. Read chain data in parallel:
	//    - ERC-721 ownerOf(tokenId) → wallet
	//    - ERC-721 tokenURI(tokenId) → registration JSON URL (probably IPFS — resolve via src/ipfs.js)
	//    - ReputationRegistry.getReputation(agentId)
	//    - ReputationRegistry.getFeedbackRange(agentId, 0, 5) if showRecentFeedback
	//    - ValidationRecorder.getLatestValidation(agentId) if showValidation
	// 3. Apply turntable-style auto-rotate.
	// 4. Render the passport panel alongside the canvas per config.layout.
	//    - portrait: stacked, canvas on top (~60% height), panel below (~40%).
	//    - landscape: side-by-side.
	//    - badge: small circular avatar + compact card next to it.
	// 5. Poll on config.refreshIntervalSec; skip if document.hidden.
	// 6. Return { destroy }.
}
```

### 4. The passport panel

Visible information:

```
┌──────────────────────────────────────┐
│ [avatar name]                    ✓   │  ← green checkmark if registered
│ Agent #[tokenId] · [chain]           │
│ [short wallet] (copy) (etherscan ↗) │
│                                      │
│ ⭐ Reputation: 4.82 (128 reviews)    │  ← if showReputation
│                                      │
│ Recent feedback:                     │  ← if showRecentFeedback
│  "Delivered on time" — 0xabc… · 5★   │
│  "Great work"       — 0xdef… · 5★   │
│                                      │
│ ✓ Last validation: 2025-12-01        │  ← if showValidation
│   Report hash: 0x3f…a1              │
│                                      │
│ [View passport JSON ↗]               │  ← if showRegistrationJSON
└──────────────────────────────────────┘
```

### 5. Security + correctness

- Do not accept arbitrary `tokenURI` HTML content. Only fetch JSON with a strict schema; render only known fields.
- Validate `agentId` is a valid uint256 string.
- Handle `ownerOf` revert (non-existent token) gracefully: show "Agent not found on this chain."
- If RPC call fails: cached data (if any) with a subtle "last verified [time]" label.
- Truncate wallet addresses to `0xabcd…1234` format; full on copy.
- Sanitize feedback text (strip HTML).

### 6. Badge layout specifics

The badge layout is meant for embedding inline in a website header or sidebar — it's small and tasteful.

```html
<iframe src="/#widget=<id>" width="200" height="80"></iframe>
```

Must render cleanly at small sizes. Use CSS `container-type: inline-size` and `@container` queries to adapt layout.

### 7. "Powered by three.ws" link

In badge layout only, show a subtle 10px "3dagent" link in the bottom corner. In portrait/landscape, make it optional via config (default on).

### 8. Read-only is acceptable for v1

The widget does NOT need to let visitors submit feedback or trigger on-chain writes. That's a later prompt. Visitor clicks to the Etherscan link if they want to verify independently.

### 9. Cache RPC responses

- LocalStorage cache keyed `erc8004:${chain}:${agentId}:${field}` with TTL based on `refreshIntervalSec`.
- Graceful fallback to stale cache on RPC error.

## Do not do this

- Do not add feedback submission UI (v2).
- Do not allow the widget to sign or send any transaction.
- Do not require a wallet connection for viewing — this widget is public/read-only.
- Do not trust the RPC URL blindly — validate it's HTTPS.
- Do not render raw `tokenURI` HTML or embed unknown JSON fields.
- Do not break the widget if a registry deployment is missing for a selected chain. Show a clear error.
- Do not fetch IPFS content through a hardcoded gateway; use `src/ipfs.js`'s existing gateway-fallback logic.

## Deliverables

**New:**

- `src/widgets/passport.js`
- Passport panel CSS.

**Modified:**

- `src/widget-types.js` — mark `passport` as `ready`, add schema.
- `src/app.js` — dispatcher.
- `public/studio/studio.js` — passport fieldset + wallet→tokenId lookup helper.

**Possibly modified:**

- `src/erc8004/reputation.js` / `agent-registry.js` — only if the existing API doesn't expose what you need efficiently. Favor additive, backward-compatible changes.

## Acceptance criteria

- [ ] Studio lets the user pick chain + agent id, shows a live-populated preview.
- [ ] "Lookup by wallet" finds tokens owned by the pasted address.
- [ ] Public widget URL renders reputation, feedback, validation, passport JSON link as configured.
- [ ] Badge layout works at 80×80, 120×120, 200×200.
- [ ] Etherscan link points to the correct explorer for the chain.
- [ ] On RPC failure, widget shows cached data + "last verified" timestamp.
- [ ] No wallet connection required to view.
- [ ] Stale data auto-refreshes per the polling cadence.
- [ ] No console errors.
- [ ] Bundle size (gzipped) < 20 KB.

## Test plan

1. Register or identify a test agent on Base Sepolia. Note the token id and wallet.
2. Create a Passport widget in Studio. Pick Base Sepolia + the token id.
3. Verify all fields populate correctly in Studio preview.
4. Save, open public URL. Verify chain reads.
5. Switch layouts (portrait / landscape / badge). Each must render correctly.
6. Embed the badge iframe in a scratch HTML file. Render at 160x80. Looks tasteful.
7. Block RPC calls in DevTools network panel → widget should show cached / stale indicator, not a crash.
8. Paste an invalid tokenId → widget shows "Agent not found."
9. Pass through Etherscan link → lands on the correct contract page.
10. `npm run build` succeeds.

## When you finish

- PR with a screenshot of the widget in badge mode and in landscape mode.
- Flip `passport` status to `ready`.
- Link the PR in the README's "ERC-8004 agents in the wild" section if one exists.
