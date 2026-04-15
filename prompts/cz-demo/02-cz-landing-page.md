# Task 02 — `/cz` landing page

## Why this exists

The demo URL CZ visits. One bespoke page, dark theme, one job: render the pre-registered CZ agent (from task 01) with a single clear CTA — "Claim your agent." Post-claim, it becomes a portable embed page he can link from his own profile.

## Shared context

- Pre-registered onchain agent from [01-preregister-cz-onchain.md](./01-preregister-cz-onchain.md). `agentId`, `chainId`, `registration_cid` available.
- Chain hydrate route (if built): `/agent/chain/:chainId/:agentId` — from [../onchain/04-chain-hydrate-route.md](../onchain/04-chain-hydrate-route.md). If that route is not shipped yet, the landing page falls back to server-side resolution against the local DB row inserted by task 01.
- Existing agent page: [public/agent/index.html](../../public/agent/index.html). Use it as a visual reference but **do not reuse**. This is a bespoke page with its own styling.
- Share/embed infrastructure: existing `/agent/:id/embed` route via [public/agent/embed.html](../../public/agent/embed.html).

## What to build

### 1. Route + page

Route: `/cz` → `public/cz/index.html`. Add to [vercel.json](../../vercel.json):

```json
{ "src": "/cz", "dest": "/public/cz/index.html" },
{ "src": "/cz/", "dest": "/public/cz/index.html" },
```

### 2. Layout (dark, cinematic)

- Full-viewport black background.
- Centered 3D stage — 70vh tall, the CZ avatar center-stage, auto-rotating slowly (0.2 rad/sec).
- Below the stage:
  - `<h1>` "CZ" + tagline "An embodied agent. Signed onchain."
  - Address chip showing the current onchain `owner` (shortened: `0x1234…abcd`).
  - Metadata pills: `chain: base-sepolia · agent #123 · CID Qm…`.
  - One primary button: **Claim your agent →**.
- Below the fold: three short paragraphs explaining what's happening technically (onchain identity, portable embed, Empathy Layer).

### 3. Rendering

Use the same `Viewer` + agent stack as `/agent/:id`. Import from `dist-lib/agent-3d.js` — use the web component:

```html
<agent-3d
  agent-id-chain="base-sepolia:123"
  eager
  style="width:100%;height:70vh;background:transparent"
></agent-3d>
```

If the `agent-id-chain="..."` attribute is not yet supported in [src/element.js](../../src/element.js), fall back to `src="agent://base-sepolia/123"` — [src/manifest.js](../../src/manifest.js) already resolves `agent://chain/id`. Document whichever path you took.

### 4. Claim button behavior

Hooked to the flow defined in [03-claim-transfer-flow.md](./03-claim-transfer-flow.md). For this task, just wire an `onclick` that calls `window.claimAgent()` (a function that task 03 will define on the page). If that function is not yet present, show a toast "Claim flow not yet available" and log a warning. Do not block this task on task 03.

### 5. Post-claim state

When `localStorage['cz:claimed'] === 'true'`:
- Replace "Claim your agent →" with `Open in LobeHub →` + `Open in Claude →` buttons.
- Hide the address chip's old owner, show the new owner address.
- Show a small green dot + "claimed" label next to the agent id.

The `LobeHub` and `Claude` buttons point at routes from [04-lobehub-embed-drop-in.md](./04-lobehub-embed-drop-in.md) and [../claude-artifact/01-single-file-bundle.md](../claude-artifact/01-single-file-bundle.md) — wire as `href="#"` with a `TODO` comment if those aren't ready yet.

### 6. OG + oEmbed

Include `<meta property="og:image" content="/api/agent-og?id=cz-demo">` and oEmbed discovery links if task [embed/01-og-oembed.md](../embed/01-og-oembed.md) has landed. Otherwise use a static `/og/cz.png` — note in the report which path was taken.

## Files you own

- Create: `public/cz/index.html`, `public/cz/cz.css`, `public/cz/cz.js`
- Edit: [vercel.json](../../vercel.json) — two route lines in the `/public/*` fallback region

## Files off-limits

- `public/agent/*` — separate route, leave alone
- `src/element.js` — if `agent-id-chain` is missing, fall back to `src=agent://...`, do not modify the element
- Any `/api/*` handler

## Acceptance test

1. Open `/cz` locally. The pre-registered CZ agent loads; camera orbits slowly.
2. Owner chip shows the expected address from task 01.
3. Claim button is present. Clicking it before task 03 ships shows a toast or logs a warning — does not crash.
4. After setting `localStorage['cz:claimed'] = 'true'` by hand, refresh — UI flips to post-claim.
5. Lighthouse: LCP < 2.5s on a throttled connection with the GLB cached in CDN.

## Reporting

Report: screenshot-description of the page, whether `agent-id-chain` worked or fell back to `agent://`, OG image path used, any visual glitches noticed (avatar orientation, lighting, shadow).
