# Incident response

How three.ws detects, contains, communicates and closes a production incident, including a security incident or a personal-data breach. This describes the process the system runs today. Each step names the code or runbook that carries it out.

Status: **draft for owner sign-off** (written 2026-11-11 from the running system). Named roles and the on-call rota below are filled in by the owner when signing. Until then the platform owner holds every role. Public summary: [three.ws/trust](https://three.ws/trust#incidents).

## Scope

Anything that degrades availability, integrity or confidentiality of three.ws: an outage, a failing payment rail, a leaked credential, unauthorised access to an account or a custodial wallet, or loss or exposure of personal data.

## 1. Detection

Detection is automatic. Nobody has to notice an outage first.

| Signal | What fires it | Where it lands |
| --- | --- | --- |
| Server faults | Every 5xx from `serverError()`/`wrap()` and every browser error reported to `api/client-errors.js` | `ops_alerts` table, deduplicated by signature ([api/_lib/alerts.js](../api/_lib/alerts.js)) |
| Critical alerts | Leaks, a halted payer, a failed archive, security conditions | Pushed to the private operator Telegram chat and operator email on every occurrence |
| Warnings | Recurring non-critical faults | Telegram once per signature per hour, plus the hourly email digest ([api/cron/ops-alerts-digest.js](../api/cron/ops-alerts-digest.js)) |
| Uptime | `/api/cron/uptime-check` probes the platform, API and x402 surfaces every 5 minutes | Public history at [three.ws/status](https://three.ws/status), served by [api/status.js](../api/status.js) |
| Log sweep | `scripts/gcp-triage.mjs` classifies every Cloud Logging error against the known-failure map | [docs/ops/production-log-triage.md](ops/production-log-triage.md) |
| Credential leaks | `/api/cron/wallets-leak-scan` watches for exposed signer keys | Critical alert |
| Outside reports | Vulnerability reports to `security@three.ws` ([security.txt](../public/.well-known/security.txt)) | Operator inbox |

## 2. Severity

| Level | Meaning | Response target |
| --- | --- | --- |
| SEV1 | Confirmed personal-data exposure, unauthorised movement of user funds, a leaked production secret, or full outage | Start containment immediately; first status update within 1 hour |
| SEV2 | A major surface down (sign-in, payments, generation) or a credible unconfirmed security report | Start within 4 hours |
| SEV3 | Degraded but working (a failover lane carrying load, one upstream down) | Next working day |

## 3. Containment

Tools that exist today, fastest first:

- **Rotate a secret.** Credentials live in Google Secret Manager behind the Cloud Run service. Rotate the secret version, then roll the service. Use `--update-env-vars` / `--update-secrets` (never `--set-env-vars`, which replaces the whole set). See [docs/ops/gcp-production.md](ops/gcp-production.md).
- **Freeze custodial wallets.** The per-agent freeze stops every autonomous spending path at the same server-side gate as spend limits, and never blocks an owner's own withdrawal ([docs/custody.md](custody.md)).
- **Revoke sessions and tokens.** Sessions and OAuth refresh tokens are stored as hashes and can be revoked server-side. Revoking a rotated refresh token revokes its whole chain ([docs/security.md](security.md)).
- **Roll back.** Every deploy is an immutable Cloud Run revision. Route traffic back to the last good revision with `gcloud run services update-traffic`.
- **Disable a feature.** Most risky subsystems have an env kill switch (for example `X402_RING_TICK_ENABLED`, `CIRCULATION_ENABLED`, `DB_ARCHIVE_ENABLED`), changed with `--update-env-vars`.

## 4. Communication

- **Status page.** Outages are visible on [three.ws/status](https://three.ws/status) from the probes, without manual posting.
- **Affected users.** For a personal-data breach the privacy policy commits us to notify affected users, and regulators where required, without undue delay and within the timelines applicable law requires, for example 72 hours to a supervisory authority under GDPR ([privacy policy section 9a](https://three.ws/legal/privacy)). Notices go by email through Resend to the account address.
- **Enterprise customers** (Microsoft Marketplace subscribers, connector tenants): notified at the admin contact on the subscription record within the same window.

## 5. Recovery and close-out

1. Confirm the fix in production (healthz, `/status`, a clean `gcp-triage` sweep).
2. Write the incident into [docs/ops/ISSUES.md](ops/ISSUES.md): timeline, root cause, fix commit, and the monitor signature that will catch a repeat.
3. Add the signature to `scripts/gcp-triage.mjs` and a row to [docs/ops/production-log-triage.md](ops/production-log-triage.md) so the same failure is classified automatically next time.
4. Bug fixes land test-first, with the reproducing test committed alongside the fix.

## Evidence retained

`audit_log` and `x402_audit_log` keep 365 days in the database and are archived to cold storage before pruning ([api/_lib/audit-archive.js](../api/_lib/audit-archive.js)). The custody event trail for each wallet is kept for the life of the wallet. Cloud Logging keeps request logs under the project's log retention settings.

## Owner sign-off items

- Name the incident lead, the communications owner and a backup.
- Confirm `security@three.ws` and `privacy@three.ws` are monitored, and by whom.
- Confirm the response targets in section 2.
