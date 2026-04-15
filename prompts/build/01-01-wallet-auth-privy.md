# 01-01 — Wallet auth: Privy as alternative to MetaMask

**Branch:** `feat/auth-privy`
**Stack layer:** 1 (Wallet auth)
**Depends on:** nothing
**Blocks:** 06-* (onchain registration — needs a wallet the user already holds)

## Why it matters

Wallet auth is the foundation of the stack. Today [public/wallet-login.js](../../public/wallet-login.js) only supports MetaMask via `ethers.BrowserProvider`. Mobile users and users without a browser extension are locked out. Privy gives us email, social, and embedded-wallet login in one SDK while still producing a real EOA we can pass to SIWE.

## Read these first

| File | Why |
|:---|:---|
| [public/wallet-login.js](../../public/wallet-login.js) | Current MetaMask-only flow. You will extend it, not replace it. |
| [api/auth/siwe/nonce.js](../../api/auth/siwe/nonce.js) | Nonce endpoint — already works, do not touch. |
| [api/auth/siwe/verify.js](../../api/auth/siwe/verify.js) | Verifies the signed message. Works with any EOA that produces an EIP-4361 signature. |
| [public/login.html](../../public/login.html), [public/register.html](../../public/register.html) | Shells that load `wallet-login.js`. |
| [api/_lib/auth.js](../../api/_lib/auth.js) | Session cookie issuance — do not duplicate. |

## Build this

1. Add `@privy-io/react-auth`'s browser-only dependency — **skip** if it requires React. Use `@privy-io/js-sdk-core` (framework-agnostic) instead. Justify the single added dep in the PR description.
2. In [public/wallet-login.js](../../public/wallet-login.js), expose two entry points:
   - `loginWithMetaMask()` — existing flow, unchanged.
   - `loginWithPrivy()` — opens Privy modal, gets an embedded or external wallet, produces an EIP-4361 signature, posts it to `/api/auth/siwe/verify` exactly like the MetaMask path.
3. Add two buttons to [public/login.html](../../public/login.html) and [public/register.html](../../public/register.html): **"Sign in with MetaMask"** and **"Sign in with Privy"**. Same SIWE backend for both.
4. Add `PRIVY_APP_ID` to `.env.example` (client-side, `VITE_PRIVY_APP_ID`). Document that the user must set this to enable the button; if unset, hide the Privy button.

## Out of scope

- Do not add email/password login flows — they already exist elsewhere.
- Do not touch `/api/auth/siwe/verify`. Both wallets speak the same SIWE message.
- Do not change session cookie format.
- Do not add a React runtime. If `@privy-io/js-sdk-core` is unavailable, stop and report.

## Acceptance

- [ ] MetaMask path still works end-to-end from `/login` in an incognito window.
- [ ] Privy button shown only when `VITE_PRIVY_APP_ID` is set.
- [ ] Privy login issues a session cookie identical in shape to the MetaMask path.
- [ ] `/api/auth/me` returns the same user shape regardless of provider.
- [ ] `npm run build` passes.
