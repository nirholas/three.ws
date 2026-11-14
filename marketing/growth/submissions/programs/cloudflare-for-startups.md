# Cloudflare for Startups

Program: Cloudflare for Startups (credit tiers for Workers, R2, Workers AI and more).
Page last read: 2026-11-14 (<https://www.cloudflare.com/forstartups/>). The application form at `https://www.cloudflare.com/lp/startups/` answered HTTP 403 to a fetch, so **form fields: not verified on 2026-11-14**. Tracker row: "Cloudflare for Startups" in `marketing/growth/opportunities.csv`.
Nothing has been submitted. Shared facts and owner-only inputs: [README.md](./README.md).

## What it grants

| Tier | Credits | Criteria |
|---|---|---|
| Tier 3 | USD 10,000 | Bootstrapped or self-funded, under USD 1M raised |
| Tier 2 | USD 100,000 | Under USD 5M raised, funded by an affiliated partner |
| Tier 1 | USD 350,000 | USD 5M or more raised, funded by an affiliated partner |

Changes on the page as of 2026-11-14:

- Tier 3 rose from USD 5,000 to 10,000 and Tier 1 from USD 250,000 to 350,000.
- **Workers AI is no longer covered for incoming startups, effective December 1.** Existing members keep coverage until then (caps USD 2,500, 10,000 and 50,000 by tier). An application approved now would get at most a few weeks of Workers AI coverage, so the draft below plans no Workers AI use.
- **AI Gateway is "temporarily not covered" by credits.**
- Members who joined under the old limits may ask `startups@cloudflare.com` for an upgrade; it does not extend the one-year expiry.

Credits last one year or until used. Review takes up to 48 hours; if silent after a week, write `startups@cloudflare.com` (2026-10-23 read).

## Deadline

None stated.

## Eligibility

| Criterion (quoted) | Status |
|---|---|
| Founded within the last 10 years | Owner input |
| Funded up to Series B, with funding within the last 12 months | Owner input. The wording is odd for bootstrapped companies; Tier 3 ("Bootstrapped or self-funded, under $1M raised") covers them |
| Actively developing a technology product | Met |
| Live, publicly verifiable website | Met: `https://three.ws` |
| Public presence on LinkedIn, X or GitHub | Met: `github.com/nirholas/three.ws` (219 stars, 52 forks per the proof brief), X `@trythreews` |
| First-time applicant | Owner confirms |
| For-profit, business email matching the domain | Use a three.ws address |
| Existing Cloudflare usage | Not an exclusion on the 2026-11-14 page, but disclose it: we already serve public model assets from Cloudflare R2 (the Forge CDN host is an `r2.dev` domain) and production holds a Cloudflare API token for Workers AI |

## Drafted answers (fields inferred from the page)

| Field | Draft answer |
|---|---|
| Company, website | three.ws, `https://three.ws` |
| Contact and business email | Owner input |
| Profile link | `https://github.com/nirholas/three.ws` |
| Funding raised and source (decides the tier) | Owner input. We hold Google for Startups credits (documented in `docs/ops/gcp-credits-plan.md`); disclose if asked |
| What do you build | An open-source platform where an AI agent has a 3D body: text or photo to a rigged avatar, embedded on any page with one web component. Production traffic in Sep 2026: 7,111 finished 3D models, 727 agents, 13,898 MCP tool calls. |
| How would credits be used | R2 for the public model, texture and animation CDN (egress-heavy by nature: every GLB, texture and clip a visitor loads), and Workers for edge caching and signed-URL gateways in front of generated assets. Production compute stays on Google Cloud Run by design; Cloudflare is the delivery layer, not a migration target. |

Do not promise a migration of any API or database. CLAUDE.md prefers GCP for compute.

## Owner steps

1. Confirm the funding tier and enterprise status, then apply at <https://www.cloudflare.com/lp/startups>.
2. Record the actual form fields in this file.
3. On approval: put credits against the existing R2 and Workers account, point the asset-CDN decision at it in `docs/ops`, and record the outcome in the tracker row. Do not move Workers AI traffic onto the credits: it stops being covered on December 1.
