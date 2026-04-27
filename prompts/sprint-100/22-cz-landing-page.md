# 22 — CZ claim landing page

## Why

The ship target: `/cz` is a bespoke landing page where CZ (or anyone with the claim link) connects their wallet and claims a pre-registered on-chain agent.

## Parallel-safety

Entirely new folder + routes. No edits to existing app code.

## Files you own

- Create: `public/cz/index.html`
- Create: `public/cz/cz.css`
- Create: `public/cz/cz.js`
- Create: `api/cz/claim.js` — server-side claim handler.

## Read first

- [vite.config.js](../../vite.config.js) — confirm `public/cz/` will be served (it typically is by default).
- [vercel.json](../../vercel.json) — check rewrites so `/cz` serves the index.

## Deliverable

### Frontend

`/cz` route:

- Full-bleed dark theme with a three.ws embed front-and-center (uses `<agent-three.ws-id="cz-preview">` or similar hardcoded agent id).
- Copy: `Welcome, CZ. Claim your on-chain agent.`
- Button: `Connect wallet to claim` → uses the wallet flow from [src/wallet-auth.js](../../src/wallet-auth.js) if present, else falls back to `connectWallet()` from `erc8004/agent-registry.js`.
- After connection, show `[ ⬢ Sign claim transaction ]`.
- Wallet signs a claim tx that flips ownership of the pre-registered agent NFT/row to the connecting wallet.
- Success screen: `You now own <agent-name>. Here's your embed snippet.` — shows the three snippets from the share panel.

### Backend

`POST /api/cz/claim`:

- Body: `{ signerAddress, signature, nonce }` — signer proves possession of the target address.
- Server issues a nonce via `GET /api/cz/claim?address=...` (add this branch).
- Verify signature → record claim intent in a `cz_claims` table → respond with `{ ok: true, txPayload: { to, data, value } }` so the client can broadcast the actual on-chain transfer.
- Rate limit: `5/hour per IP` (this is a one-shot flow).

### Fallback / rehearsal

- Include a `?rehearsal=1` query param that stubs the contract call with a 2-second fake success — lets us rehearse on a laptop without a live chain.

## Constraints

- No new deps.
- Hardcoded agent id lives in ONE place (top of `cz.js`).
- Service-worker for offline demo is out of scope for this prompt — note as follow-up.

## Acceptance

- Visit `localhost:3000/cz` → page renders, avatar visible, connect button works with MetaMask.
- `?rehearsal=1` flows through to success without touching chain.

## Report

- Hardcoded agent id you used (coordinate with whoever pre-registered).
- What `/api/cz/claim` returns in rehearsal mode vs live.
