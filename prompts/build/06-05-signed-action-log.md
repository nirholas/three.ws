---
mode: agent
description: "Sign every agent action with the linked wallet so the action log is verifiable"
---

# 06-05 · Wallet-signed action log

## Why it matters

The onchain identity is worth nothing if the agent's *actions* are unsigned — a host can't distinguish real moves from forged ones. Signing each action with the owner wallet (off-chain, stored in `agent_actions.signature`) makes the action log cryptographically attributable.

## Prerequisites

- Pillar 1 (wallet linked).
- 06-01 (ERC-8004 id minted — gives you a canonical signer address).

## Read these first

- [src/agent-skills.js](../../src/agent-skills.js) — `sign-action` skill.
- [src/agent-identity.js](../../src/agent-identity.js) — wallet plumbing.
- [api/agent-actions.js](../../api/agent-actions.js) — current action persistence.

## Build this

1. **Action signing on the client** — before `POST /api/agent-actions`, run the action payload through `wallet.signMessage(canonicalize(action))`. Canonicalize via sorted keys + no whitespace. Store `{ signature, signer_address, message_digest }` alongside the action.
2. **Server verification** — on insert, verify the signature recovers the agent's `wallet_address`. Reject if mismatch.
3. **Unsigned fallback** — anonymous visitors (no linked wallet) continue to write actions *without* signatures; those rows get `signature IS NULL`. Signed vs unsigned is filterable.
4. **Expose signed-only timeline on public views** — on `/agent/:id`, an optional toggle "Verified actions only" shows rows where `signer_address = agent.wallet_address`. Default: show all.
5. **Prompt the user** to sign once per session — use a "delegation" message (SIWE-style) that authorizes the browser session to sign subsequent actions locally with a session-scoped key. Rather than wallet-popup-per-action, which kills UX.

## Out of scope

- Onchain action anchoring (Merkle commits).
- Revocation of the session-scoped signing key (keep it session-lifetime for v1).
- Cross-host verification SDKs.

## Deliverables

- Client code in `src/agent-skills.js` (sign-action) and/or a new signer helper.
- Verification branch in `api/agent-actions.js`.
- Toggle on `/agent/:id` for verified-only view.

## Acceptance

- With a linked wallet, emitting an action produces a row with a valid signature that recovers the wallet address.
- Tampering with the stored action body breaks verification.
- Anonymous actions still land, unsigned.
- `npm run build` passes.
