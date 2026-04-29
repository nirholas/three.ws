# 06 — Surface claim alerts in agent-home pump panel

**Branch:** `feat/claim-alerts-agent-home`
**Source repo:** https://github.com/nirholas/pumpfun-claims-bot (signal source)
**One PR. Standalone. No other prompt is required to be shipped first.**

## Why it matters

The agent-home page already has a pump.fun module ([src/agent-home-pumpfun.js](../../src/agent-home-pumpfun.js)). Showing live claim events there gives visitors something timely to watch and reinforces the agent's "alive" feel. This prompt adds a small claims panel — it does not depend on prompt 05; it queries the upstream RPC directly.

## Read these first

| File | Why |
| :--- | :--- |
| [src/agent-home-pumpfun.js](../../src/agent-home-pumpfun.js) | Existing pump module — your new panel renders next to it. |
| [src/agent-home.js](../../src/agent-home.js) | Top-level home composer — registers modules. |
| [src/pump/agent-token-widget.js](../../src/pump/agent-token-widget.js) | Style + DOM patterns to mirror. |
| [src/pump/pump-modals.js](../../src/pump/pump-modals.js) | Modal/list rendering patterns. |

## Build this

1. Add `src/agent-home-claims.js` exporting a `mountClaimsPanel(rootEl, { creator, intervalMs = 30_000 })`:
    - Renders a minimal list of last 10 claim events for `creator`, polling every `intervalMs`.
    - Each row: timestamp, mint, SOL amount, link to Solscan tx.
    - Empty state: "No recent fee claims".
    - Cleanup function returned for unmount.
2. Wire it into [src/agent-home.js](../../src/agent-home.js) so that, when the agent has a `creatorWallet` set in its profile, the claims panel appears beneath the existing pump module.
3. If no `creatorWallet` is set, render nothing — do not show empty UI.
4. Add minimal CSS scoped to `.three-ws-claims-panel` (inline style block or extend an existing stylesheet). Match the existing pump-module visual weight.

## Out of scope

- Editing the agent profile to set `creatorWallet` (that lives in the studio).
- WebSocket subscriptions — polling is fine for v1.
- Claim history pagination beyond last 10.

## Acceptance

- [ ] `node --check src/agent-home-claims.js` passes.
- [ ] Panel mounts when `creatorWallet` is set on the agent profile object.
- [ ] Panel is absent when `creatorWallet` is undefined or empty.
- [ ] Cleanup function clears the polling interval.
- [ ] `npx vite build` passes.

## Test plan

1. `npm run dev`. Open `/agent/<id>` for an agent with `creatorWallet` set to a known active pump.fun creator. Confirm panel renders and updates.
2. Open the same page for an agent without `creatorWallet`. Confirm no panel appears.
3. Navigate away and back; confirm no duplicate panels and no console errors.

## Reporting

- Shipped: …
- Skipped: …
- Broke / regressions: …
- Unrelated bugs noticed: …
