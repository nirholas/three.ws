# Data retention and deletion policy

Owner and approver: the platform owner. Review cadence: every 12 months. Last reviewed: 2026-11-16. Approval: pending the owner's signature.

The retention windows customers can read are on [three.ws/trust#retention](https://three.ws/trust#retention) and in the [privacy policy](https://three.ws/legal/privacy), section 5. This document is the internal rule behind them.

## Rules

1. Each data type has a stated window. A window with no enforcing job does not exist: [tests/privacy-retention.test.js](../../tests/privacy-retention.test.js) fails when a cited window stops being enforced.
2. Deletion is real: expired rows are deleted, not archived, except where a legal or security reason is stated (legal acceptance records, audit logs for 365 days).
3. Account deletion soft-deletes immediately, blocks every sign-in path, and permanently purges after 30 days ([docs/account-deletion.md](../account-deletion.md), `api/cron/purge-deleted-accounts.js`, daily 04:17 UTC). The purge removes object storage first, then the account and everything it owns.
4. Backups age out: the independent dump bucket deletes objects at 35 days, so removed data leaves backups within that period, which is the rolling-backup rule for data subject erasure.
5. Personal data is minimised: chat message content is not logged, sessions keep IP and user agent for 30 days after expiry, nonces live at most 24 hours.

## Windows (summary)

| Data | Kept | Mechanism |
|---|---|---|
| Deleted accounts | 30 days then purged | `purge-deleted-accounts` |
| Sessions | until expiry plus 30 days | [api/_lib/privacy-retention.js](../../api/_lib/privacy-retention.js) |
| Sign-in nonces | 5 minutes, purged within 24 hours | same |
| Security audit logs | 365 days, archived before pruning | `audit-log-cleanup`, [api/_lib/audit-archive.js](../../api/_lib/audit-archive.js) |
| Usage events | archived then pruned | [api/_lib/db-archive-tables.js](../../api/_lib/db-archive-tables.js) |
| Teams AI messages and feedback, content reports | windows in the same module | `db-retention` cron |
| Database dumps | 35 days | bucket lifecycle |

## Data subject requests

Access, export and erasure requests are handled through account settings (export and delete) or by email to the privacy contact in the privacy policy. Locating a subject's data is a query by user id across the tables listed in the header of [api/_lib/account-purge.js](../../api/_lib/account-purge.js), which classifies every table that references a user.
