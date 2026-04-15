---
mode: agent
description: "Given an on-chain agent id, resolve to a full rendered agent in any host"
---

# 06-03 · Resolve agent from chain

## Why it matters

The payoff of pillar 6. Any host — Lobehub, Claude, a random site — can take an `(chain_id, erc8004_agent_id)` tuple and get back a fully rendered embodied agent. This is the universal-frontend moment.

## Prerequisites

- 06-01 (mint) and 06-02 (pin) shipped so there's something to resolve.

## Read these first

- [src/erc8004/abi.js](../../src/erc8004/abi.js)
- [src/erc8004/index.js](../../src/erc8004/index.js)
- [src/agent-resolver.js](../../src/agent-resolver.js)
- [api/agents/[id].js](../../api/agents/[id].js)

## Build this

1. **Server-side resolver** `GET /api/agents/by-chain?chain_id=X&erc8004_id=Y`:
   - Look up the on-chain record via a read-only RPC (reuse any provider config).
   - Extract the pinned CID.
   - Fetch the card JSON from IPFS (multi-gateway fallback via `src/ipfs.js`).
   - Resolve the avatar URL from the card.
   - Return `{ id?, name, description, avatar: { url }, card_cid, card_url, embed_url }`. If the agent is *also* in our Neon DB (one of ours), include the local `id`.
   - Cache the response (CDN, 60s) — on-chain reads are slow.
2. **Client helper** — extend `src/agent-resolver.js` so `<agent-3d chain-id="1" erc8004-id="42">` works, using `/api/agents/by-chain`.
3. **Embed resolver** — `/agent/chain/:chainId/:erc8004Id` route that renders the embed for a chain-resolved agent (not an internal id). Lets hosts paste chain-native URLs.
4. **Card trust** — verify the card's declared `wallet` matches the on-chain owner before rendering; reject otherwise. Protects against a CID that points to a spoofed card.

## Out of scope

- Writing a cross-chain aggregator (one chain at a time via `chain_id`).
- Caching CIDs in our DB (optional optimization; skip).
- Minting from chain (this is read-only).

## Deliverables

- `api/agents/by-chain.js`.
- Route in `vercel.json` for `/agent/chain/:chainId/:erc8004Id`.
- Extension to `src/agent-resolver.js` / `src/element.js`.

## Acceptance

- A fresh browser with no session and no knowledge of our DB can resolve `/agent/chain/1/42` and see the agent render.
- Spoofed card (wallet mismatch) returns a 400 / error card.
- `npm run build` passes.
