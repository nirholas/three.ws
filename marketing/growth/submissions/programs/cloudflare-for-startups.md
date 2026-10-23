# Cloudflare for Startups

Program: Cloudflare for Startups (credit tiers for Workers, R2, Workers AI and more).
Page last read: 2026-10-23 (<https://www.cloudflare.com/forstartups/>). The application form lives at `/lp/startups`, which the page links but does not list fields for. **Form fields: not verified on 2026-10-23.** `docs/partners` has no Cloudflare row today; this program is new to the tracker (add one on submission).
Nothing has been submitted. Shared facts and owner-only inputs: [README.md](./README.md).

## What it grants

| Tier | Credits | Criteria |
|---|---|---|
| Tier 3 | USD 10,000 | Bootstrapped or self-funded, under USD 1M raised |
| Tier 2 | USD 100,000 | Under USD 5M raised, funded by an affiliated partner |
| Tier 1 | USD 350,000 | USD 5M or more raised, funded by an affiliated partner |

Workers AI caps: USD 2,500 (Tier 3), 10,000 (Tier 2), 50,000 (Tier 1); the terms also state a USD 10,000 R2 cap and a USD 50,000 Workers AI cap without a tier split, so the page is inconsistent. Credits last one year or until used; extensions are not approved. Review takes up to 48 hours; if silent after a week, write `startups@cloudflare.com`. Three reminder emails precede graduation.

## Deadline

None stated.

## Eligibility

| Criterion (quoted) | Status |
|---|---|
| Incorporated no more than 10 years ago | Owner input |
| Funded up to Series B, with funding in the last 12 months | Owner input. The page's wording is odd for bootstrapped companies; Tier 3 covers them |
| Actively developing a technology product | Met |
| Live, publicly verifiable website | Met: `https://three.ws` |
| Public presence on LinkedIn, X or GitHub | Met: `github.com/nirholas/three.ws` (219 stars, 52 forks per the proof brief), X `@trythreews` |
| First-time applicant | Owner confirms |
| For-profit, business email matching the domain | Use a three.ws address |
| Not an existing enterprise customer | Owner confirms no Enterprise contract. We already serve public model assets from Cloudflare R2 (the Forge CDN host is an `r2.dev` domain) |

## Drafted answers (fields inferred from the page)

| Field | Draft answer |
|---|---|
| Company, website | three.ws, `https://three.ws` |
| Contact and business email | Owner input |
| Profile link | `https://github.com/nirholas/three.ws` |
| Funding raised and source (decides the tier) | Owner input. We hold Google for Startups credits (documented in `docs/ops/gcp-credits-plan.md`); disclose if asked |
| What do you build | An open-source platform where an AI agent has a 3D body: text or photo to a rigged avatar, embedded on any page with one web component. Production traffic in Sep 2026: 7,111 finished 3D models, 727 agents, 13,898 MCP tool calls. |
| How would credits be used | R2 for the public model, texture and animation CDN (egress-heavy by nature), Workers for edge caching and signed-URL gateways in front of generated assets, and Workers AI for small embedding and moderation tasks. Production compute stays on Google Cloud Run by design; Cloudflare is the delivery layer, not a migration target. |

Do not promise a migration of any API or database. CLAUDE.md prefers GCP for compute.

## Owner steps

1. Confirm the funding tier and enterprise status, then apply at <https://www.cloudflare.com/lp/startups>.
2. Record the actual form fields in this file.
3. On approval: put credits against the R2 and Workers account, point the asset-CDN decision at it in `docs/ops`, and add a tracker row with the outcome.
