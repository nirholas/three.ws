---
mode: agent
description: "Unify Privy + SIWE so one user row handles both email+wallet auth paths"
---

# Stack Layer 1: Unified Privy + SIWE Auth

## Problem

Privy is integrated (per recent commit `e4bc161`) and SIWE is being added. Without a single source of truth, we'll end up with two parallel user tables / session mechanisms and a mess of bugs at the boundary. Users who sign in via Privy (email + embedded wallet) and users who sign in via external wallet (MetaMask SIWE) must resolve to the **same** user row keyed by wallet address.

## Implementation

### Schema reconciliation

`users` table should have:
- `id` (primary key, uuid or serial)
- `wallet_address` (unique, lowercase, nullable only during transitional migration)
- `privy_did` (nullable, unique when set)
- `email` (nullable)
- `handle` (nullable)
- `created_at`, `updated_at`

### Server resolution logic ([api/_lib/](api/_lib/))

Add `resolveUser({ walletAddress, privyDid, email })` helper:
1. If `privyDid` is provided: look up by `privy_did`. If found, return.
2. If `walletAddress` is provided: look up by `wallet_address`. If found, link `privy_did` if not set, return.
3. Else create a new row with whatever identifiers are present.
4. Never create two rows for the same wallet.

### Privy callback

When Privy auth completes, server-side verify the Privy token, extract `did` + wallet address (if embedded wallet), call `resolveUser`, issue the same JWT as SIWE path.

### SIWE callback

After SIWE verify succeeds, call `resolveUser({ walletAddress })`, issue JWT.

### Client

`/login.html` shows two options: "Sign in with Wallet" (SIWE, MetaMask/WalletConnect) and "Sign in with Email" (Privy). Both land at the same `/dashboard/` and produce the same `/api/auth/me` response shape.

### Migration

If there are existing user rows with only `email`, backfill `wallet_address` from Privy embedded wallet on next login.

## Validation

- Sign in via MetaMask (SIWE). Note user id. Sign out.
- Sign in via Privy email with the same wallet as the embedded wallet → same user id.
- Sign in via Privy email only (no embedded wallet), then later link a wallet → merges into same row, no duplicate.
- `/api/auth/me` returns consistent shape regardless of auth path.
- `npm run build` passes.

## Do not do this

- Do NOT create `privy_users` or `wallet_users` side tables. One table.
- Do NOT trust Privy's client-side token — always verify server-side via the Privy SDK.
