# Microsoft 365 App Compliance: Publisher Attestation

Program: Microsoft 365 App Compliance Program, Publisher Attestation (self-assessment), run from Partner Center.
Plan item: `docs/microsoft-marketplace-offer-plan.md` section 11 (priority #11). It supports the Copilot MCP package ([microsoft-copilot-mcp-certification.md](./microsoft-copilot-mcp-certification.md)) and the Teams app.
Drafted: 2026-11-04. Completed from the code: 2026-11-11. **Status: in preparation. Nothing here has been submitted.**
Public counterpart: [three.ws/trust](https://three.ws/trust) (`pages/trust.html`) and [three.ws/trust/subprocessors](https://three.ws/trust/subprocessors) (`data/subprocessors.json`). Keep the answers here and on those pages identical.
Not verified: the live questionnaire is behind Partner Center sign-in and Microsoft revises it, so the questions below follow its three published domains (application security, operational security, data handling and privacy) rather than copying its wording. Match each answer to the question that asks for it, and re-read each question before pasting.

## How to use this file

- Every answer is built only from facts in the repo or a provider's own published page, and each lists its evidence so a reviewer can check it.
- **OWNER CONFIRM** marks an answer that depends on something the repo cannot prove (an internal practice, a vendor contract, a headcount). The draft answer is the most accurate statement the code supports. Do not attest to it until you have checked it, because an attestation is a signed statement to Microsoft.
- **GAP** marks a control the repo shows we do not have. Answer "No" or "Partially" and use the remediation sentence at the end.
- Hosting is **not** all on Google Cloud. Compute, cache, secrets, logs and the archive are on Google Cloud (us-central1). The database is Neon on AWS us-west-2, and user files are on Cloudflare R2. Say so wherever the questionnaire asks where data is stored. Redis is Google Memorystore, no longer Upstash; the `UPSTASH_*` env var names are legacy.

## Application profile

| Item | Answer | Evidence |
| --- | --- | --- |
| App | three.ws MCP servers `https://three.ws/api/mcp-studio` (free 3D tools) and `https://three.ws/api/mcp`, plus the Microsoft 365 Copilot and Teams app (bot and tab) | `microsoft-copilot-mcp-certification.md`, `integrations/microsoft/copilot-teams/` |
| Publisher | three.ws. Legal entity name and country: **OWNER CONFIRM** (Partner Center account record) | `marketing/growth/submissions/programs/README.md` |
| Support, privacy, security contacts | `support@three.ws`, `privacy@three.ws`, `security@three.ws` | `public/legal/privacy.html`, `public/.well-known/security.txt` |
| Privacy policy | `https://three.ws/legal/privacy` | `public/legal/privacy.html` |
| Terms | `https://three.ws/legal/tos` | `public/legal/tos.html`, `vercel.json` route |
| Trust center | `https://three.ws/trust`, subprocessors at `https://three.ws/trust/subprocessors` | `pages/trust.html`, `pages/trust-subprocessors.html` |
| Source | Open source, Apache License 2.0 | `LICENSE`, `docs/security.md` |

## Domain 1: Application security

| Topic | Answer | Evidence | Confirm |
| --- | --- | --- | --- |
| Authentication for users | Browser sessions use opaque random 32-byte tokens, stored only as SHA-256 hashes and never as JWTs, in a `__Host-sid` cookie (HttpOnly, Secure, SameSite=Lax) with a 30-day TTL and rolling refresh. Users sign in with email and password (bcrypt, cost factor 11), Sign-In With Solana, EVM wallet sign-in (EIP-4361 with single-use nonces), Google, GitHub or X OAuth, or optional Privy. Microsoft Marketplace buyers sign in with Microsoft Entra ID to activate a purchase. | `docs/security.md` (Authentication security), `api/_lib/auth.js` lines 3 and 30, `api/_lib/env.js` (`PASSWORD_ROUNDS`), `api/auth/`, `api/_lib/microsoft-marketplace.js` | |
| Enterprise SSO | A SAML 2.0 service provider is built and can be enabled per deployment. It is not configured on three.ws production today (no `SAML_*` variables on the service). | `api/_lib/saml.js`, `api/auth/saml/[action].js` | |
| Authentication for MCP and API clients | OAuth 2.1 with PKCE, where only `S256` is accepted, and short-lived (1 hour) audience-bound access tokens. Refresh tokens are opaque and hashed; reusing a rotated refresh token revokes the whole chain. API keys are SHA-256 hashed at rest, shown once, limited by scope and revocable. | `api/oauth/[action].js` (S256 check), `docs/security.md` | |
| Multi-factor authentication for the app | No built-in second factor for end users. Wallet sign-in is passwordless, and SSO sign-in inherits the identity provider's MFA policy. No passkeys. | `api/auth/` (no MFA or WebAuthn handler) | **GAP**: answer "No". |
| Authorization | Scopes are checked on every request (`hasScope`). Records are scoped to their owner. Agents act with least privilege: skills declare permissions, and users grant them. Admin endpoints require `requireAdmin` (a wallet allowlist or `users.is_admin`). | `docs/security.md`, `api/_lib/admin.js` | |
| Transport encryption | HTTPS only. HSTS `max-age=63072000; includeSubDomains; preload` on every response. | `vercel.json` headers, live response headers | |
| Web protections | CSP with script hashes, CORS allowlists, HMAC CSRF tokens on state-changing forms, rate limiting on Redis with a durable Postgres fallback, and the `__Host-` cookie prefix. | `docs/security.md`, `server/csp-hashes.mjs`, `api/_lib/rate-limit.js` | |
| Secure development | Public source, triage of dependency advisories recorded with reachability, a dependency check script, test-first bug fixes, and an internal source-only security review run on 2026-10-25. | `docs/security.md`, `scripts/check-deps.mjs`, `CLAUDE.md` (bug fixes are test-first) | Honest limit: that review was partial (15 of 32 candidates not independently verified, no finding confirmed). Do not describe it as a penetration test. |
| Penetration test by a third party | None. | None in repo | **GAP**: answer "No". Schedule one before Microsoft 365 Certification. |
| Vulnerability disclosure | RFC 9116 `security.txt` with Contact `security@three.ws`, Expires, Policy (`https://three.ws/trust#disclosure`), Preferred-Languages and Canonical. Target: acknowledge within 48 hours, patch critical issues within 7 days. | `public/.well-known/security.txt`, `docs/security.md` (Responsible disclosure), `tests/trust-page.test.js` | **OWNER CONFIRM**: someone monitors `security@three.ws`, and the 48 hour / 7 day targets are ones you will keep. |
| Known unpatched advisories | Listed with reachability in `docs/security.md` ("Dependency advisories"): 0 critical, 70 high, 22 moderate, 25 low as of 2026-10-12. | `docs/security.md` | Re-run `npm audit --omit=dev` on submission day and update the counts. |

## Domain 2: Operational security

| Topic | Answer | Evidence | Confirm |
| --- | --- | --- | --- |
| Where the service runs | Google Cloud Run (service `three-ws-api`, region us-central1) in project `aerial-vehicle-466722-p5`, deployed through Cloud Build with dedicated build and runtime service accounts. Scheduled jobs run on Cloud Scheduler. | `server/cloudbuild.yaml`, `docs/ops/gcp-production.md` | |
| Network and secrets | Credentials are held in Google Secret Manager and mounted on the Cloud Run service as secret references; none are in the repository. Redis (Memorystore) sits on a private VPC behind an internal load balancer; the VPC connector carries only private-range traffic. | `docs/ops/gcp-production.md` (Memorystore section), `scripts/read-service-env.mjs` | |
| Logging and monitoring | Request and error logs go to Google Cloud Logging. Every 5xx and reported browser error becomes a deduplicated alert; critical alerts go to the operator by private Telegram and email at once, warnings in an hourly digest. Uptime is probed every 5 minutes and published at `/status`. Signer keys are scanned for leaks every 15 minutes. Chat message content is not logged. Security audit logs are retained 365 days and archived before pruning. | `api/_lib/alerts.js`, `api/cron/ops-alerts-digest.js`, `api/status.js`, `docs/ops/production-log-triage.md`, `api/_lib/audit-archive.js` | |
| Incident response and breach notification | A written plan covers detection, SEV1 to SEV3 severity with response targets, containment (secret rotation, wallet freeze, session revocation, revision rollback, kill switches), communication and close-out. The privacy policy commits to notifying affected users and, where required, regulators without undue delay and within the legal deadline (for example 72 hours under GDPR). | `docs/incident-response.md`, `public/legal/privacy.html` section 9a | **OWNER CONFIRM**: sign off the plan and name the incident lead, communications owner and backup. Until then it is a draft. |
| Access control for staff | Production access is through Google Cloud IAM, with the build and runtime service accounts pinned per deploy. Application admin access requires a signed-in session on the admin allowlist. | `docs/ops/gcp-production.md`, `api/_lib/admin.js` | **OWNER CONFIRM**: who holds GCP, Neon and Cloudflare access, that 2-step verification is enforced on each, and how often access is reviewed. |
| Backups and recovery | Neon point-in-time restore within the plan's restore window. Audit logs, older usage records and pruned market-feed tables are archived to Google Cloud Storage (us-central1, moved to Coldline at 365 days, 7-day soft delete) and verified before rows are deleted. Every deploy is an immutable Cloud Run revision that can be rolled back. One full manual dump was taken on 2026-07-08 to R2. | `api/_lib/db-archive.js`, `docs/ops/gcp-production.md` | **GAP (partial)**: scheduled off-provider dumps are not automated. **OWNER CONFIRM**: the Neon plan's restore window and whether a restore has been tested. |
| Change management | All changes go through git history with descriptive commit messages linted at push. Deploys follow a documented runbook with preflight checks. | `docs/ops/gcp-production.md`, `.claude/skills/deploy-runbook/SKILL.md`, `scripts/check-rules.mjs` | |
| Personnel and training | Not recorded in the repo. | None in repo | **OWNER CONFIRM**: headcount, background checks, security training. |

## Domain 3: Data handling and privacy

| Topic | Answer | Evidence | Confirm |
| --- | --- | --- | --- |
| Data categories processed | Account data (email or wallet address), agent and avatar content the user creates, prompts and generation requests, optional photos uploaded for avatar reconstruction, sign-in IP and user agent on the session record, and usage events. The MCP tools collect no payment card data or health data. | `public/legal/privacy.html`, `docs/mcp-studio.md`, `api/_lib/schema.sql` (sessions) | |
| Storage locations | Compute, Redis, secrets, logs and archive: Google Cloud us-central1. Database: Neon Postgres on AWS us-west-2. Files: Cloudflare R2. Email: Resend. Sign-in: Privy (optional). The full list is published. | `data/subprocessors.json`, `docs/ops/gcp-production.md` | **OWNER CONFIRM**: a data processing agreement is accepted with each provider in `data/subprocessors.json` (each row links its DPA or terms). |
| Encryption in transit | TLS on every connection, HSTS with preload. | `vercel.json` headers, `public/legal/privacy.html` 9a | |
| Encryption at rest | Each storage provider encrypts at rest by default (Google Cloud, Neon, Cloudflare R2, per their published security pages linked on `/trust#encryption`). Custodial wallet keys and per-agent provider keys are also encrypted by the application with AES-256-GCM and HKDF-derived keys. Sessions, refresh tokens and API keys are stored only as SHA-256 hashes; passwords as bcrypt hashes. | `api/_lib/agent-wallet.js`, `api/_lib/provider-keys.js`, `api/_lib/auth.js`, `docs/security.md`, `pages/trust.html` | |
| Use of data to train models | three.ws does not train models on customer prompts, files or photos. It does not share selfie photos with advertisers and does not derive or store a face template. | `public/legal/privacy.html` sections 3 and 10 | |
| Third parties that receive customer content | Chat prompts go through `/api/chat`, which does not log content, to providers in a failover order: Groq, OpenRouter (free models), NVIDIA, OpenAI (paid backstop), Google Vertex AI. Images go to Cloudflare Workers AI for description. Most 3D generation runs on our own Google Cloud GPU workers. Each provider's published data-use statement is quoted and linked on `/trust#ai`: OpenAI, Vertex AI and Workers AI publish that API data is not used for training; Groq publishes no retention by default; OpenRouter publishes that some downstream providers may train if marked; NVIDIA publishes no statement. | `api/chat.js`, `api/_lib/chat-models.js`, `api/_lib/vision.js`, `pages/trust.html` (AI data use), `data/subprocessors.json` | **OWNER DECISION**: because free lanes that do not rule out training can see prompts, answer "Partially" to any question asking whether every processor is under a no-training commitment, or restrict tenant traffic to the OpenAI and Vertex lanes before submitting. |
| Retention and deletion | Deleted accounts: 30 days soft-deleted, then purged by a daily job (files first, then rows; financial records anonymised). Sessions: deleted 30 days after expiry or revocation. Nonces: deleted within 24 hours. Usage events: 60 days live, then archived. Security audit logs: 365 days. Widget views: 12 months. Raw MCP client sessions: 30 days. Each window is a scheduled job, and each is covered by tests. | `api/cron/purge-deleted-accounts.js`, `api/_lib/account-purge.js`, `api/_lib/privacy-retention.js`, `api/cron/db-retention.js`, `api/_lib/db-archive-tables.js`, `api/_lib/audit-archive.js`, `tests/privacy-retention.test.js`, `vercel.json` crons | **GAP**: archived usage events are never deleted, but the privacy policy says 90 days. **OWNER DECISION**: add a GCS lifecycle delete rule on the usage-events archive prefix, or change the policy. Session IPs are stored raw while policy 9a says hashed: **OWNER DECISION** on hashing them. |
| Data subject requests | Email `privacy@three.ws` from the account email, or sign with the account wallet. Response within 30 days. | `public/legal/privacy.html` | **OWNER CONFIRM**: the 30-day target and who answers the mailbox. |
| Customer data separation | Logical separation: every record is keyed to its owning user or agent and checked on every request; generated files are private to the owner until published. No per-tenant database. | `public/legal/privacy.html`, `docs/security.md` | |
| Data residency commitments | None offered. All customer data is processed in the United States. | `data/subprocessors.json` | |
| Compliance certifications | None held: no SOC 2, no ISO 27001. Microsoft 365 Publisher Attestation in preparation (this file). | `pages/trust.html` (Compliance status) | **GAP**: answer "None". Publisher Attestation does not require them; Microsoft 365 Certification does. |

## Honesty checklist before the owner signs

1. Every **OWNER CONFIRM** row resolved from a real source (a dashboard, a vendor contract, a signed plan), not from this draft.
2. Every **OWNER DECISION** row decided, and this file and `pages/trust.html` updated to match.
3. Every **GAP** answered "No" or "Partially", with the remediation sentence below if the form has a free-text box.
4. No claim of SOC 2, ISO 27001, a penetration test, MFA, Azure hosting, or a Microsoft certification or endorsement.

Remediation sentence for gaps: "three.ws is open source and runs on a small team. We do not yet hold SOC 2 or ISO 27001 and have not commissioned a third-party penetration test. An internal source-level security review was completed on 2026-10-25 and its findings are being worked through. Our controls and their evidence are published at https://three.ws/trust. We will pursue Microsoft 365 Certification after Publisher Attestation."

## Owner items, in one list

1. Legal entity name and country for the publisher profile.
2. Confirm `security@three.ws` and `privacy@three.ws` are monitored, by whom, and the 48 hour / 7 day / 30 day targets.
3. Sign off `docs/incident-response.md` with named roles.
4. Staff access: who holds GCP, Neon and Cloudflare access, 2-step verification on each, and the review cadence.
5. Neon restore window and whether a restore has been tested; approve automating off-provider dumps.
6. DPAs accepted with each provider in `data/subprocessors.json`.
7. Decide: usage-events archive deletion rule (or policy change), and hashing session IPs.
8. Decide: answer "Partially" on processor no-training, or restrict tenant traffic to no-training lanes.
9. Headcount, background checks and security training.
10. Re-run `npm audit --omit=dev` on submission day and update the counts.
11. In Partner Center, open the Microsoft 365 App Compliance Program for the published app, start the Publisher Attestation, paste the answers and submit. Then change "in preparation" on `/trust` to the attested status Microsoft shows.
