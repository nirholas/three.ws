---
mode: agent
description: "Account page block showing linked wallets with add/remove controls"
---

# 01-02 · Account page wallet section

## Why it matters

Once `01-01` lands, users can link wallets — but there's no surface that shows their linked wallets or lets them manage them. A real account page unlocks trust ("I can see what's linked to me") and is the natural place to kick off the onchain register flow (layer 6).

## Prerequisites

- `01-01-wallet-link-existing-account.md` shipped (so `linkWallet()` exists).
- A user-facing account page exists at `/account`, `/settings`, or `/dashboard/account`. If not, create a minimal one at `/account` using the dashboard's CSS chrome.

## Read these first

| File | Why |
|:---|:---|
| [public/wallet-login.js](../../public/wallet-login.js) | `linkWallet()` entry point. |
| [api/auth/me.js](../../api/auth/me.js) | Extend (or confirm) its response includes `wallets: [{ address, linked_at, is_primary }]`. |
| [api/_lib/schema.sql](../../api/_lib/schema.sql) | `user_wallets` table shape. |
| [public/dashboard/](../../public/dashboard/) | Dashboard chrome — match header, typography, button styles. |

## Build this

1. **Extend `/api/auth/me` response** to include a `wallets` array. One query: `SELECT address, linked_at, is_primary FROM user_wallets WHERE user_id = $1 ORDER BY linked_at`.
2. **New endpoint** `DELETE /api/user-wallets/:address`:
   - Session auth required, ownership check.
   - Reject if it's the only wallet AND the user has no password (would lock them out).
   - Soft-delete is fine; hard-delete is also fine — pick one and note in PR.
3. **Account page** at `public/account/index.html` (or wherever is conventional):
   - Fetch `/api/auth/me`, render a "Wallets" section listing each linked wallet with:
     - Truncated address (`0x1234…abcd`), full address on hover.
     - Optional ENS if resolvable (see `01-02-wallet-ens-display.md` — coordinate scope).
     - Linked date, primary indicator.
     - "Remove" button → calls the DELETE endpoint, confirms, refreshes list.
   - "Link another wallet" button → opens the same modal/flow used on sign-in, but calls `linkWallet()` from `01-01`.
4. **Empty state**: if `wallets` is empty, show a friendly "Link your first wallet →" CTA that opens the same flow.

## Out of scope

- ENS rendering details — separate prompt.
- Primary wallet toggle — `01-03-primary-wallet-selection.md`.
- Any onchain-register controls — those live in layer 6.
- Changing password, email, display name — future work.

## Deliverables

- `/api/auth/me` response shape extended.
- New `api/user-wallets/[address].js` (DELETE).
- `public/account/index.html` + its small script.
- Route added to [vercel.json](../../vercel.json) if the DELETE path isn't auto-routed.

## Acceptance

- [ ] Account page loads for signed-in user, lists zero or more wallets.
- [ ] Linking a second wallet updates the list without a full refresh (or a fast refresh is acceptable — note which).
- [ ] Removing a wallet removes it from `user_wallets` and from the UI.
- [ ] Cannot remove the last wallet of a passwordless account (returns 400, UI explains).
- [ ] `npm run build` passes.

## Reporting

- Whether you soft- or hard-deleted.
- Where the account page lives (new path or existing page).
- Screenshot or description of the empty state copy.
