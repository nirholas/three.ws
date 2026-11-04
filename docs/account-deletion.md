# Account deletion and the 30-day purge

What happens to an account after its owner deletes it, what is removed, and what
is kept and why. The user-facing promise is `/legal/privacy`, section 5:
"Deleted accounts are soft-deleted for 30 days (for recovery), then permanently
purged."

## Timeline

| When | What runs | Effect |
| --- | --- | --- |
| Day 0 | `DELETE /api/auth/me` (`api/auth/[action].js`, `handleDeleteAccount`) | Soft delete. `users.deleted_at` is stamped, the username is released, avatars, agents and widgets are taken down, every session and credential is revoked, household access is removed. |
| Days 0 to 30 | Nothing | Recovery window. Every sign-in path refuses the account: password and session lookups filter `deleted_at is null`; wallet sign-in (SIWS and SIWE) answers `403 account_deleted`, both for a wallet still linked in `user_wallets` and for the synthetic wallet email. |
| After day 30 | `api/cron/purge-deleted-accounts.js`, daily at 04:17 UTC | Permanent purge by `api/_lib/account-purge.js` (below). The same wallet can then sign in again and gets a brand-new account. |

## What the purge removes

1. **Object storage.** Every R2 object the account owns: avatar bodies,
   thumbnails, baked, USDZ and half-body variants, animation and mocap clips,
   avatar version GLBs, profile and banner images, agent images. A key that
   another account's row still references is left in place.
2. **The account and everything owned by it.** The `users` row is deleted, which
   removes every row declared `ON DELETE CASCADE` from it (sessions, wallet
   links, identities, API keys, OAuth tokens, avatars, agents, widgets, clips,
   subscriptions, credits, notifications, follows, messages, and the rest of the
   cascade tree). Records the account owns through a plain foreign key or no
   foreign key at all (strategies, listings and bids, sniper and launcher
   configs, regen jobs, drafts, pins and similar) are deleted explicitly first.
   The full classification is the header comment of `api/_lib/account-purge.js`
   (`EDGE_POLICY`, `OWNED_WITHOUT_FK`).
3. **Identifiers on retained rows.** See below.

Storage is deleted before any row, because the rows are the only record of
which keys to delete. Rows are then removed in one transaction.

## What is kept, and how

| Record | Why it is kept | What the purge does to it |
| --- | --- | --- |
| Legal acceptance records (`legal_signatures`) | Policy section 5: kept to establish or defend legal claims | Left as written. |
| Financial and two-party records (withdrawals, payouts, skill earnings, payment-session executions, agent transfers, hires, jobs, bids, bounties, orders, vault positions, subscription and bundle payments, revenue events) | Accounting and tax | The link to the account (and to any agent it owned) is set to null. Any address, wallet, payer, recipient or email column that holds one of the account's own identifiers is cleared, or replaced with a random `purged-` token where the column is `NOT NULL`. Amounts and transaction signatures stay. |
| Security audit log (`audit_log`) | Policy section 5: 365-day security retention | `user_id` is nulled by its `ON DELETE SET NULL` key, and the released username is removed from the deletion event's metadata. |
| x402 and settlement logs (`x402_*`), public-chain indexes (wallet reputation, coin intel, agent registries) | Keyed by a public wallet address that paid an open endpoint or appears on-chain, not by the account | Left as written; pruned on their own windows by `api/cron/db-retention.js`. The full list is `RETAINED_TABLES` in `api/_lib/account-purge.js`. |
| Rows other people own that pointed at the account (a fork of one of its avatars, a referral) | They belong to someone else | Kept; only the pointer is cleared. |

On-chain data (transactions, token accounts, registry entries) cannot be changed
by anyone and is not affected.

## Receipts and failures

- `account_purge_log`: one row per purged account with `user_hash` (SHA-256 hex
  of the user id), the soft-delete time, per-table counts and the number of R2
  objects removed. No email, wallet or username. Support can confirm that a
  known user id was purged by hashing it.
- `account_purge_failures`: an account whose purge fails stays soft-deleted and
  gets a row here with the attempt count and an error code (for example
  `storage_delete_failed`, or `unclassified_fk:<table>.<column>` when a new
  foreign key appears that nobody has classified). The next run retries it after
  the accounts that have never been attempted, and the cron sends an ops alert
  with counts and codes only.

A new foreign key to `users` (or to anything that cascades from it) that is not
`CASCADE` or `SET NULL` must get an entry in `EDGE_POLICY`. Until it does, a
`NOT NULL` one fails the affected accounts closed with `unclassified_fk:...`
rather than guessing, and a nullable one is unlinked as `SET NULL` would.

## Operating it

- Schema: `api/_lib/migrations/20261104180000_account_purge.sql`.
- Read-only count of what the next run would take:
  `countPurgeable({ olderThanDays: 30 })` from `api/_lib/account-purge.js`
  returns `{ purgeable, pending }`.
- Tests: `tests/api/purge-deleted-accounts.test.js` (the purge against a real
  Postgres) and `tests/api/wallet-signin-deleted-account.test.js` (SIWS and SIWE
  sign-in on both sides of the purge).
