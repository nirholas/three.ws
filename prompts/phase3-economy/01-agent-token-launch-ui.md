---
mode: agent
description: 'Phase 3 — Complete the pump.fun agent token launch UI: prep → wallet sign → confirm, with bonding curve chart'
---

# Phase 3 · Agent Token Launch UI (pump.fun bonding curve)

**Branch:** `feat/agent-token-launch-ui`
**Standalone.** No other prompt must ship first.

## Why it matters

The backend for launching an agent token on pump.fun already exists (`api/agents/tokens/[action].js` — `launch-prep`, `launch-confirm`, `launch-quote`). What's missing is the user-facing flow: a modal that walks the owner through setting a name/symbol, previews the bonding curve quote, lets them sign the transaction in their wallet, and broadcasts it.

## Read these first

| File | Why |
|:---|:---|
| `api/agents/tokens/[action].js` | Backend: `launch-prep` (builds unsigned tx), `launch-confirm` (confirms after broadcast), `launch-quote` (returns SOL amounts). Read carefully — the API shape drives the UI. |
| `src/pump/agent-token-widget.js` | Existing token widget — don't duplicate. |
| `src/erc8004/agent-registry.js` | Wallet connect pattern to reuse. |
| `public/agent-home.html` | Entry point for agent detail page where the Launch button lives. |
| `src/agent-home.js` | JS for the agent detail page. |

## What to build

### 1. Launch Token button on agent detail page

In `src/agent-home.js`, add a "Launch Token" button visible only to the agent owner. It should appear in the agent action bar (wherever the Edit/Share buttons are). Only show if the agent has no `solana_mint` yet (check from the agent detail API response).

### 2. Launch Token modal — `src/pump/launch-token-modal.js`

A full-screen overlay modal (vanilla JS + CSS, no framework). Steps:

**Step 1 — Token details**
- Name (pre-filled with agent name, editable, max 32 chars)
- Symbol (auto-generated from name initials, editable, 2-10 alphanumeric chars)
- Description (optional, max 280 chars)
- Image URL (optional — pre-fill with agent's thumbnail URL)
- Initial buy in SOL (0–50, default 0; labelled "Dev buy (optional)")
- Network: mainnet / devnet toggle (default mainnet; show devnet only in development)

**Step 2 — Preview quote**
Call `GET /api/agents/tokens/launch-quote?agent_id={id}&symbol={symbol}&initial_buy_sol={sol}&cluster={cluster}` and show:
- Estimated token supply received for dev buy (if >0)
- Current SOL price in USD
- Platform fee in SOL

**Step 3 — Connect wallet & sign**
- If Solana wallet not connected, show a "Connect Wallet" button. Use `window.solana` (Phantom/Backpack injected provider) with `connect()`. No additional SDK — just the standard wallet provider interface.
- Call `POST /api/agents/tokens/launch-prep` with the form values + `wallet_address`. This returns `{ tx_base64, metadata_uri }`.
- Deserialize the base64 transaction, sign it: `const signed = await window.solana.signTransaction(Transaction.from(Buffer.from(tx_base64, 'base64')))`.
- Show a "Broadcasting…" state, then send via the Solana RPC (`sendRawTransaction`). Use the RPC URL from `VITE_SOLANA_RPC_URL` (env var, already in `.env.example`) falling back to `https://api.mainnet-beta.solana.com`.

**Step 4 — Confirm**
- POST `{ signature, agent_id, cluster }` to `/api/agents/tokens/launch-confirm`.
- Show: "Token launched! 🎉", the mint address, and a link to `https://pump.fun/coin/{mint}`.
- Update the agent detail UI to show the mint address and a link.

### 3. Bonding curve chart — `src/pump/bonding-curve-chart.js`

A simple SVG chart rendered inline in Step 2. Uses the pump.fun constant-product bonding curve formula:
```
price(supply) = supply / (1073000000 - supply) * 30 SOL
```
Plot supply (x-axis: 0 to 800M tokens) vs price in SOL per token (y-axis). Mark the current position at 0 (launch). No external chart library — use plain SVG with vanilla JS.

### 4. CSS

Add `src/pump/launch-token-modal.css`. Dark theme matching the existing agent-home style. Import it in `agent-home.html`.

### 5. Error handling

All API calls can fail — show inline error messages for:
- `rate_limited` (429) → "Too many launch attempts, try again tomorrow"
- `agent_not_found` (404) → dismiss modal
- `wallet_mismatch` (400) → "Wrong wallet — connect the wallet that owns this agent"
- Network errors → "Connection error, please try again"

## Out of scope

- Token management after launch (sell, transfer).
- EVM token launch.
- Editing the token after launch.
- Showing a full order book or live price feed.

## Acceptance

- [ ] "Launch Token" button appears on agent detail page for owner only, hidden after mint exists.
- [ ] Step 1 validates symbol (alphanumeric only, 2-10 chars); bad input shows inline error.
- [ ] Step 2 calls `launch-quote` and displays the result.
- [ ] Step 3 connects Phantom, calls `launch-prep`, signs tx.
- [ ] `launch-confirm` is called after broadcast; mint address is stored and displayed.
- [ ] Bonding curve SVG renders in Step 2 without errors.
- [ ] `npx vite build` passes (no new runtime deps — `@solana/web3.js` is already a dep).

## Reporting

- Shipped: …
- Skipped: …
- Broke / regressions: …
- Unrelated bugs noticed: …
