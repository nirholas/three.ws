# Information security and risk management policy

Owner and approver: the three.ws platform owner. Review cadence: every 12 months and after any SEV1 incident. Last reviewed: 2026-11-16. Approval: pending the owner's signature (listed in the owner pack of [the control matrix](m365-certification/controls.md#owner-pack)).

This policy describes how three.ws is secured today. Where practice falls short of a control, the gap is named here and in the matrix instead of being written as if it were closed.

## Scope

The production service: the Cloud Run service `three-ws-api` and the other services and workers in Google Cloud project `aerial-vehicle-466722-p5`, the Neon Postgres database, Cloudflare R2 storage, the source repository `github.com/nirholas/three.ws`, and the Microsoft 365 surfaces (Teams and Copilot app, Marketplace SaaS offer, Entra sign-in and SCIM). Subprocessors are listed in [data/subprocessors.json](../../data/subprocessors.json) and on [/trust/subprocessors](https://three.ws/trust/subprocessors).

## Roles

| Role | Held by | Responsibility |
|---|---|---|
| Platform owner and security officer | the repository owner | approves policies, holds production credentials, signs off releases and incident closure |
| Engineering | the owner and AI coding agents working in the repository under the rules in [CLAUDE.md](../../CLAUDE.md) | build, test, review diffs, run the audits |

There are no employees other than the owner. Contractors and agents get no standing production access: agents work in the repository and run read-only audits; deploys and secret changes need the owner's approval (CLAUDE.md, gate 2).

## Principles

1. Least privilege: separate runtime and build service accounts, each with a short role list ([access control policy](access-control-policy.md)).
2. No secrets in source: values live in Google Secret Manager; sensitive values stored in the database are encrypted with AES-256-GCM ([api/_lib/secret-box.js](../../api/_lib/secret-box.js)); a secret scan runs on every push (GitHub push protection) and on history ([scripts/audit-secrets-history.mjs](../../scripts/audit-secrets-history.mjs)).
3. Everything is logged and alerts reach the owner ([logging and monitoring policy](logging-and-monitoring-policy.md)).
4. Every change is a commit, checked mechanically before push ([change management policy](change-management-policy.md)).
5. Data is kept for a stated period and then deleted ([data retention policy](data-retention-and-deletion-policy.md)).

## Risk management

Risk register: [risk-register.md](risk-register.md). Method: for each system component, list the threat, the existing control, impact (1 to 3) and likelihood (1 to 3), the product as a score, and a treatment (mitigate, accept with a recorded reason, transfer, or avoid) with a due date and owner. The owner reviews the whole register once a year (next due 2027-11-16) and updates it when a control is added or removed, when a provider key is added to or removed from the production service (the same trigger as the subprocessor review), after a SEV1 or SEV2 incident, and whenever a control is found missing. A targeted risk analysis is written for any case where a standard control is absent (for example no second human code reviewer, recorded in the register).

Vendor and partner risk: [supplier management policy](supplier-management-policy.md).

## Security awareness

The owner reads the project's security documents ([docs/security.md](../security.md), [docs/incident-response.md](../incident-response.md)) and the Microsoft 365 Certification control specification annually, and records the date in the review log below. AI coding agents are constrained by repository rules that are checked mechanically (`npm run check:rules`, `npm run check:claude`). There is no formal training programme with per-person completion records yet. Because the owner is the only person with access, the matrix records this as a gap rather than claiming a programme exists; it becomes a programme the day a second person gets access.

## Review log

| Date | Reviewer | Note |
|---|---|---|
| 2026-11-16 | platform owner (pending signature) | First written version, generated from the running system |
