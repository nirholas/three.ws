# Task: Unified "Connect wallet" component + state machine

## Context

Repo: `/workspaces/3D`. Wallet connection happens in three places today, each with ad-hoc code:

1. [public/wallet-login.js](../../public/wallet-login.js) — the `/login` page's SIWE sign-in button.
2. [src/erc8004/agent-registry.js](../../src/erc8004/agent-registry.js) — onchain agent registration prompts a connect to mint ERC-8004.
3. [src/agent-identity.js](../../src/agent-identity.js) — `linkWallet(address, chainId)` is called from places that assume the wallet is already connected, but nothing in the UI guarantees that.

Each one re-implements "request accounts, check chain, prompt signature" with different error messages, different UI states, and different assumptions about what "connected" means. When these fall out of sync, users see confusing mid-flow errors. A single source of truth fixes that.

The stack is vanilla JS + Vite. No React. No framework. `ethers@6.16.0` is already a dep.

## Goal

One component and one state machine that every caller uses. When the button is in a given state, it looks and behaves the same whether it's on `/login`, the agent registration modal, or the dashboard settings page.

## Deliverable

1. New module `src/wallet/connect-button.js` exporting:
    - A class `ConnectWalletController` — headless state machine with the states below. Emits `change` events on state transition.
    - A factory `createConnectWalletButton(mountEl, opts)` — renders and wires a button that binds to the controller. Returns the controller.
2. New module `src/wallet/state.js` exporting the state enum and a pure reducer for unit-testability.
3. Refactored [public/wallet-login.js](../../public/wallet-login.js) to use the controller. Strip its copy of the connect logic; keep only the page-specific redirect-after-success behavior.
4. Minimal CSS in `public/wallet-connect.css` — the button should not depend on the existing login page's CSS to render correctly when used elsewhere.
5. A standalone demo page `public/wallet-connect-demo.html` that mounts three buttons side-by-side (sign in, link additional wallet, register agent) — used for manual QA only; not linked from the site nav.

## State machine

States (one active at a time):

- `idle` — no wallet connected, button reads "Connect wallet".
- `detecting` — transient; checking `window.ethereum`.
- `no_provider` — no injected wallet present. Button links to metamask.io / brave wallet install.
- `requesting_accounts` — `eth_requestAccounts` call in flight. Button reads "Check your wallet…".
- `connected` — have address + chainId, no signature yet. Button reads short address + network name.
- `wrong_chain` — connected but chainId not in the allowed set. Button reads "Switch to <expected>".
- `signing` — SIWE message signature in flight. Button reads "Sign in your wallet…".
- `verifying` — posting signature to the configured verify endpoint. Button reads "Verifying…".
- `success` — terminal (per flow). Opts-provided `onSuccess` fires.
- `error` — recoverable. Has `error.message`. Button reads "Retry". A `reset()` call returns to `idle`.

Transitions (inputs from the reducer):

| From                  | Input                   | To                    |
| --------------------- | ----------------------- | --------------------- |
| `idle`                | `connect()`             | `detecting`           |
| `detecting`           | no `window.ethereum`    | `no_provider`         |
| `detecting`           | has provider            | `requesting_accounts` |
| `requesting_accounts` | `eth_accounts` resolves | `connected`           |
| `requesting_accounts` | user rejects            | `error`               |
| `connected`           | chainId ∉ allowed       | `wrong_chain`         |
| `connected`           | `sign()` called         | `signing`             |
| `wrong_chain`         | user switches chain     | `connected`           |
| `signing`             | signature obtained      | `verifying`           |
| `signing`             | user rejects            | `error`               |
| `verifying`           | server 200              | `success`             |
| `verifying`           | server 4xx/5xx          | `error`               |
| any                   | `reset()`               | `idle`                |
| any                   | wallet disconnect event | `idle`                |

## Audit checklist

**Controller API**

- [ ] `new ConnectWalletController({ allowedChainIds, nonceUrl, verifyUrl, messageBuilder, onSuccess })`.
- [ ] `messageBuilder(address, chainId, nonce) → string` — caller supplies the SIWE message text so link-flow and login-flow can differ in the statement line. Default implementation returns the same message [public/wallet-login.js](../../public/wallet-login.js) uses today.
- [ ] `connect()` — kicks off the flow from `idle`. Idempotent if already past `idle`.
- [ ] `signAndVerify()` — from `connected`/`wrong_chain` → goes through signing + verifying.
- [ ] `reset()` — returns to `idle`, clears `error`.
- [ ] `get state()` + `get address()` + `get chainId()` + `get error()` getters.
- [ ] `addEventListener('change', handler)` / `removeEventListener` — standard EventTarget.
- [ ] Listens for `accountsChanged` and `chainChanged` on `window.ethereum` and transitions correctly. Removes listeners on `dispose()`.

**Chain handling**

- [ ] `allowedChainIds` defaults to `[1, 8453, 10, 42161, 11155111, 84532]` (mainnets + sepolia/base-sepolia) — matches ERC-8004 deployments in [src/erc8004/abi.js](../../src/erc8004/abi.js).
- [ ] `wrong_chain` offers `wallet_switchEthereumChain` with the first allowed chain. If that RPC is unknown (`error.code === 4902`) the component surfaces a clear error, not a white screen.
- [ ] After a successful switch, listens for `chainChanged` and re-enters `connected`.

**Button rendering**

- [ ] Mount target is any `HTMLElement`. The factory replaces its contents — does not wrap in extra divs.
- [ ] No dependencies on dat.gui, three, or the viewer. `src/wallet/` is self-contained.
- [ ] Text is overridable via `opts.labels` for localization and flow-specific language.
- [ ] Button has `aria-busy="true"` during async states.
- [ ] `[data-state]` attribute mirrors the current state — CSS can key off it.

**Integration with existing login page**

- [ ] [public/wallet-login.js](../../public/wallet-login.js) uses `createConnectWalletButton`, passing `verifyUrl = '/api/auth/siwe/verify'`, `onSuccess = () => location.href = next`.
- [ ] The Privy branch (if kept) is not the concern of this task — leave the Privy button behavior as-is; only refactor the raw-wallet path.
- [ ] The existing error-div behavior still works — controller error surfaces through the `change` event.

**No leaks**

- [ ] `dispose()` method on controller removes `accountsChanged`, `chainChanged`, any pending abort signals. Callers in SPA contexts (agent creator modal, dashboard) must be able to unmount cleanly.

## Constraints

- **No new runtime dependencies.** `ethers@6.16.0` for `BrowserProvider`; no Web3Modal, RainbowKit, wagmi, viem.
- **No framework.** Vanilla JS + DOM APIs.
- **ESM only**, tabs 4-wide (project Prettier config).
- **JSDoc for public APIs** — controller methods, option types, state enum.
- **Do not change the SIWE message format.** The server parser in [api/auth/siwe/verify.js](../../api/auth/siwe/verify.js) is tight — keep message structure identical to what [public/wallet-login.js](../../public/wallet-login.js) produces today.
- **Do not bundle this into the 11k-line [src/viewer.js](../../src/viewer.js).** It's a standalone module.
- **Do not auto-connect on page load.** Silent connection attempts (`eth_accounts` without `eth_requestAccounts`) are allowed only if `opts.autoDetect === true`.

## Verification

1. `node --check src/wallet/connect-button.js src/wallet/state.js public/wallet-login.js`
2. `npx vite build` — passes.
3. Open `public/wallet-connect-demo.html` in a browser with MetaMask:
    - Click "Connect wallet" on the first button → MetaMask prompt → connected state shows short address.
    - Switch MetaMask to an unsupported chain → button shows "Switch to Mainnet".
    - Click → switch prompt → returns to connected.
    - Click "Sign in" → signature prompt → server verifies → success state.
    - Disconnect in MetaMask → all three buttons return to `idle` via `accountsChanged`.
4. `/login` still works end-to-end: connect → sign → redirected to `/dashboard/`.
5. Reducer tests (optional but recommended) — if you add `scripts/test-connect-reducer.mjs`, assert every transition in the table above.

## Scope boundaries — do NOT do these

- Do not add Privy-specific integration. Privy stays in its current code path.
- Do not add WalletConnect / QR-code flow.
- Do not implement the "link additional wallet" endpoint — that is task 03. This component just has to _support_ being pointed at that endpoint via `verifyUrl`.
- Do not add logout / session refresh (task 05).
- Do not change [api/auth/siwe/verify.js](../../api/auth/siwe/verify.js) or [api/auth/siwe/nonce.js](../../api/auth/siwe/nonce.js).
- Do not add styling that overrides the global site theme. Component CSS must be scoped via the `[data-state]` attribute or a prefixed class.

## Reporting

- File list (new + modified) with line counts.
- State-machine transitions you implemented, with any deviations from the table above and why.
- Allowed chain IDs and where the list is sourced.
- Screenshots or manual-test notes from `wallet-connect-demo.html`.
- Any coupling to [public/wallet-login.js](../../public/wallet-login.js) you couldn't break cleanly.
