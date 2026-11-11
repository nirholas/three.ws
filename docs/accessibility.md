# Accessibility

three.ws targets WCAG 2.2 Level AA across the core journeys and holds its wallet and payment surfaces to the Web3 Accessibility Guidelines (W3AG) at levels A and AA as well. This page records what we meet, how each claim is tested, and what is next.

- Public statement: [/accessibility](../pages/accessibility.html) (served at https://three.ws/accessibility).
- Accessibility Conformance Report, VPAT 2.x WCAG edition: [accessibility/acr.md](accessibility/acr.md).
- Manual walkthroughs (keyboard, Orca, zoom, text spacing, forced colours): [accessibility/walkthroughs.md](accessibility/walkthroughs.md).

## What we meet

| W3AG area | What ships | Where |
| --- | --- | --- |
| Address presentation (1.1.1, 1.1.3) | One formatter. The shortened form (`FeMb…pump`) is drawn, the full value is announced in groups of four (`FeMb DoX7 R1Ps ...`), and the whole address is the hover title. `0x` stays its own spoken group. Marked `translate="no"`. | [src/shared/address.js](../src/shared/address.js) |
| Modal focus (2.1.2) | The connect picker, the skill payment modal, the vault dialogs and the add-funds sheet share one trap: the page behind becomes `inert` (through shadow-root hosts too), Tab and Shift+Tab cycle inside, Escape closes, focus returns to the opener. | [src/shared/focus-trap.js](../src/shared/focus-trap.js) |
| Status without color (1.4.1) | Payment steps carry text for their state ("Connect, completed", "Confirm, failed") and `aria-current="step"` on the live step, in addition to the check and `!` glyphs and tints. | [src/payment-modal.js](../src/payment-modal.js) |
| Plain-language summary (3.3.2) | The payment modal states the skill, the one-time nature of the charge and the total in USDC before any signature is requested. | [src/payment-modal.js](../src/payment-modal.js) |
| Adjustable timing (2.2.1) | No wallet or payment surface imposes a signing time limit. The only intervals are balance and status polling, which never dismiss a dialog. | `tests/e2e/w3ag-wallet.spec.js` |
| Page language (3.1.1) | Every wallet page declares `<html lang>`. | `tests/e2e/w3ag-wallet.spec.js` |

Every address-shortening helper in `src/` now calls `shortAddress`. Changing how addresses read is a one-file change.

## How it is tested

- `npm run audit:a11y` ([scripts/audit-a11y.mjs](../scripts/audit-a11y.mjs)) runs axe-core with the WCAG 2.0, 2.1 and 2.2 A and AA tags over the 18 page types in the ACR plus `/accessibility` itself, in dark and light themes at 1366px and 400px. It writes [accessibility/reports/axe-latest.json](accessibility/reports/axe-latest.json) and [axe-latest.md](accessibility/reports/axe-latest.md) and exits non-zero on any serious or critical violation. Needs the dev server on port 3112 (`A11Y_BASE` to point elsewhere).
- `npm run audit:a11y:floor` runs the Playwright floor spec `tests/e2e/a11y-top-pages.spec.js`, which pins `/wallet`, `/agent-wallet`, `/claim-wallet` and `/vaults` in their disconnected state.
- `node scripts/a11y-manual-probe.mjs` scripts the keyboard, reflow, text-spacing and forced-colours checks and writes [accessibility/reports/manual-probe.json](accessibility/reports/manual-probe.json).
- `tests/e2e/enterprise-a11y.spec.js` pins each fixed barrier (focus under sticky bars, skip-link targets, landmarks, invisible focusable controls, the idle thought bubble) so it cannot return.
- `npx playwright test tests/e2e/w3ag-wallet.spec.js` checks, in a real browser: address presentation, the connect picker and payment modal trap (inert background, Tab cycling both ways, Escape, focus return), step state as text, the live status region, axe on the open payment modal, the absence of any signing timeout, page language, no `meta refresh`, no bare ellipsis addresses on the four wallet pages, and axe on those pages with a wallet extension present. The extension is the only stub (`installSolanaWallet`, `installEvmWallet` in `tests/e2e/_support.js`); the product code and its fetches are real.
- `npx vitest run tests/shared-address.test.js` pins the formatter at unit level.

## Judged by a person, not by a tool

Axe cannot tell whether a transaction summary is plain, whether a screen reader pauses sensibly inside a chunked address, or whether an error message tells someone what to do next. Review these by hand with a screen reader (Orca, VoiceOver, NVDA) when a wallet flow changes. The 2026-11-11 pass used Orca 46.1 with Chromium 145; see [accessibility/walkthroughs.md](accessibility/walkthroughs.md).

## What is next

- Move the remaining non-wallet dialogs onto `trapFocus`.
- Route the last two non-address truncators (`dashboard-next/components/drawer.js`, `reputation-ui.js`) through the shared formatter if they ever display addresses.
- Extend the spec to the connected state of `/agent-wallet` and `/vaults` once a deterministic session fixture exists for them.
