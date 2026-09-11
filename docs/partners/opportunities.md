# Partnership and listing pipeline

Every partnership, program, marketplace, and directory three.ws touches, in one place, with
the **single next action** and **who owns it**. This is the decision tool. It deliberately
does not restate the reference docs:

- [Partner ecosystem](../partners.md) is what each partnership **is**, and the framing rules.
- [Listings and distribution](../listings.md) is the descriptive record of every listing.
- [Publishing program](../publishing-program-2026-09.md) is the content and venue matrix.

This page is the part those three do not answer: **what is actually stuck, on whom, and
what unblocks it.**

Last reconciled against the source docs on 2026-09-11.

---

## Do these next

Ranked by value divided by remaining effort, not by size of logo. Every one of these has the
work already done and is waiting on a single human step.

| # | Opportunity | The one action | Why it is first |
|---|---|---|---|
| 1 | **OKX.AI agent #2632** | Submit the on-chain `agent update`, then activate | A built listing is sitting rejected over a payment bug **that was fixed and shipped on 2026-09-05**. OKX's own `agent x402-check` now reads `valid: true` on all four paid rows. Nothing is being built here, a finished listing is simply not live. |
| 2 | **IBM Agent Connect catalog listing** | Email `IBMAgentConnect@ibm.com` for the BYOL `APP_ID` | Everything else is built and verified ([submission pack](../../marketing/ibm-partner-plus/agent-connect-listing.md)). One email opens an IBM-backed enterprise channel. |
| 3 | **AWS Marketplace** | Create the product in the AWS Marketplace Management Portal | The SaaS integration is built, deployed, and conformant. The listing was simply never created, so an enterprise procurement channel we already paid the engineering cost for returns nothing. |
| 4 | **NVIDIA NGC Catalog** | One container build plus the partner legal agreement | The only NVIDIA directory with self-serve intake. The EULA prerequisite is already closed. |
| 5 | **OpenAI Plugin Directory** | Submit | We already meet the gating requirement (public OAuth 2.1 MCP server). |
| 6 | **Second IBM community event** | Pick a date | A fully costed proposal ([ibm-next-event.md](../ibm-next-event.md)) has been waiting on nothing but a calendar decision. Cheapest unblock on this page. |

---

## Live and working

No action required. Listed so nobody re-pitches something we already have.

| Surface | Since | Reference |
|---|---|---|
| IBM Business Partner | active | [ibm.md](../ibm.md) |
| OpenAI Select Partner | active | [partners.md](../partners.md) |
| NVIDIA Inception | 2026-07 | [nvidia-inception.md](../nvidia-inception.md) |
| Google Cloud for Web3 Startups | member | [gcp-credits-plan.md](../ops/gcp-credits-plan.md) |
| QuickNode Startup Program | 2026-07 | [listings.md](../listings.md) |
| Alibaba Cloud Marketplace | live | [listings.md](../listings.md) |
| BNB Chain Dappbay | live | [listings.md](../listings.md) |
| HackerNoon syndication | live, automatic from RSS | [syndication.md](../syndication.md) |
| Hugging Face org account | live | [huggingface.md](../huggingface.md) |
| IBM Community user group | live, we moderate it | [ibm-community.md](../ibm-community.md) |
| pump.fun verification and feature article | live | [listings.md](../listings.md) |

---

## In flight, blocked on us

The work is done or nearly done. A human on our side has to act.

| Opportunity | State | Next action | Owner |
|---|---|---|---|
| OKX.AI agent #2632 | Rejected 2026-09-03, cause fixed 2026-09-05 | On-chain `agent update`, then activate. The stored listing copy is stale, so it is update-then-activate, not activate alone | Owner |
| IBM Agent Connect (BYOL MCP listing) | Fully prepared | `APP_ID` request email, then Concierge | Owner |
| AWS Marketplace | Integration deployed, listing never created | Create the product in the portal | Owner |
| NVIDIA NGC Catalog | Prerequisites cleared | One build plus partner legal agreement | Owner + eng |
| NVIDIA Accelerated Apps Catalog | Portal record filed, copy written | Send the inclusion email | Owner |
| OpenAI Plugin Directory | Eligible | Submit | Owner |
| OpenAI Showcase Gallery | Eligible, open web form | Submit | Owner |
| IBM My Digital Marketing | Entitled, never used | Request access and the Build track marketing kit | Owner |
| Second IBM community event | Proposal written and costed | Pick a date | Owner |
| IBM G2 review | Honest to write, we run Granite in production | Write it | Either |
| CoinGecko market addition for $THREE | Form researched; only one of our live venues qualifies | Submit for that venue | Owner |

## In flight, blocked on them

Nothing for us to do but keep the thread warm. Do not re-scope these into our own backlog.

| Opportunity | State | Note |
|---|---|---|
| OpenAI Cookbook PR #2874 | Open since 2026-07-21 | Revival steps are in [openai-listing-channels.md](../openai-listing-channels.md) |
| Dedicated three.ws page on the IBM domain | Promised 2026-06-18, not live | **Do not link it or describe it as public until IBM ships it** |
| IBM co-promotion on X | Promised 2026-06-18, no recorded delivery | Reopen alongside the Agent Connect conversation |

## Open, unclaimed

Real opportunities with no owner and no motion. Each needs a decision before it needs work.

| Opportunity | Why it is plausible | What it needs first |
|---|---|---|
| Google Cloud Marketplace | Production already runs entirely on Google Cloud Run and Vertex AI. The technical story is finished before the conversation starts | A decision to pursue co-listing and joint GTM |
| Microsoft Azure Marketplace | Third leg of the enterprise procurement story after AWS and Alibaba | Sequencing decision. Do not start before the AWS listing exists |
| Glama MCP directory | `public/.well-known/glama.json` is shipped | **Verify whether we are actually listed.** The manifest exists and is tracked in no listing doc |
| LobeHub plugin directory | `public/.well-known/lobehub-plugin.json` is shipped, dated 2026-04-17 | Same. Manifest shipped, listing state untracked |
| A DeFi protocol partnership | A five-pillar proposal was drafted 2026-07-08 and lives in this directory. It is a point-in-time pitch with figures that are now over a year stale | Decide whether to revive. If yes, the numbers need refreshing before it is sent |

---

## The two manifests nobody is tracking

Worth calling out separately because it is the cheapest finding on this page. Two MCP
directory manifests are shipped in `public/.well-known/` and appear in no listing doc:

- `glama.json`
- `lobehub-plugin.json`

Shipping a manifest is not the same as being listed. Somebody should open both directories,
check whether three.ws actually appears, and then either add the row to
[listings.md](../listings.md) or submit the listing. Fifteen minutes, and it either closes a
gap or confirms a channel we forgot we had.

---

## How to keep this page honest

It rots the moment a status changes, and a stale pipeline is worse than none because it
sends people to re-verify solved problems.

- When a listing goes live, move its row to **Live and working** and add the descriptive
  entry to [listings.md](../listings.md).
- When a blocker clears, move the row from *blocked on them* to *blocked on us*, or delete it.
- Never write a status here you did not read from the source doc or a live check. Each row
  links its source for exactly that reason.
- Do not add a row for a content or publishing venue. Those live in
  [publishing-program-2026-09.md](../publishing-program-2026-09.md).
