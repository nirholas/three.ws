---
mode: agent
description: "Let a signed-in user mint an ERC-8004 agent id from the agent page"
---

# 06-01 · Mint ERC-8004 id from UI

## Why it matters

Pillar 6 begins here. The agent record lives on-chain, portable across hosts. Today the ERC-8004 contracts exist under `contracts/`, and `src/erc8004/` has registration code — but the UI path from "agent page → minted id" isn't wired for every user.

## Prerequisites

- Pillar 1 (wallet linked to account).
- Pillar 2 (agent has an avatar, so there's something to register).
- ERC-8004 identity registry deployed; addresses in [src/erc8004/abi.js](../../src/erc8004/abi.js).

## Read these first

- [contracts/src/IdentityRegistry.sol](../../contracts/src/IdentityRegistry.sol)
- [src/erc8004/abi.js](../../src/erc8004/abi.js)
- [src/erc8004/agent-registry.js](../../src/erc8004/agent-registry.js)
- [src/erc8004/register-ui.js](../../src/erc8004/register-ui.js) — existing UI helper.
- [api/agents.js](../../api/agents.js) — `POST /api/agents/:id/wallet` accepts `erc8004_agent_id`.

## Build this

1. **New page** `/agent/:id/register` (owner-only) with a step wizard:
   - Step 1 — connect wallet (reuse `wallet-login.js` logic; if already linked via 01-03, skip).
   - Step 2 — preview the agent-card.json payload that will be committed.
   - Step 3 — confirm chain + network fee, sign & send the `registerAgent` tx via the user's wallet (ethers `BrowserProvider`).
   - Step 4 — on success: extract the `AgentRegistered` event's `agentId`, `PUT /api/agents/:id/wallet` with `{ erc8004_agent_id, chain_id, wallet_address }`.
2. **Error states** — wrong network, insufficient funds, user rejected, contract revert — each gets a clear message and a retry button. No cryptic hex strings shown.
3. **Display on `/agent/:id`** — if `erc8004_agent_id` is set, show "On-chain: #<id> on <chain>" with a block-explorer link. Read-only badge.
4. **Anti-double-register guard** — if agent already has `erc8004_agent_id`, the register page shows a "Already registered" state with the id and link; no double-mint.

## Out of scope

- Pinning the card to IPFS (06-02).
- Signing actions with the wallet (06-04).
- Deploying contracts (separate op; see `docs/deploy-erc8004-contracts.md`).

## Deliverables

- `public/agent/register.html` + JS.
- Any owner-only guard code.
- Link from `/agent/:id` owner bar → register page.

## Acceptance

- Owner with a wallet can successfully mint and see the id stored in `agent_identities.erc8004_agent_id`.
- Attempting to register twice is blocked client + server side.
- Block-explorer link resolves.
- `npm run build` passes.
