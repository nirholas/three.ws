# Secure software development policy

Owner and approver: the platform owner. Review cadence: every 12 months. Last reviewed: 2026-11-16. Approval: pending the owner's signature.

## Standards

Code follows the OWASP Top 10 and the SANS/CWE Top 25 categories. The rules that make that concrete are in [CLAUDE.md](../../CLAUDE.md) (no mocks, errors handled at network and input boundaries, bug fixes test-first) and in [docs/security.md](../security.md) (authentication, CSRF, rate limiting, CSP, cookie hardening, SSRF and input validation, on-chain validation).

| Class | Practice | Evidence |
|---|---|---|
| Injection | Parameterised SQL through the tagged-template `sql` client; no string-built queries | [api/_lib/db.js](../../api/_lib/db.js), tests |
| XSS | CSP with hashes in production, escaping helpers, no inline handlers (`npm run audit:inline-handlers`-style audits in `scripts/`) | `npm run audit:security-headers`, [scripts/audit-csp.mjs](../../scripts/audit-csp.mjs) |
| Broken access control | Server-side checks on every handler; role ceilings; admin MFA | [api/_lib/admin.js](../../api/_lib/admin.js), tests |
| SSRF and file handling | Allow-listed fetch helpers, upload size and type limits | tests under `tests/` |
| Secrets | Secret Manager, AES-256-GCM, push protection, history scan | [scripts/audit-secrets-history.mjs](../../scripts/audit-secrets-history.mjs) |
| Vulnerable components | Dependabot, `npm audit`, OSV for Python | [vulnerability policy](vulnerability-and-patch-management-policy.md) |

## Repository security

- The repository is public on GitHub with secret scanning and push protection enabled. The owner's account is required to use two-factor authentication on GitHub; the owner confirms this in each review (the setting is not readable through the API).
- `.github/CODEOWNERS` names the owner for every path.
- Gap: the `main` branch has no branch protection and no second human reviewer (see [change management](change-management-policy.md), risk R1).
- No GitHub Actions run in this repository by policy; builds and deploys run in Cloud Build under `three-ws-build@`.

## Releases

Every release to production is approved by the owner and carries its build identity in `/api/version`. The pre-deploy gates are listed in the [change management policy](change-management-policy.md).

## Penetration testing

An independent annual test of the web application and external footprint against production is required by the Microsoft 365 specification and has not been commissioned yet. It is the first item in the owner pack of the control matrix.
