# NVIDIA Inception member perk

Startups in NVIDIA Inception can apply for **$25 of prepaid three.ws credit**. The free text-to-3D lane stays open to everyone with no account; the credit is for the metered lanes (high quality, game-ready export, rigging, motion).

Applicants use the form on [/nvidia](https://three.ws/nvidia#inception-perk). Approval is manual.

## Why manual review

NVIDIA publishes no API or token that proves a company is an Inception member. Rather than invent a check that proves nothing, each application is reviewed by a person: look at the Inception profile or member ID the applicant gave, or reply to their contact email. The grant is a bounded amount of credit, not an open-ended comp tier, so a wrong approval has a known ceiling.

## How it works

| Step | Where |
|---|---|
| Applicant signs in and submits the form | [pages/nvidia/index.html](../pages/nvidia/index.html), [src/inception-perk.js](../src/inception-perk.js) |
| `GET/POST /api/inception/apply` (session auth, 50/10min per IP) | [api/inception/apply.js](../api/inception/apply.js) |
| Validation, storage, approve and reject | [api/_lib/inception.js](../api/_lib/inception.js) |
| Table `inception_applications` (one pending or approved row per account) | [migration](../api/_lib/migrations/20261103200000_inception_applications.sql) |
| Owner review queue | [scripts/inception-review.mjs](../scripts/inception-review.mjs) |
| Tests | [tests/inception.test.js](../tests/inception.test.js) |

Approval credits the account through the normal credit ledger as a `grant` row with idempotency key `inception:<application id>`. A review that dies between the credit and the status update is safe to re-run: the credit replays instead of doubling. A rejected applicant sees the reviewer's note on the page and can reapply.

## Reviewing applications

```sh
node --env-file=.env.local scripts/inception-review.mjs list
node --env-file=.env.local scripts/inception-review.mjs approve <id> [--usd 25] [--note "text"]
node --env-file=.env.local scripts/inception-review.mjs reject <id> --note "what the applicant should fix"
```

`--env-file` must supply `DATABASE_URL` (production's copy is on the Cloud Run service; read it with `node scripts/read-service-env.mjs '^DATABASE_URL$' --raw`). Grants are capped at $500 per application.

## Rollout

The migration must be applied before the endpoint is deployed (`npm run db:status`, then the normal deploy chain in the deploy runbook). Until then the form shows its error state with a retry button.

This is a startup-program perk, not an NVIDIA offer: NVIDIA does not run or endorse it. See [NVIDIA Inception membership](./nvidia-inception.md).
