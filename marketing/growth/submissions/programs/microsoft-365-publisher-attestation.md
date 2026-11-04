# Microsoft 365 App Compliance: Publisher Attestation

Program: Microsoft 365 App Compliance Program, Publisher Attestation (self-assessment), run from Partner Center.
Plan item: `docs/microsoft-marketplace-offer-plan.md` section 11 (priority #11). It supports the Copilot MCP package ([microsoft-copilot-mcp-certification.md](./microsoft-copilot-mcp-certification.md)) and any later Teams app.
Drafted: 2026-11-04. Nothing here has been submitted.
Not verified: the live questionnaire is behind Partner Center sign-in and is revised by Microsoft, so the question wording below is grouped by its three published domains (application security, operational security, data handling and privacy) and not copied. Match each draft answer to the question that asks it. Re-read each question before pasting.

## How to use this file

- Every answer is built only from facts in the repo. The source for each is listed so a reviewer can check it.
- **OWNER CONFIRM** marks an answer that depends on something the repo cannot prove (an internal practice, a vendor setting, a headcount). Do not attest to it until you have checked it. An attestation is a signed statement to Microsoft.
- **GAP** marks a control the repo shows we do not have. Answer "No" or "Partially" honestly and use the remediation text.
- Hosting is **not** all on Google Cloud. Compute is Google Cloud Run, but the database is Neon, the object store and CDN are Cloudflare, and Redis is Upstash. Say so wherever the questionnaire asks where data is stored.

## Application profile

| Item | Answer | Source |
| --- | --- | --- |
| App | three.ws MCP servers `https://three.ws/api/mcp-studio` (free 3D tools) and `https://three.ws/api/mcp` | `microsoft-copilot-mcp-certification.md` |
| Publisher | three.ws. Legal entity name and country: OWNER input | `README.md` in this folder |
| Support, privacy, security contacts | `support@three.ws`, `privacy@three.ws`, `security@three.ws` | `public/legal/privacy.html`, `public/.well-known/security.txt` |
| Privacy policy | `https://three.ws/legal/privacy` | `public/legal/privacy.html` |
| Terms | `https://three.ws/legal/tos` | `vercel.json` route |
| Source | Open source, Apache License 2.0 | `docs/security.md` |

## Domain 1: Application security

| Topic | Draft answer | Source | Confirm |
| --- | --- | --- | --- |
| Authentication for users | Browser sessions use opaque random 32-byte tokens stored as SHA-256 hashes, never JWTs, in a `__Host-sid` cookie with HttpOnly, Secure and SameSite=Lax, 30-day TTL with rolling refresh. Sign-in is by email and password, wallet signature (SIWE with single-use nonces), Google or GitHub OAuth, or optional Privy. | `docs/security.md` (Authentication security), `api/auth/` | OWNER: password hashing algorithm (check `api/_lib/auth.js`) before stating it. |
| Authentication for MCP and API clients | OAuth 2.1 with short-lived (1 hour) audience-bound access tokens. Refresh tokens are opaque and hashed; reuse of a rotated refresh token revokes the whole chain. API keys are SHA-256 hashed at rest, shown once, scope-limited and revocable. | `docs/security.md` | |
| Multi-factor authentication for the app | No built-in MFA for end users. | Not found in repo | **GAP**. Answer "No" unless OWNER confirms otherwise. |
| Authorization | Scopes are checked on every request (`hasScope`). Agents act with least privilege: skills declare permissions, and users grant them. | `docs/security.md` | |
| Transport encryption | HTTPS only for authenticated operations; HSTS with max-age two years, includeSubDomains and preload. | `docs/security.md`, `vercel.json` headers | |
| Web protections | CSP, CORS, CSRF HMAC token on state-changing forms, rate limiting, `__Host-` cookie prefix. | `docs/security.md`, `server/csp-hashes.mjs` | |
| Secure development | Public source, dependency advisory triage recorded (`npm audit --omit=dev`), a dedicated dependency check script, and a source-only security audit run on 2026-10-25. | `docs/security.md`, `scripts/check-deps.mjs`, `docs/security/audit-2026-10-25/REPORT.md` | **Honest limit**: that audit is partial (15 of 32 candidates not independently verified, no finding confirmed). Do not describe it as a penetration test. |
| Penetration test by a third party | None recorded. | Not found in repo | **GAP**. OWNER: answer "No" or "Planned" and, for Microsoft 365 Certification later, schedule one. |
| Vulnerability disclosure | `security.txt` at `/.well-known/security.txt`, contact `security@three.ws`. | `public/.well-known/security.txt` | OWNER: confirm someone monitors the mailbox and a response target. |
| Known unpatched advisories | Listed with reachability in `docs/security.md` ("Dependency advisories"); 0 critical, 70 high, 22 moderate, 25 low as of 2026-10-12. | `docs/security.md` | Re-run `npm audit --omit=dev` on submission day and update. |

## Domain 2: Operational security

| Topic | Draft answer | Source | Confirm |
| --- | --- | --- | --- |
| Where the service runs | Google Cloud Run (service `three-ws-api`, region us-central1) in project `aerial-vehicle-466722-p5`, deployed through Cloud Build with dedicated build and runtime service accounts. Scheduled jobs run on Cloud Scheduler. | `CLAUDE.md` stack notes, `docs/ops/gcp-production.md` | |
| Network and secrets | Production configuration and secrets live on the Cloud Run service environment, not in the repository. | `docs/ops/gcp-production.md` | OWNER: confirm whether Secret Manager backs any value. |
| Logging and monitoring | Request and error logs go to Google Cloud Logging, read with `npm run logs`; a documented triage loop monitors production. Chat message content is not logged. Security audit logs are retained 365 days; usage events 90 days. | `docs/ops/gcp-production.md`, `docs/ops/gcp-logs.md`, `docs/security.md`, `public/legal/privacy.html` | |
| Incident response and breach notification | Privacy policy commits to notify affected users and, where required, regulators without undue delay and within applicable timelines (for example 72 hours under GDPR). | `public/legal/privacy.html` section 9a | **OWNER CONFIRM**: a written incident response plan with named roles. None is in the repo. |
| Access control for staff | Production access is through Google Cloud IAM. | `docs/ops/gcp-production.md` | **OWNER CONFIRM**: who holds access, whether 2-step verification is enforced on the Google and Neon accounts, and how access is reviewed. |
| Backups and recovery | Database is a managed Neon Postgres. | `docs/ops/gcp-production.md` | **OWNER CONFIRM**: Neon backup and point-in-time-recovery plan and tested restore. |
| Change management | All changes go through git history; deploys follow a documented runbook with preflight checks. | `docs/ops/gcp-production.md`, `.claude/skills/deploy-runbook/SKILL.md` | |
| Personnel and training | Not in repo. | | **OWNER CONFIRM**: background checks, security training, headcount. |

## Domain 3: Data handling and privacy

| Topic | Draft answer | Source | Confirm |
| --- | --- | --- | --- |
| Data categories processed | Account data (email or wallet address), agent and avatar content the user creates, prompts and generation requests, uploaded photos for avatar reconstruction (optional), usage events. Not collected for the MCP tools: payment card data, health data. | `public/legal/privacy.html`, `docs/mcp-studio.md` | |
| Storage locations | Compute: Google Cloud (us-central1). Database: Neon Postgres on AWS us-west-2. Files and CDN: Cloudflare R2. Cache: Upstash Redis. Email: Resend. Sign-in: Privy (optional). Disclosed as infrastructure providers in the privacy policy. | `docs/ops/gcp-production.md`, `public/legal/privacy.html` section 4 | **OWNER CONFIRM**: current Neon region and the Redis region, and that a data processing agreement is in place with each provider. |
| Encryption in transit | TLS. | `public/legal/privacy.html` 9a, `vercel.json` HSTS | |
| Encryption at rest | Managed-service storage encryption at the provider layer is stated in the privacy policy ("encrypted storage"). Agent wallet secrets and per-agent provider keys are additionally encrypted at the application layer with AES-256-GCM. Sessions, refresh tokens and API keys are stored only as SHA-256 hashes. | `public/legal/privacy.html`, `api/_lib/agent-wallet.js`, `api/_lib/provider-keys.js`, `docs/security.md` | **OWNER CONFIRM**: provider-level encryption at rest for Neon, R2 and Upstash from each provider's own documentation. |
| Use of data to train models | We do not use uploaded selfie photos to train models, do not share them with advertisers, and do not derive or store a face template or biometric identifier. | `public/legal/privacy.html` | |
| Third parties that receive customer content | Chat prompts are sent to a configured large-language-model provider through `/api/chat`, which does not log message content. Providers are tried in a failover order. | `docs/security.md` (Conversation data) | **OWNER CONFIRM**: list the providers that can currently receive a Microsoft tenant's prompts and whether each is under a no-training agreement. For the MCP 3D tools, state which tools call a model. |
| Retention and deletion | Accounts: soft-deleted for 30 days then purged. Sessions 30 days. Usage events 90 days. Security audit logs 365 days. Widget view events 12 months. Users can request access, correction, deletion and export at `privacy@three.ws`. | `public/legal/privacy.html` section 5 and rights section | |
| Data subject requests | Email `privacy@three.ws` from the account email, or sign with the account wallet. | `public/legal/privacy.html` | OWNER: response time target. |
| Customer data separation | Records are scoped to the owning user or agent; generated files are visible only to the owner's account unless they publish. | `public/legal/privacy.html` | |
| Data residency commitments | None offered. | | OWNER: answer "No residency commitment" unless that changes. |
| Compliance certifications | None held (no SOC 2, ISO 27001). | Not found in repo | **GAP**. OWNER: answer "None". Publisher Attestation does not require them; Microsoft 365 Certification does. |

## Honesty checklist before the owner signs

1. Every **OWNER CONFIRM** row resolved from a real source (a dashboard, a vendor page, a written plan), not from this draft.
2. Every **GAP** answered as "No" or "Partially", with the remediation sentence below if the form has a free-text box.
3. No claim of SOC 2, ISO 27001, a pentest, MFA, or Azure hosting.

Remediation sentence for gaps: "three.ws is open source and runs on a small team. We do not yet hold SOC 2 or ISO 27001 and have not commissioned a third-party penetration test. A source-level security audit was completed on 2026-10-25 and its findings are being worked through. We will pursue Microsoft 365 Certification after Publisher Attestation."

## Owner steps

1. Complete the OWNER CONFIRM rows.
2. In Partner Center, open the Microsoft 365 App Compliance Program for the published app, start the Publisher Attestation, and paste the answers.
3. Submit. Microsoft shows the attested status on the listing once reviewed.
