# Wallet auth — foundation layer

Wallet auth is the base of the entire platform. Until a user can sign in with their wallet, keep that session stable across reloads, and have a single user record link to their wallet(s) deterministically, every downstream feature (selfie agent, avatar edit, onchain passport, CZ demo) is building on sand. These tasks take the existing SIWE scaffold from "works for the happy path" to "works 100%."

Backing code that already exists: [api/auth/login.js](../../api/auth/login.js), [api/auth/logout.js](../../api/auth/logout.js), [api/auth/me.js](../../api/auth/me.js), [api/auth/register.js](../../api/auth/register.js), [api/auth/siwe/nonce.js](../../api/auth/siwe/nonce.js), [api/auth/siwe/verify.js](../../api/auth/siwe/verify.js), [api/_lib/auth.js](../../api/_lib/auth.js), [api/_lib/schema.sql](../../api/_lib/schema.sql), [src/account.js](../../src/account.js), [src/agent-identity.js](../../src/agent-identity.js), [public/wallet-login.js](../../public/wallet-login.js).

## Recommended execution order

1. [01-fix-agents-me-500.md](./01-fix-agents-me-500.md) — **do this first.** Every page fetches `/api/agents/me` on load; a 500 there makes every task below harder to debug. Ship state: active bug.
2. [02-siwe-flow-hardening.md](./02-siwe-flow-hardening.md) — nonce TTL, replay, chainId + domain binding audit of [api/auth/siwe/verify.js](../../api/auth/siwe/verify.js). Ship state: spec ready.
3. [03-link-wallet-to-user.md](./03-link-wallet-to-user.md) — schema + API for one user → many wallets, one wallet → one user. Depends on 02 being green. Ship state: spec ready.
4. [04-connect-wallet-button.md](./04-connect-wallet-button.md) — one shared "Connect wallet" component + state machine used everywhere. Depends on 02. Ship state: spec ready.
5. [05-session-refresh-and-logout.md](./05-session-refresh-and-logout.md) — session cookie lifecycle, refresh, "log out everywhere", MetaMask disconnect handling. Ship state: spec ready.

## Rules that apply to every task in this series

- **No new runtime dependencies** unless the task file explicitly allows them. `ethers@6.16.0`, `jose`, `zod`, `bcryptjs` are already available.
- **No TypeScript.** This repo is vanilla ESM JS with JSDoc. Don't introduce `.ts` files or references.
- `node --check` every modified `.js` file before reporting done.
- Run `npx vite build` and note whether it breaks. The pre-existing `@avaturn/sdk` resolution warning is unrelated and should be ignored.
- Respect other tasks' file ownership. If a sibling task already owns an endpoint, don't edit it — note the collision in your report.
- If you discover an unrelated bug, note it in your report. Do not fix it in the same change.
- Stay on one task end-to-end. Do not silently hop to adjacent concerns.

## Reporting

Each task ends with a short report: files created, files edited (which sections), commands run and their output, manual verification URLs, any surprises.
