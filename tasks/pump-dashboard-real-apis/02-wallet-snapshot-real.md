# 02 — Wallet Snapshot panel: real wallet connect + real balances

## Problem
[pump-dashboard.html](../../pump-dashboard.html) lines ~499–511 render only a "Connect wallet to see your holdings" empty state with a button that does nothing. This is a non‑functional placeholder.

## Outcome
Clicking **Connect Wallet** opens the user's real Solana wallet (Phantom is already installed in the rest of this codebase — see [src/wallet.js](../../src/wallet.js)). On approval, the panel renders the connected address, native SOL balance, USD value, and the top SPL token holdings with logos and USD values. Disconnect button restores the empty state.

## Use what already exists — don't reinvent
- Wallet connect: reuse [src/wallet.js](../../src/wallet.js) (`connectPhantom`, listeners) — `import` it as an ES module from the dashboard. Do **not** call `window.solana` directly here.
- Balances: call `POST /api/wallet/balances` with `{ chain: 'solana', address }` — implementation already exists at [api/wallet/balances.js](../../api/wallet/balances.js) and uses Helius RPC + Jupiter price API server‑side. **Do not re‑hit Helius from the browser**; that endpoint owns the API key.

## Implementation
1. Convert the inline `<script>` block in pump-dashboard.html to also import [src/wallet.js](../../src/wallet.js) (or move dashboard JS into a module under [src/pump/dashboard-wallet.js](../../src/pump/dashboard-wallet.js) and load via `<script type="module">`). Vite already handles modules.
2. Wire the Connect Wallet button:
   - On click → `connectPhantom()` from [src/wallet.js](../../src/wallet.js).
   - On connected event → fetch `/api/wallet/balances` with the connected address.
   - Render: short address (linked to `solscan.io/account/<addr>`), SOL native balance + USD, then a list of up to the top 10 token holdings sorted by USD value (symbol, amount formatted with token decimals, USD value, logo `<img>` from the API response).
   - Show a real "Disconnect" button that calls `provider.disconnect()` and restores the connect state.
3. Real states only:
   - Connecting → spinner / "Connecting…" while the wallet popup is open.
   - 503 `not_configured` from `/api/wallet/balances` → render the upstream error string returned by the endpoint (do not fabricate a fallback list).
   - Empty token list → "No SPL tokens" line; do not invent rows.
4. If the user has previously connected (Phantom auto‑connect), pre‑populate the panel on page load — the listener in [src/wallet.js](../../src/wallet.js) already exposes the connected address.

## Definition of done
- Real Phantom popup appears on click and approval is required.
- Network tab shows `POST /api/wallet/balances` succeeding with the real address.
- SOL value matches `solscan.io/account/<addr>` to within rounding.
- Disconnect actually disconnects the wallet (verify by clicking Connect again — popup re‑appears).
- No string `"Connect wallet to see your holdings"` left in the rendered DOM after a successful connect.
- `npm test` green; **completionist** subagent run on changed files.
