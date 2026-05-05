# 10 — Configuration page: real connection validation on Save

## Problem
[pump-dashboard.html](../../pump-dashboard.html) `saveConfig()` (lines ~1917–1935) writes the four config fields (API URL, WS URL, API Key, RPC URL) to `localStorage` and toasts "Configuration saved & reconnecting". It then calls `connectApi()` and `connectWebSocket()`, but the user gets **no per-field validation feedback** — invalid RPC URLs, wrong API keys, etc. fail silently in the global status indicators and the user is left guessing. There is also no test of the **Solana RPC** endpoint at all.

## Outcome
Each field gains an inline status pill ("OK", "Failed: <reason>") that updates after Save runs real probes:
- **API URL**: `GET <apiUrl>/api/healthz` → expects `{ ok: true }`.
- **API Key**: `GET <apiUrl>/api/v1/status` with `X-API-Key` header → 200 = OK, 401/403 = Failed with status text.
- **WS URL**: open the socket, wait up to 3s for `onopen`, then close. Anything else = Failed.
- **RPC URL**: JSON-RPC `getHealth` (and `getVersion` for display) — `{ "jsonrpc":"2.0","id":1,"method":"getHealth" }` → result `"ok"` = OK, otherwise Failed with the RPC error.

All probes run in parallel, then results render against each field. Saving still always persists to `localStorage` so the user can come back; but any failed probe must show the real failure inline, not be hidden.

## Implementation
1. Refactor `saveConfig()` to:
   - Persist to `localStorage` immediately (existing behaviour).
   - Update `state.*` and `api-endpoint-display` (existing behaviour).
   - `Promise.all([probeApi(), probeApiKey(), probeWs(), probeRpc()])` — each helper returns `{ ok: boolean, detail: string }`.
   - Write each result into a new `<div class="status-pill">` element placed adjacent to its input field. Use the existing color classes (`green`, `red`, `yellow`).
2. Add real probe helpers above `saveConfig()`. They MUST hit the real endpoints — no canned success.
3. The WS probe must close the socket after success/timeout to avoid leaking a connection (the page-level `connectWebSocket()` flow continues to own the long-lived socket).
4. Also run all four probes once on `DOMContentLoaded` so the page reflects current connectivity at load.
5. The "Save & Reconnect" button shows a real spinner while probes are in flight; re-enables on completion. No `setTimeout` fake delay.

## Definition of done
- Enter a known-bad RPC URL → save → RPC pill turns red and shows the real RPC error string.
- Enter a known-good Helius RPC URL → pill turns green within ~1s.
- Revoke the API key (via task 09's UI or directly in DB) → pill turns red with "401 unauthorized".
- All four pills reflect real, live state — verifiable by toggling each endpoint independently.
- `npm test` green; **completionist** subagent run on changed files.
