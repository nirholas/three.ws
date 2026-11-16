# Microsoft 365 Certification control matrix

Source: Microsoft 365 Certification control specification (application security, operational security, data handling, security and privacy). Status as of 2026-11-16, derived from the evidence run in `npm run compliance:m365-evidence` and the policies in this folder. Status words: Met, Partial, Gap, Not applicable. Nothing here is a claim of certification: the submission itself is an owner step.

Totals: 70 rows. Met 34, Partial 24, Gap 9, Not applicable 3.

Evidence file names refer to the folder written by `npm run compliance:m365-evidence` (outside the repository, secret-scanned, with a sha256 manifest). Policy names refer to files in [docs/compliance](..).

| ID | Requirement | Implementation | Evidence | Status |
|---|---|---|---|---|
| AS-1 | Annual independent web app and infrastructure pen test, authenticated and unauthenticated | None commissioned; internal header, TLS and dependency audits run instead | npm run compliance:m365-evidence (supporting only) | Gap (owner: commission test) |
| AS-2 | Critical and high findings fixed within one month, retested by the tester | Process defined in the vulnerability policy; no test yet | vulnerability-and-patch-management-policy.md | Gap (depends on AS-1) |
| AS-3 | Full external footprint documented in scope | Footprint is three.ws, the API under it and the listed worker hosts | docs/trust.md, subprocessors list | Partial |
| AS-4 | Internal network in scope unless PaaS | Cloud Run, Neon and R2 are PaaS; no internal network exists | cloud-run-three-ws-api.json | Met |
| AS-5 | All OWASP Top 10 / CWE Top 25 classes covered | Secure development policy maps classes to practices; tester coverage pending | secure-development-policy.md | Partial |
| AS-6 | No automatic-fail issues: unsupported OS or JS library, default or guessable admin accounts, SQLi, XSS, traversal, HTTP smuggling, source disclosure | Managed OS, parameterised SQL, CSP, wallet-based admin allow-list with MFA, header audit passing | dependency-audit-production.json, security-headers-production.json, admin-users-mfa.json | Partial |
| AS-7 | Graph API permissions are least privilege and match the attestation | Teams and Entra surfaces request delegated scopes only, listed in docs/microsoft.md | docs/microsoft.md, tests for manifests | Met |
| AS-8 | Responsible AI disclosure and Copilot interaction | Published AI and data page, AI disclosure on Teams surfaces | docs/trust.md, /trust#ai | Met |
| OS-1 | Security awareness training for all users with defined frequency | Team is the owner plus automated agents; no formal programme or records | information-security-policy.md | Gap (owner: annual training with record) |
| OS-2 | Training frequency defined | Annual, defined in the policy, not yet performed | information-security-policy.md | Gap |
| OS-3 | Individual training records kept | No records exist yet | none | Gap |
| OS-4 | Anti-malware active on sampled system components | Production has no endpoint hosts: Cloud Run containers are immutable and managed by Google; the owner's workstation uses the OS vendor's protection | information-security-policy.md | Partial |
| OS-5 | Anti-malware on-access scanning and signatures within 1 day or EDR/NGAV equivalent | Container image scanning on every push; workstation protection is the OS default | Artifact Registry scanning | Partial |
| OS-6 | EDR blocks known and new variants | No EDR product deployed | none | Gap |
| OS-7 | Approved software list with business justification | package.json and lockfile are the approved list; container base image pinned in Dockerfile | package-lock.json | Met |
| OS-8 | Each application approved before deployment | Dependency changes arrive as reviewed commits and Dependabot pull requests | change-management-policy.md | Partial |
| OS-9 | Application control technology enforced on components | Immutable containers run only the built image; no shell access in production | cloud-run-three-ws-api.json | Met |
| OS-10 | Vulnerability identification and risk scoring policy | Written | vulnerability-and-patch-management-policy.md | Met |
| OS-11 | Evidence of how vulnerabilities are identified | Dependabot, npm audit, OSV, container scanning | dependency-audit-*.json | Met |
| OS-12 | Every vulnerability ranked | CVSS ranking in the policy; findings in docs/security.md | vulnerability policy | Met |
| OS-13 | Components patched within the defined timeframes, no unsupported software | Rebuild on each deploy, Node LTS | dependency-audit-production.json | Partial |
| OS-14 | Patch timeframes 14, 30, 60 days | Defined | vulnerability policy | Met |
| OS-15 | Quarterly infrastructure and web vulnerability scanning reports for the whole public footprint | Header, TLS and dependency scans run each evidence pass; no network or DAST scanner (ZAP baseline needs Docker, not available here) | evidence folder | Partial (owner: quarterly authenticated scanner) |
| OS-16 | Scan findings remediated within timeframes | Tracked as Dependabot pull requests and the risk register | risk-register.md | Partial |
| OS-17 | Network security controls at the boundary and between perimeter and internal | Cloud Run ingress and Google front end are the only boundary; Neon and R2 restrict by credential and TLS; no internal network | cloud-run-three-ws-api.json | Met |
| OS-18 | Hybrid or IaaS: public access terminates at a perimeter network | Not hybrid, not IaaS | n/a | Not applicable |
| OS-19 | Default-deny rules and 6-monthly rule review | Cloud Run has no user-managed firewall rules; IAM bindings reviewed quarterly by the evidence run | iam-service-account-bindings.json, iam-owner-editor-bindings.json | Partial |
| OS-20 | Production changes through documented requests with impact, back-out, testing and authorised approval | Commit plus deploy runbook, rollback command, owner approval gate | change-management-policy.md | Partial (single approver) |
| OS-21 | Separate dev, test and production with separation of duties, no production data in dev | Separate environments exist; the dev .env.local still points at the production database (risk R2) | risk-register.md | Gap (owner: separate dev database) |
| OS-22 | Secure development policy citing OWASP or CWE | Written | secure-development-policy.md | Met |
| OS-23 | Repositories require second-reviewer approval, access control and MFA | No second reviewer or branch protection; owner account MFA to be confirmed | github-repository-controls.json | Gap (owner: protection and 2FA) |
| OS-24 | Production releases reviewed and approved before deploy | Owner approves every deploy; preflight checks | deploy-runbook skill | Met |
| OS-25 | Default credentials removed | No default accounts; admin is a wallet allow-list | admin-users-mfa.json | Met |
| OS-26 | Service account hardening process followed | Dedicated SAs, roles scoped; 5 user-managed keys to retire (risk R3) | service-accounts.json, service-account-user-managed-keys.json | Partial |
| OS-27 | Unique accounts, least privilege, password policy, quarterly dormant-account review | Unique accounts, wallet or email sign-in, roles; quarterly review runs through the evidence pass | access-control-policy.md | Partial |
| OS-28 | MFA on remote access and admin interfaces including repository and cloud console | Admin MFA enforced in the app; cloud console MFA and GitHub 2FA are owner account settings to confirm | admin-users-mfa.json | Partial (1 admin without MFA enrolled) |
| OS-29 | 30 days immediate and 90 days retained security logs | _Default bucket 90 days; audit log 365 days | log-buckets.json | Met |
| OS-30 | Logs reviewed periodically and anomalies investigated | Alerting plus triage loop plus weekly digest | logging-and-monitoring-policy.md | Partial (no SIEM) |
| OS-31 | Alert rules: privileged account changes, high-risk operations, malware, log tampering, IDPS or WAF | Application alerts for admin, signer and payment events; locked audit log bucket; no WAF or IDPS configured | alert-policies.json, logging-and-monitoring-policy.md | Partial |
| OS-32 | Ratified information security risk policy | Written; ratification (owner signature) pending | information-security-policy.md | Partial (owner: sign) |
| OS-33 | Annual company-wide risk assessment | Register created 2026-11-16 with annual review | risk-register.md | Met |
| OS-34 | Targeted risk analysis for controls not in place | Each gap has a register entry | risk-register.md | Met |
| OS-35 | Assessment includes assets, threats, impact and likelihood, register or treatment plan | Yes | risk-register.md | Met |
| OS-36 | Vendor and change risk management | Subprocessor policy and list | supplier-management-policy.md | Met |
| OS-37 | Ratified incident response plan | Written; owner signature pending | docs/incident-response.md | Partial (owner: sign) |
| OS-38 | Plan has team contacts, internal and external communication, regulator timelines | Yes, including GDPR 72 hours | docs/incident-response.md | Met |
| OS-39 | Annual IR training for team members | None recorded | none | Gap (owner: annual exercise with record) |
| OS-40 | Plan updated from tabletop exercises, incidents or organisational change | Process stated; no tabletop yet | docs/incident-response.md | Partial |
| OS-41 | Business continuity plan documented | Written | backup-and-recovery-policy.md | Met |
| OS-42 | BCP has roles, functions, backups, recovery priority and targets, contingency steps | Yes, with measured RTO 215 s | backup-and-recovery-policy.md, backup-latest-report.json | Met |
| OS-43 | Disaster recovery plan documented | Written | backup-and-recovery-policy.md | Met |
| OS-44 | BCP and DRP reviewed every 12 months | Scheduled annually; first review 2026-11-16 | policy headers | Met |
| OS-45 | Plan updated, personnel trained, exercises run with documented results | Automated restore test run daily; no human exercise or training yet | backup-latest-report.json | Partial (owner: tabletop) |
| DH-1 | TLS 1.2 or higher and an inventory of keys and certificates | TLS 1.2 and 1.3 only, managed Google certificates | tls-three-ws.json | Met |
| DH-2 | TLS compression off and HSTS of at least 180 days on all sites | Verified by the TLS probe and header audit | tls-three-ws.json, security-headers-production.json | Met |
| DH-3 | Data at rest encrypted with AES-256 or stronger | Neon, R2 and GCS encrypt at rest with AES-256; application secrets AES-256-GCM | docs/trust.md#encryption | Met |
| DH-4 | Approved retention period established and documented | Written | data-retention-and-deletion-policy.md, /trust#retention | Met |
| DH-5 | Data kept only for the period | Enforced by cron jobs and a test | tests/privacy-retention.test.js | Met |
| DH-6 | Secure deletion after retention | Purge jobs; 35 day backup ageing | data-retention-and-deletion-policy.md | Met |
| DH-7 | Automated scheduled backups | Daily Cloud Build | backup-latest-report.json | Met |
| DH-8 | Backups tested and restored periodically | Restore test in every build | backup-latest-report.json | Met |
| DH-9 | Backups protected, immutable | 30 day locked retention, public access prevention, uniform access | backup-bucket.json | Met |
| DH-10 | List of users with data or key access with justification and approval | Generated from IAM and the admin list; formal approval signature pending | iam-service-account-bindings.json, iam-owner-editor-bindings.json, access-control-policy.md | Partial (owner: sign approval) |
| DH-11 | List of third parties with data sharing agreements | Published subprocessor list with terms links | data/subprocessors.json | Met |
| DH-12 | Privacy information management system with leadership commitment and roles | Privacy policy, retention and deletion policy, owner as accountable role; no ISO 27701 certification | data-retention-and-deletion-policy.md | Partial |
| DH-13 | PII minimisation, deletion at end of processing, transmission controls, cross-border transfer records | Minimisation and deletion in place; transfer record is the subprocessor list with regions | subprocessors list | Partial |
| DH-14 | Data subject access requests, data location knowledge, rolling backup removal | Export and delete in settings, table map in account-purge, 35 day backup lifecycle | data-retention-and-deletion-policy.md | Met |
| DH-15 | Privacy notice with all required elements | Published privacy policy | three.ws/legal/privacy | Partial (counsel review of element list advised) |
| DH-16 | HIPAA policy for staff and vendors | Product does not process ePHI and says so; not a covered entity or business associate | docs/trust.md | Not applicable |
| DH-17 | HIPAA protections, backup and DR under 164.308(a)(7) | Not applicable as above; DR plan exists regardless | backup-and-recovery-policy.md | Not applicable |

## Owner pack (what only the owner can close)

1. Commission an independent annual penetration test of the production footprint (AS-1, AS-2, AS-5, OS-15). Reputable independent firm, authenticated and unauthenticated web app plus external infrastructure, OWASP Top 10 coverage, retest of critical and high.
2. Turn on branch protection for `main` with one required reviewer and add a second maintainer, or document a targeted risk acceptance with a compensating control (OS-23, risk R1). Confirm two-factor authentication on the GitHub owner account.
3. Confirm multi-factor authentication on the Google Cloud console and Neon accounts, and enrol the one admin account without MFA (OS-28).
4. Split development from production data: give `.env.local` a separate Neon branch (OS-21, risk R2). Retire the 5 user-managed service account keys (OS-26, risk R3).
5. Run a security awareness training and an incident tabletop exercise, record attendance and lessons learned (OS-1 to OS-3, OS-39 to OS-45).
6. Sign the policies in this folder and docs/incident-response.md (OS-32, OS-37, DH-10) and name a break-glass deputy (risk R10).
7. Subscribe through Partner Center to Microsoft 365 App Compliance, upload the evidence folder produced by `npm run compliance:m365-evidence`, and submit the Publisher Attestation (owner-only).

## Honest summary

The platform is strong on data handling (TLS, encryption, retention, tested immutable backups, third party list) and on logging and incident documentation. It is weakest where certification assumes an organisation: second-person review, training records, an independent penetration test and EDR. Those are real gaps and are listed rather than papered over.
