---
mode: agent
description: "Pin agent-card.json to IPFS and record the CID before/with on-chain registration"
---

# 06-02 · Pin agent-card to IPFS

## Why it matters

The onchain registry stores a **CID** pointing at the agent's card, not the card itself. Hosts pull `ipfs://<cid>` to resolve the agent. If pinning is unreliable, onchain portability (pillar 6) silently breaks — chain says "agent exists" but hosts can't load the body.

## Prerequisites

- 04-04 (card exists).
- An IPFS pinning provider available (e.g. web3.storage, Pinata, nft.storage). Env var `IPFS_PIN_TOKEN`.

## Read these first

- [src/ipfs.js](../../src/ipfs.js) — existing IPFS/Arweave URI resolver (client-side fetch with gateway fallback).
- [api/agents.js](../../api/agents.js) — `registration_cid` column exists on `agent_identities` (see `decorate()`).

## Build this

1. **New endpoint** `POST /api/agents/:id/pin` (owner-only):
   - Build the canonical card JSON via the same code path as `/api/agents/:id/card.json`.
   - Pin it via the provider SDK (server-side — keep the token off the client).
   - `UPDATE agent_identities SET registration_cid = $1 WHERE id = $2`.
   - Return `{ cid, gateway_url }`.
2. **Wire it into the register page** (06-01):
   - Before signing the on-chain tx, call `/pin` and include the returned CID in the registration payload.
   - The registry function signature expects a `bytes32` CID or `string` URI — check `IdentityRegistry.sol` and match exactly. If it's `bytes32`, store the raw digest; document the encoding in the endpoint response.
3. **Re-pin on change** — if the owner edits metadata (03-03) or swaps avatar (03-01), show a "Re-pin" button that calls `/pin` again. New CID overrides old. Only the owner can trigger this; only after registration.
4. **Resolver integration** — `src/agent-resolver.js` should try fetching `registration_cid` from the card first (authoritative), fall back to `/api/agents/:id/card.json`.

## Out of scope

- Paying for pinning on the user's behalf long-term (usage quota).
- Arweave mirror (future).
- Deleting / unpinning on agent deletion (the data is public; graveyard is acceptable).

## Deliverables

- `api/agents/[id]/pin.js`.
- Wiring in `public/agent/register.html` (created in 06-01).
- Resolver fallback update in `src/agent-resolver.js`.

## Acceptance

- Register flow pins the card, stores CID, writes it on-chain.
- `https://ipfs.io/ipfs/<cid>` (or configured gateway) resolves to the card JSON.
- Re-pin after an edit produces a new CID and records it.
- `npm run build` passes.
