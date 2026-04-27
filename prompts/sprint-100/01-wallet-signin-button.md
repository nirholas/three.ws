# 01 — Wallet signin button (client module + header affordance)

## Why

Server endpoints at [api/auth/siwe/nonce.js](../../api/auth/siwe/nonce.js) and [api/auth/siwe/verify.js](../../api/auth/siwe/verify.js) already exist and work. The user-facing button does not. Without a click-path, SIWE is unreachable.

## Parallel-safety

- You own ONE new file and make ONE single-line edit to [index.html](../../index.html) (adding the button near existing nav). You may NOT edit `src/app.js`.
- If another prompt is also editing `index.html`, insert your button at the end of the existing `<header>` nav section and keep your diff to <10 lines.

## Files you own

- Create: `src/wallet-auth.js`
- Edit: [index.html](../../index.html) — add a `<button id="btn-wallet-signin">Sign in with wallet</button>` inside the existing header nav, plus one `<script type="module">` tag at the bottom that imports and wires your module. No other edits.

## Read first (do not edit)

- [src/erc8004/agent-registry.js](../../src/erc8004/agent-registry.js) — exports `connectWallet()` returning `{ provider, signer, address, chainId }`.
- [api/auth/siwe/nonce.js](../../api/auth/siwe/nonce.js) — returns `{ nonce, ttl }`; treat `ttl` as seconds from now.
- [api/auth/siwe/verify.js](../../api/auth/siwe/verify.js) — accepts `{ message, signature }`, sets `__Host-sid` cookie on success.
- [api/auth/me.js](../../api/auth/me.js) — GET returns `{ user }` if signed in, 401 otherwise.

## Deliverable

`src/wallet-auth.js` exports:

```js
export async function signInWithWallet()
export async function signOut()
export async function getCurrentUser()  // returns user or null, via /api/auth/me
export function wireSigninButton(buttonEl) // attaches click handler + swaps UI for signed-in chip
```

`signInWithWallet()` flow:

1. `connectWallet()` → `{ signer, address, chainId }`
2. `POST /api/auth/siwe/nonce` with `{ address }` — read `{ nonce }`.
3. Build EIP-4361 message string client-side:

    ```
    ${location.host} wants you to sign in with your Ethereum account:
    ${address}

    Sign in to three.ws.

    URI: ${location.origin}
    Version: 1
    Chain ID: ${chainId}
    Nonce: ${nonce}
    Issued At: ${new Date().toISOString()}
    ```

4. `signature = await signer.signMessage(message)`
5. `POST /api/auth/siwe/verify` with `{ message, signature }`, `credentials: 'include'`.
6. On 200, resolve with the returned user. On non-200, throw with the server's `error`/`message` field.

`wireSigninButton(buttonEl)`:

- Calls `getCurrentUser()` on load. If signed in, replace the button with a small chip `0xabcd…1234 · sign out`. If signed out, attach the click handler.
- Click handler: disable button, show inline status text, call `signInWithWallet()`, on success reload page, on failure show the error under the button.
- If `window.ethereum` is missing AND no Privy is configured, status text: "No wallet detected — install MetaMask or use a wallet-enabled browser."

Use no `alert()`. No new CSS files. Reuse existing CSS vars if present, otherwise inline minimal styles (`style="..."`).

## Acceptance

- `node --check src/wallet-auth.js` passes.
- `npm run build` produces no new warnings.
- Header button renders; clicking it with MetaMask present triggers the SIWE signature flow and reloads signed-in.
- Refresh → chip shows truncated address. Click sign-out → cookie cleared, button returns.

## Report

- Commands run + full output.
- A note on how signed-in detection works (the `getCurrentUser` call) and its caching/latency.
- Any friction (double prompts, race on fast clicks).
