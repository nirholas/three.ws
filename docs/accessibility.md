# Accessibility

three.ws holds its wallet and payment surfaces to the Web3 Accessibility Guidelines (W3AG) at levels A and AA, on top of the WCAG 2.1 AA floor that every top page already clears. This page records what we meet, how each claim is tested, and what is next.

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

- `npm run audit:a11y` runs axe (`wcag2a`, `wcag2aa`, `wcag21aa`) over the top pages. `/wallet`, `/agent-wallet`, `/claim-wallet` and `/vaults` are pinned into that gate in their disconnected state.
- `npx playwright test tests/e2e/w3ag-wallet.spec.js` checks, in a real browser: address presentation, the connect picker and payment modal trap (inert background, Tab cycling both ways, Escape, focus return), step state as text, the live status region, axe on the open payment modal, the absence of any signing timeout, page language, no `meta refresh`, no bare ellipsis addresses on the four wallet pages, and axe on those pages with a wallet extension present. The extension is the only stub (`installSolanaWallet`, `installEvmWallet` in `tests/e2e/_support.js`); the product code and its fetches are real.
- `npx vitest run tests/shared-address.test.js` pins the formatter at unit level.

## Judged by a person, not by a tool

Axe cannot tell whether a transaction summary is plain, whether a screen reader pauses sensibly inside a chunked address, or whether an error message tells someone what to do next. Review these by hand with a screen reader (VoiceOver, NVDA) when a wallet flow changes.

## What is next

- Move the remaining non-wallet dialogs onto `trapFocus`.
- Route the last two non-address truncators (`dashboard-next/components/drawer.js`, `reputation-ui.js`) through the shared formatter if they ever display addresses.
- Extend the spec to the connected state of `/agent-wallet` and `/vaults` once a deterministic session fixture exists for them.
