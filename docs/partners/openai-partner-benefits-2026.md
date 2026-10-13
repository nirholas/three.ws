# OpenAI Partner Network: 2026 program-year benefits

**Status:** provisioned, notice received 2026-10-11. **Program year:** 2026-07-01 to 2027-06-30.
Everything below expires on **2027-06-30**; unused credits do not roll over.

three.ws is an OpenAI Select Partner (accepted 2026-07-14, see
[partners.md](../partners.md#openai)). This page records what the 2026 program year added and the
rules that come with it. The designation wording is unchanged: write "OpenAI Select Partner", never
imply endorsement ([badge usage](../../marketing/openai-select-partner/badge-usage.md)).

## What was provisioned

| Benefit | Allocation | Where it lives | Admin |
|---|---|---|---|
| Partner tier | Select | OpenAI Partner Network portal | The OPN portal administrator |
| API credits | USD 1,000 | A new, separate API organization | The OPN portal administrator |
| ChatGPT workspace | 300,000 ChatGPT/Codex credits | A new, separate ChatGPT workspace | The OPN portal administrator |

The organization ID and ChatGPT workspace ID are in the provisioning email from OpenAI Partner
Network and in the invitations. They are deliberately not copied into this public repository.

## Pending owner action

OpenAI sends two separate invitations to the portal administrator's inbox: one to the API
organization, one to the ChatGPT workspace. Check spam or junk if neither has arrived. Accepting
them is the only step left; nothing in the repo can do it.

Once the API organization exists, create a project key scoped to partner work and store it as a
distinct secret (for example `OPENAI_PARTNER_API_KEY`), never in place of the production
`OPENAI_API_KEY`. Keeping the two apart is what makes the usage rule below auditable.

## Usage rule (read before spending a credit)

OpenAI provides these benefits **exclusively for approved partner activities**. They are not for
general internal business use or for three.ws's use as an OpenAI customer. Permitted:

- testing OpenAI products and capabilities
- building and validating customer use cases
- developing proofs of concept
- demonstrating solutions to prospective customers
- preparing for customer implementations and deployments

So the credits do **not** run production traffic for three.ws itself (chat brains, workers, cron
jobs). They fund work that is partner-shaped. Candidates already on the roadmap:

| Use | Why it qualifies | Related doc |
|---|---|---|
| Validate the 3D Studio connector and Custom GPT against current models | Testing capabilities and validating a customer use case | [chatgpt-3d-studio-gpt.md](../chatgpt-3d-studio-gpt.md), [mcp-studio.md](../mcp-studio.md) |
| Proof-of-concept builds for prospective customers (embodied agents, spatial MCP) | Proofs of concept and demos | [spatial-mcp.md](../spatial-mcp.md) |
| Codex-assisted work on customer-facing integrations and the OpenAI Showcase submission | Preparing customer implementations | [openai-ibm-nvidia-growth-plan.md](./openai-ibm-nvidia-growth-plan.md) |

Nothing on this platform's own production path should be repointed at the partner organization.

## Announcement

The pack is [announcements/openai-partner-benefits.md](../announcements/openai-partner-benefits.md)
with the post bytes in `openai-partner-benefits.post.txt`. It states the program-year benefits and
what they will be used for, and carries no credit amounts: the figures are an account matter, not
news. Publishing is owner-gated; no X credentials exist on the dev machine, so it goes out from the
queue or `scripts/post-tweet.mjs` on a machine that has them.

## Calendar

| Date | Event |
|---|---|
| 2026-07-01 | Program year begins |
| 2026-10-11 | Provisioning notice received |
| 2027-06-30 | Credits, workspace access and benefits expire |

Set a review for **2027-05-01** to spend down or plan renewal.
