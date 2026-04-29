# 20 — Port launchpad token-creation UI into studio

**Branch:** `feat/launchpad-ui-studio`
**Source repo:** https://github.com/nirholas/solana-launchpad-ui
**One PR. Standalone. No other prompt is required to be shipped first.**

## Why it matters

solana-launchpad-ui is a pump.fun-styled launchpad UI template (dark theme, bonding curves, trade panel, no deps). The 3D-agent character studio is the natural place to add "launch a token for this agent" — currently we have widget code in [src/pump/](../../src/pump/) but no full token-creation flow in the studio.

## Read these first

| File | Why |
| :--- | :--- |
| [character-studio/](../../character-studio/) | Studio root; identify where a new "Launch token" tab should live. |
| [src/pump/agent-token-widget.js](../../src/pump/agent-token-widget.js) | Existing token UI primitives. |
| [src/pump/pump-modals.js](../../src/pump/pump-modals.js) | Modal patterns. |
| [public/studio/studio.js](../../public/studio/studio.js) | Studio JS entry. |
| https://github.com/nirholas/solana-launchpad-ui | Visual reference (HTML/CSS). |

## Build this

1. Add a new "Launch" panel to the character studio. The panel:
    - Form: token name, symbol, image (file upload), description, initial buy SOL amount, fee tier.
    - Bonding-curve visual (port the SVG/canvas chart from solana-launchpad-ui).
    - Submit button: calls the existing pump.fun create flow (find in [src/pump/](../../src/pump/) — do not invent a new path; if no existing flow, add a TODO and stop the form at console.log).
2. Style: match the existing studio panels' weight; do not import the launchpad's CSS wholesale — copy only the bonding-curve component styles.
3. Add `tests/studio-launch-panel.test.js` (jsdom) asserting the form validates required fields and that submit calls the wired handler.
4. Wire it into [public/studio/studio.js](../../public/studio/studio.js) as a new tab; default tab unchanged.

## Out of scope

- New on-chain logic (use existing pump SDK calls).
- Multi-step wizards — single form is enough.
- Real-time bonding-curve updates after launch (later).

## Acceptance

- [ ] `node --check` passes for new files.
- [ ] `npx vitest run tests/studio-launch-panel.test.js` passes.
- [ ] Studio shows a "Launch" tab; form validates required fields.
- [ ] Submitting the form (with stubbed handler) does not console.error.
- [ ] `npx vite build` passes.

## Test plan

1. `npm run dev`. Open the studio for any agent. Click "Launch". Fill the form. Confirm validation works.
2. Confirm bonding-curve chart renders.
3. Submit; confirm the existing pump.fun flow handler is invoked (console.log or breakpoint).

## Reporting

- Shipped: …
- Skipped: …
- Broke / regressions: …
- Unrelated bugs noticed: …
