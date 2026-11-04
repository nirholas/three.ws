# Partner startup-program perks (NVIDIA Inception first)

Members of a partner's startup program can apply for **$25 of prepaid three.ws credit**, and earn **$10 more** for a public post about what they made. The free text-to-3D lane stays open to everyone with no account; the credit is for the metered lanes (high quality, game-ready export, rigging, motion).

NVIDIA Inception is live on [/nvidia](https://three.ws/nvidia#inception-perk). Google for Startups, AWS Activate and IBM PartnerPlus are defined in the API and wait only for a form on their partner page (see [Adding a program](#adding-a-program)).

## Why manual review

No partner publishes an API or token that proves a company is in its startup program, and nothing proves a post is live and public. Rather than invent a check that proves nothing, a person reviews each application and each post. Every grant is a bounded amount of credit, not an open-ended comp tier, so a wrong approval has a known ceiling ($500 per approval, $25 and $10 by default).

## The two stages

1. **Application.** The member signs in and submits company, website, contact email, an optional program profile or member ID, and a use case. Approval credits the grant.
2. **Shoutout.** Once approved, the page offers a pre-filled post (opens X's compose box, the member presses send) and a field for the link to the finished post. A reviewer opens the link logged out, confirms it is public, recent and about three.ws, then pays the bonus. A rejected link comes back with the reviewer's reason and the member can submit another.

Only X and LinkedIn post links are accepted. The link is reduced to a canonical form (no tracking parameters), and one post can back one bonus, ever.

## How it works

| Piece | Where |
|---|---|
| The card and both stages | [pages/nvidia/index.html](../pages/nvidia/index.html), [src/inception-perk.js](../src/inception-perk.js) |
| `GET/POST /api/inception/apply` | [api/inception/apply.js](../api/inception/apply.js) |
| `POST /api/inception/shoutout` | [api/inception/shoutout.js](../api/inception/shoutout.js) |
| Programs, validation, review logic | [api/_lib/inception.js](../api/_lib/inception.js) |
| Table `inception_applications` | [migration](../api/_lib/migrations/20261103200000_inception_applications.sql) |
| Owner review queue | [scripts/inception-review.mjs](../scripts/inception-review.mjs) |
| Tests | [tests/inception.test.js](../tests/inception.test.js) |

Both credits go through the normal credit ledger as `grant` rows with idempotency keys `inception:<id>` and `inception-shoutout:<id>`. A review that dies between the credit and the status update is safe to re-run: the credit replays instead of doubling. The database enforces one open application per account per program and one bonus per post.

## Reviewing

```sh
node --env-file=.env.local scripts/inception-review.mjs list
node --env-file=.env.local scripts/inception-review.mjs approve <id> [--usd N] [--note "text"]
node --env-file=.env.local scripts/inception-review.mjs reject <id> --note "what the applicant should fix"
node --env-file=.env.local scripts/inception-review.mjs shoutouts
node --env-file=.env.local scripts/inception-review.mjs approve-shoutout <id> [--usd N]
node --env-file=.env.local scripts/inception-review.mjs reject-shoutout <id> --note "why"
```

`--env-file` must supply `DATABASE_URL` (production's copy is on the Cloud Run service: `node scripts/read-service-env.mjs '^DATABASE_URL$' --raw`).

## Adding a program

1. Add an entry to `PROGRAMS` in [api/_lib/inception.js](../api/_lib/inception.js) (label, grant, bonus, hashtag).
2. Copy the perk card from [pages/nvidia/index.html](../pages/nvidia/index.html) onto that partner's page and set `data-program` on `#perk-root` to the new id.

No schema change. Each program's grant is paid from three.ws's own credit pool; check with the partner before using their name in outreach (see [the playbook](./partner-shoutout-playbook.md)).

## Rollout

The migration must be applied before the endpoints deploy (`npm run db:status` first; `db:migrate` applies everything pending). Until then the form shows its error state with a retry button.

This is a three.ws perk for a partner's members, not a partner offer: NVIDIA does not run or endorse it. See [NVIDIA Inception membership](./nvidia-inception.md).
