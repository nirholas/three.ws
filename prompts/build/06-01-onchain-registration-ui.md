# 06-01 — Onchain registration UI (ERC-8004 identity via Privy wallet)

**Branch:** `feat/onchain-registration-ui`
**Stack layer:** 6 (Onchain identity)
**Depends on:** 01-01 (Privy available), 02-03 (avatar↔agent link)
**Blocks:** 06-02 (onchain resolution)

## Why it matters

The ERC-8004 contracts are deployed ([src/erc8004/abi.js](../../src/erc8004/abi.js) has `REGISTRY_DEPLOYMENTS`), and [src/erc8004/register-ui.js](../../src/erc8004/register-ui.js) exists — but nothing in the dashboard invokes it. The whole onchain unlock rests on the user being able to click "Register on chain" and finish without leaving the product.

## Read these first

| File | Why |
|:---|:---|
| [src/erc8004/register-ui.js](../../src/erc8004/register-ui.js) | Existing component — understand its current API before wiring. |
| [src/erc8004/agent-registry.js](../../src/erc8004/agent-registry.js) | `registerAgent()`, `buildRegistrationJSON()`, `pinToIPFS()`. |
| [src/erc8004/abi.js](../../src/erc8004/abi.js) | ABIs + deployed addresses. |
| [src/erc8004/privy.js](../../src/erc8004/privy.js) | Existing Privy integration stubs. |
| [src/agent-identity.js](../../src/agent-identity.js) | Client model; `/api/agents/:id` PATCH accepts `wallet_address`, `chain_id`. |
| [public/dashboard/dashboard.js](../../public/dashboard/dashboard.js) | Mount the new tab here. |

## Build this

### Dashboard "Onchain" tab

New tab on an agent's detail view: **"Onchain Identity"**. Three states:

1. **Not registered.**
   - Summary of what registration does ("Your agent gets a portable, verifiable identity on-chain…").
   - Chain picker (default to Base Sepolia if available in `REGISTRY_DEPLOYMENTS`, switchable to mainnet).
   - "Connect wallet" — reuse the Privy flow from 01-01.
   - "Register" button → builds the registration JSON (name, bio, avatar URL, skills, web presence URL = `https://3dagent.vercel.app/agent/<slug>`), pins to IPFS via [agent-registry.js](../../src/erc8004/agent-registry.js)'s `pinToIPFS()`, then calls `registerAgent()`.
   - Progress states: pinning → signing → waiting confirmation → complete.

2. **Pending.**
   - Show tx hash + block explorer link. Poll for confirmation.

3. **Registered.**
   - Show ERC-8004 `agent_id`, chain, IPFS URI, block explorer link, registered wallet.
   - "Re-pin metadata" button for when agent profile changes.
   - "Unregister" / "Transfer" — not in this prompt; render as disabled "coming soon".

### Backend — `PATCH /api/agents/:id`

Accept and persist `{ erc8004: { chain_id, agent_id, registry, registration_uri } }`. Do not attempt to write onchain from the server.

### Error surfaces

- Wallet rejection → inline, non-blocking; let the user retry.
- Chain mismatch (user's wallet on wrong network) → prompt to switch via Privy.
- IPFS pin failure → show the error; allow retry without re-signing if possible.

## Out of scope

- Do not deploy new contracts.
- Do not implement reputation / validation writes — follow-up prompt (part of 06-03 or similar).
- Do not migrate existing agents that have `wallet_address` set but no `erc8004` record — one-off script is a separate task.

## Acceptance

- [ ] Unregistered agent shows the "Not registered" state.
- [ ] Clicking "Register" with a Privy-connected wallet signs one transaction and, on confirmation, flips the UI to "Registered".
- [ ] The `agent_identities` row persists `chain_id`, `agent_id`, `registration_uri`.
- [ ] Reloading the dashboard shows the "Registered" state without re-signing.
- [ ] Wallet rejection leaves the UI usable — no stuck spinner.
