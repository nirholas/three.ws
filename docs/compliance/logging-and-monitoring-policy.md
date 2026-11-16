# Logging and monitoring policy

Owner and approver: the platform owner. Review cadence: every 12 months. Last reviewed: 2026-11-16. Approval: pending the owner's signature.

## What is logged and for how long

| Log | Where | Retention |
|---|---|---|
| Request and application logs of every Cloud Run service | Google Cloud Logging `_Default` bucket | 90 days (30 days immediately queryable, the whole 90 days kept) |
| Admin Activity audit logs of Google Cloud | Cloud Logging `_Required` bucket | 400 days, locked (cannot be shortened or deleted) |
| Application audit trail: sign-ins and failures, API key and two-step verification changes, deletions, legal acceptances, admin and team admin actions, with time, IP address and user agent | `audit_log` table ([api/_lib/audit.js](../../api/_lib/audit.js)) | 365 days, archived to storage before pruning ([api/_lib/audit-archive.js](../../api/_lib/audit-archive.js)) |
| Operational alerts | `ops_alerts` table | until resolved, then pruned by the retention job |

Chat message content is not logged. Evidence of the retention settings: `log-buckets.json` in each evidence run.

## Alerting

Every server fault and every browser error reported to `api/client-errors.js` becomes an alert, deduplicated by signature ([api/_lib/alerts.js](../../api/_lib/alerts.js)). Critical alerts are pushed to the owner's private Telegram chat and by email on every occurrence; warnings arrive in an hourly digest. Conditions that raise a critical alert include a leaked signer key (`wallets-leak-scan`, every 15 minutes), a halted payer, a failed archive, admin session rule violations and the other security conditions listed in the [incident response plan](../incident-response.md#1-detection). Uptime probes run every 5 minutes against the platform, API and payment surfaces and publish on [/status](https://three.ws/status).

Admin actions (privileged account use) are written to the audit trail; a new or changed admin is visible in `admin-users-mfa.json` of each evidence run. Cloud Run sits behind Google's front end; there is no separate WAF or IDPS product, so WAF and IDPS alerts do not apply. Log tampering is prevented for Google Cloud audit logs by the locked `_Required` bucket.

## Review

- Continuous: the alert pipeline above. Every alert is read by the owner or by the scheduled monitoring loop (`npm run triage:gcp`, [docs/ops/production-log-triage.md](../ops/production-log-triage.md)), which classifies every Cloud Logging error against the known-failure map and records what it found.
- Weekly: the owner reads the alert digest and the triage output; anything unexplained is opened as an incident.
- Quarterly: the evidence run captures retention settings and the admin list.

The review is carried out by the owner and a scheduled agent loop, not by a security team; there is no SIEM.
