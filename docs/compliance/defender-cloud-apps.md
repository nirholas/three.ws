# Microsoft Defender for Cloud Apps: catalog risk-score matrix

Enterprise security teams filter the Defender for Cloud Apps **Cloud app catalog** by risk score before they sanction or block an app. The score is a weighted average of four category subscores (General, Security, Compliance, Legal) built from more than 90 attributes. Each attribute scores 0 to 10 (True is 10, False is 0, continuous values such as domain age fall on a spectrum), and an unknown value counts as N/A, which lowers the score when the customer includes N/A values. This document records what is true for three.ws on each attribute, where a reviewer can verify it, and what to submit to Microsoft.

Source and scope: Microsoft's public page ([Cloud app catalog and risk scores](https://learn.microsoft.com/en-us/defender-cloud-apps/risk-score), reviewed 2026-11-16) names the categories, the scoring method, the data sources (extracted from the app, extracted by Microsoft's own algorithms such as HTTP security headers, analyst review such as encryption at rest, and vendor requests) and the request path. It does not publish the full attribute list; that list is shown per app in the portal (hover the **i** next to each factor). The matrix below is built from the factors Microsoft names publicly plus the catalog's standard factor set. Cross-check it against the live portal entry for three.ws when it exists, and add any row Microsoft shows that is missing here. Total rows: 71.

Status values: **Met** (true today, evidence public), **Policy** (a statement we publish, true to the code), **Not held** (stated truthfully as not held; never imply it), **N/A** (does not apply to the product).

Evidence base URL: `https://three.ws`. "Trust" means `/trust`; sections are anchors on that page.

## General

| # | Attribute | three.ws value | Evidence | Status |
|---|---|---|---|---|
| 1 | Domain | three.ws | https://three.ws | Met |
| 2 | Founded | Owner to state in the request (not published on /trust) | none yet | Policy |
| 3 | Headquarters | Owner to state in the request (not published on /trust) | none yet | Policy |
| 4 | Vendor / holding | Operated by the three.ws project (nirholas) | https://github.com/nirholas/three.ws | Met |
| 5 | Consumer popularity | Public; not vendor-controlled | none | N/A |
| 6 | Hosting company | Google Cloud (Cloud Run); Neon database; Cloudflare R2 storage | https://three.ws/trust#hosting | Met |
| 7 | Data center location | United States | https://three.ws/trust#hosting | Met |
| 8 | Terms of service URL | /legal/tos | https://three.ws/legal/tos | Met |
| 9 | Privacy policy URL | /legal/privacy | https://three.ws/legal/privacy | Met |
| 10 | Logon URL | /login | https://three.ws/login | Met |
| 11 | Subprocessor list | Published, with data and region per processor | https://three.ws/trust/subprocessors | Met |
| 12 | Status page | Probes every 5 minutes, 90 days history | https://three.ws/status | Met |
| 13 | Open-source code | Apache 2.0 | https://github.com/nirholas/three.ws | Met |
| 14 | Security contact | security@three.ws, RFC 9116 | https://three.ws/.well-known/security.txt | Met |

## Security

| # | Attribute | three.ws value | Evidence | Status |
|---|---|---|---|---|
| 15 | Data-at-rest encryption | Provider default encryption (Google Cloud, Neon, R2) plus application-level AES-256-GCM for sensitive values | Trust#encryption | Met |
| 16 | Data-in-transit encryption | TLS everywhere, HSTS with preload | Trust#encryption | Met |
| 17 | Valid / trusted certificate | Google-managed certificate | https://three.ws | Met |
| 18 | HTTP Strict-Transport-Security | `max-age=63072000; includeSubDomains; preload` | `npm run audit:security-headers` | Met |
| 19 | X-Content-Type-Options | `nosniff` | audit script | Met |
| 20 | Clickjacking protection (X-Frame-Options / frame-ancestors) | On every page except those meant to be embedded (widget, viewer) | audit script | Met (dev now, production on next deploy) |
| 21 | Content-Security-Policy | Set on pages, stricter on auth and account pages | audit script | Met |
| 22 | Referrer-Policy | Set | audit script | Met |
| 23 | Permissions-Policy | Set | audit script | Met |
| 24 | X-XSS-Protection | `0` (legacy filter disabled, per current OWASP guidance) | audit script | Met (production on next deploy) |
| 25 | Multi-factor authentication | Opt-in TOTP with recovery codes on every sign-in path; Entra sign-ins inherit Conditional Access | Trust#authentication | Met |
| 26 | Passkeys / WebAuthn | Not supported | Trust#authentication | Not held |
| 27 | SAML support | SAML 2.0 service provider built, enabled per deployment, not enabled on three.ws today | Trust#authentication | Met (per deployment) |
| 28 | OpenID Connect / OAuth sign-in | Google, GitHub, X, Microsoft Entra ID; three.ws is itself an OAuth 2.1 + PKCE provider | Trust#authentication | Met |
| 29 | Single sign-on | Microsoft Entra ID, Google, GitHub | Trust#authentication | Met |
| 30 | User roles support | Team owner plus fixed-ceiling roles, enforced server-side | Trust#access | Met |
| 31 | IP address restriction | Not offered to customers | none | Not held |
| 32 | User audit trail | Per-account action log with IP and user agent, CSV export | /dashboard/account | Met |
| 33 | Admin audit trail | Team admin activity feed, CSV and JSON export | Trust#logging | Met |
| 34 | Data audit trail | Deletions, key changes and acceptances recorded | Trust#logging | Met |
| 35 | Audit-log retention | 365 days, archived before pruning | Trust#retention | Met |
| 36 | Password policy / hashed credentials | Credentials, sessions, refresh tokens and API keys stored as hashes | Trust#compliance | Met |
| 37 | Session management | Opaque 32-byte tokens, `__Host-` cookie, 30-day lifetime, revocable | Trust#authentication | Met |
| 38 | Token / key revocation | Refresh-token reuse revokes the chain; API keys revocable | Trust#authentication | Met |
| 39 | Rate limiting / abuse protection | Per-IP and per-account limits on auth | api/_lib/rate-limit.js | Met |
| 40 | Vulnerability disclosure program | security.txt, monitored contact | Trust#disclosure | Met |
| 41 | Vulnerability scanning / dependency triage | Advisory triage recorded | docs/security.md | Met |
| 42 | Penetration testing | Internal source-level review October 2026; no third-party test | Trust#compliance | Not held |
| 43 | Secrets management | Google Secret Manager | Trust#access | Met |
| 44 | Data classification | Sensitive values identified and separately encrypted | Trust#encryption | Policy |
| 45 | Data ownership | Customer owns their content; generated files private until published | /legal/tos | Policy |
| 46 | File sharing controls | Private by default, owner publishes | Trust#access | Met |
| 47 | Backup / disaster recovery | Neon point-in-time restore; immutable Cloud Run revisions; off-provider dumps in progress | Trust#backups | Policy |
| 48 | Incident response plan | Drafted, awaiting owner sign-off | Trust#incidents | Not held |
| 49 | Breach notification | Within the legal deadline, e.g. 72 hours under GDPR | Trust#incidents | Policy |
| 50 | Monitoring and alerting | Alerts on every server fault; 5-minute probes | Trust#logging | Met |

## Compliance

| # | Attribute | three.ws value | Evidence | Status |
|---|---|---|---|---|
| 51 | SOC 2 | Not held, no audit under way | Trust#compliance | Not held |
| 52 | ISO 27001 | Not held | Trust#compliance | Not held |
| 53 | ISO 27017 / 27018 | Not held | Trust#compliance | Not held |
| 54 | HIPAA | Not held; not designed for PHI | Trust#compliance | Not held |
| 55 | PCI-DSS | Not held; card data is not handled by three.ws | Trust#compliance | N/A |
| 56 | CSA STAR | Not held | Trust#compliance | Not held |
| 57 | FedRAMP / FISMA / SP 800-53 | Not held | Trust#compliance | Not held |
| 58 | SOC 1 / SOC 3, ISAE 3402, SOX, FINRA, GLBA, COBIT, HITRUST | Not held | Trust#compliance | Not held |
| 59 | Microsoft 365 App Compliance (Publisher Attestation) | In preparation, not submitted | Trust#compliance | Not held |
| 60 | Independent attestation of open-source controls | Every control links to its code | Trust | Met |

## Legal

| # | Attribute | three.ws value | Evidence | Status |
|---|---|---|---|---|
| 61 | Data retention policy | Window per data type, enforced by scheduled jobs with tests | Trust#retention | Met |
| 62 | User data deletion | Account deletion purges owned data | docs/account-deletion.md | Met |
| 63 | GDPR breach notification | 72 hours | Trust#incidents | Policy |
| 64 | GDPR data processing agreement | Not published | none | Not held |
| 65 | Data residency | United States only | Trust#compliance | Met (stated) |
| 66 | Subprocessor transparency | Published | /trust/subprocessors | Met |
| 67 | Privacy policy | Published | /legal/privacy | Met |
| 68 | Content / acceptable-use policy | Published | /legal/content-policy | Met |
| 69 | DMCA / takedown process | Content reporting flow | /legal/content-policy | Policy |
| 70 | Terms of service | Published | /legal/tos | Met |
| 71 | AI data use | Statement of what is sent to which model provider | Trust#ai | Met |

## Gaps closed by this work

- `/trust` no longer says there is no second factor; it describes the shipped two-step verification and lists it as in place (tested in `tests/trust-page.test.js`).
- `/trust` now documents team roles and the audit trail with its export.
- Settings, Security tab links to the action log.
- Headers, security.txt and the regression check already existed: `npm run audit:security-headers` passes against the dev server on :3140. Against production it still fails `X-XSS-Protection is not 0` everywhere and `X-Frame-Options is missing` on non-embeddable pages; the fix is in `server/security-headers.mjs` and ships with the next production deploy.

## Remaining gaps (owner decisions)

Not buildable by code alone: SOC 2 / ISO 27001 (rows 51 to 53), third-party penetration test (42), signed incident response plan (48), a DPA (64), IP allowlisting (31), passkeys (26). State them truthfully; do not claim them.

## Owner pack: score-update request text

Submit in the Defender portal (**Cloud apps > Cloud app catalog**, open the three.ws row, **Request score update**, choose "Score update" or "Update app data", tick "It's OK to contact me"). If three.ws is not yet in the catalog, use **Cloud Discovery > Discovered apps > Actions > Suggest new app** with name `three.ws` and domain `three.ws`. Only a tenant with Defender for Cloud Apps can do this.

> Vendor: three.ws (https://three.ws). Please review the catalog entry. Public evidence for each attribute is at https://three.ws/trust (hosting, encryption, authentication, access, logging, retention, backups, AI data use, incidents, disclosure, compliance) and https://three.ws/trust/subprocessors.
> - Data in transit: TLS with HSTS (`max-age=63072000; includeSubDomains; preload`); full header set (CSP, X-Content-Type-Options, Referrer-Policy, Permissions-Policy, frame protection) verified by an open regression check, `npm run audit:security-headers`. Evidence: https://three.ws/trust#encryption
> - Data at rest: provider encryption (Google Cloud, Neon, Cloudflare R2) plus application AES-256-GCM for sensitive values. https://three.ws/trust#encryption
> - Multi-factor authentication: supported, TOTP with recovery codes on every sign-in path. https://three.ws/trust#authentication
> - SAML 2.0 and OAuth/OIDC sign-in (Microsoft Entra ID, Google, GitHub): https://three.ws/trust#authentication
> - User and admin audit trail with export, 365-day retention: https://three.ws/trust#logging and https://three.ws/trust#retention
> - User roles: https://three.ws/trust#access
> - Data retention and deletion policy, enforced by scheduled jobs: https://three.ws/trust#retention
> - Breach notification within 72 hours: https://three.ws/trust#incidents
> - Vulnerability disclosure: https://three.ws/.well-known/security.txt
> - Terms https://three.ws/legal/tos, privacy https://three.ws/legal/privacy, content policy https://three.ws/legal/content-policy
> Not held, stated plainly: SOC 2, ISO 27001, HIPAA, FedRAMP, third-party penetration test, passkeys.

Before submitting, the owner should confirm rows 2 and 3 (founding year, headquarters) and add them to `/trust`.
