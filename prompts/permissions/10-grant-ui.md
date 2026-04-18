# Task 10 — Grant Permissions modal (`src/permissions/grant-modal.js`)

## Why

This is the user-facing surface where permissions are born. The modal shows the scope in **plain English first**, then opens MetaMask, then posts the signed delegation to `/api/permissions/grant`. The quality of this UI is load-bearing for trust — a confusing scope screen = user declines = the whole band fails.

## Read first

- [00-README.md](./00-README.md) — canonical scope shape, API contract
- [src/permissions/toolkit.js](../../src/permissions/toolkit.js) — `encodeScopedDelegation`, `signDelegation`, `delegationToManifestEntry` (task 04)
- [src/erc8004/register-ui.js](../../src/erc8004/register-ui.js) — existing modal pattern; match the visual style and modal framing
- [src/components/](../../src/components/) — any shared modal / button primitives to reuse
- [src/CLAUDE.md](../../src/CLAUDE.md) — viewer/agent layering rules (permissions UI lives in the agent half)

## Build this

1. **Module**: `src/permissions/grant-modal.js` (vhtml JSX `.jsx` if the sibling UI files use it — match the local convention; check existing `src/permissions/*` files if any, else check `src/erc8004/register-ui.js`).
2. **Public API**: a default export class `GrantPermissionsModal` with:
    - `constructor({ agentId, chainId, delegatorAddress, delegateAddress, presets? })`
    - `async open()` returning `Promise<{ ok: true, id, delegationHash } | { ok: false, reason }>`
    - `close()` for imperative close
3. **Modal flow (three steps, single modal, progress breadcrumb at top):**

    **Step 1 — Scope builder.** Form with:

    - **Token** — radio of common tokens for the chain (native, USDC, WETH) + a custom address input
    - **Max amount** — numeric + unit dropdown (token decimals resolved via an on-chain `decimals()` call or a hardcoded table for the well-known set)
    - **Period** — `once | daily | weekly`
    - **Expiry** — preset pills (`24h | 7d | 30d | custom`) + custom datetime
    - **Allowed targets** — multi-entry address list with a helper "Add from known contracts" dropdown (populate with well-known DEX / tip-jar addresses; else "Custom" only)
    - Presets from the constructor pre-fill the form (e.g. Tip Jar skill passes a preset).

    **Step 2 — Plain-English review.**

    - A single sentence per caveat, generated from the form values, e.g. "This agent can spend up to **10 USDC per day** on **Uniswap V3 Router (0x68b...)** until **Apr 18, 2026**."
    - Red warning if any target isn't allow-listed.
    - "Back" and "Continue to MetaMask" buttons.

    **Step 3 — Sign + submit.**

    - Call `encodeScopedDelegation(...)` with form values + `delegatorAddress` + `delegateAddress` + `chainId`.
    - Call `signDelegation(delegation, signer)`. Use the project's existing wallet-provider helper (grep `BrowserProvider` or `connectWallet` in `src/erc8004/`) to get the signer. **Do not create a second wallet-connection path.**
    - On signature success, `POST /api/permissions/grant` with `{ agentId, chainId, delegation, scope }`.
    - Show status transitions: "Waiting for signature…", "Submitting…", "Granted ✓" / "Failed: <server error code>".
    - On 200, resolve `{ ok: true, id, delegationHash }` and auto-close after 1.5s.
    - On failure, surface the server `error` string verbatim; offer retry (without re-signing — same signature can be resubmitted until it 409s).

4. **Styling**: use existing CSS variables / classes from the project (grep for `.modal` usage). No new CSS framework. Tabs, 4-wide, single quotes, 100 cols.
5. **Accessibility**: focus trap, `aria-modal`, Esc closes, tab order sensible.
6. **Entry point**: export a convenience `window.openGrantPermissions = (opts) => new GrantPermissionsModal(opts).open()` for the manage panel and skills to call — only exposed when `window.AGENT_DEBUG` is true OR via explicit `import`. Do not overwrite an existing global.

## Don't do this

- Do not build a new wallet-connect path. Reuse the existing one.
- Do not auto-approve anything — every button is user-initiated.
- Do not show USD conversions. Show token units only (avoids stale price oracles).
- Do not submit the signature more than once automatically.
- Do not introduce new npm deps.
- Do not leak signatures to analytics / console.

## Acceptance

- [ ] Modal opens from the manage panel and from a skill preset.
- [ ] All three steps are keyboard-navigable.
- [ ] Real MetaMask signature prompt shows the correct domain + message (verify via MM's "Signature details" expand).
- [ ] Happy path ends with a toast and the manage panel refreshes.
- [ ] Reject/close paths resolve cleanly, no zombie listeners.
- [ ] `node --check` + `npm run build` pass.

## Reporting

- Screenshot of each of the three steps + the MetaMask signature view.
- Transcript of the `POST /api/permissions/grant` happy path and one rejected case.
