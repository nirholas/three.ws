# Partnership and listing pipeline

Every partnership, program, marketplace, and directory three.ws touches, in one place, with
the **single next action** and **who owns it**. This is the decision tool. It deliberately
does not restate the reference docs:

- [Partner ecosystem](../partners.md) is what each partnership **is**, and the framing rules.
- [Listings and distribution](../listings.md) is the descriptive record of every listing.
- [Publishing program](../publishing-program-2026-09.md) is the content and venue matrix.
- [OpenAI, IBM, and NVIDIA growth plan](./openai-ibm-nvidia-growth-plan.md) turns the
  highest-value partner opportunities into a 30-day listing and co-marketing sequence.

This page is the part those three do not answer: **what is actually stuck, on whom, and
what unblocks it.**

Last reconciled against the source docs and live program pages on 2026-09-15. On 2026-09-16 the
external directories, PRs, and program windows that were unverified or stale were re-checked
against their live sources; only rows that say "checked 2026-09-16" carry that re-check, and each
states what the live page showed and links the proof.

---

## Closing windows

Everything else on this page waits. These do not: miss the date and the opportunity is gone
for a cycle, not delayed. Nothing here is on anyone's calendar yet.

| By when | Opportunity | The one action | Owner |
|---|---|---|---|
| **Now** | GitHub Open Source Friday. [Issue #254](https://github.com/githubevents/open-source-friday/issues/254) is open with the `approved` label. Checked 2026-09-16: no date has been posted; the only comment is GitHub's 2026-09-01 request to pick a slot | Select a Friday at `https://gh.io/osf-booking`, then reply on issue #254 with the date | Owner |
| **Apply as soon as a venue is real** | [Hacktoberfest 2026 Fest](https://hacktoberfest.com/host/). Checked 2026-09-16: "Applications are now open and Fests are confirmed on a rolling basis", decisions typically within a week, and no application deadline is published. Apply at `https://hacktoberfest.com/my/` | Name the venue, city, capacity, and host, then submit either a one-day Hack Day or Meet Up application | Owner |
| **2026-09-26** | IBM TechXchange early-bird registration. [IBM's FAQ](https://www.ibm.com/events/techxchange/faq), checked 2026-09-16: early bird is USD 1279.20 from 13 July to **26 September** 2026 (not 29 September as previously recorded), then USD 1599. The event runs 2026-10-26 to 10-29 at the Georgia World Congress Center, Atlanta; the speaking CFP closed in May, but sponsorship, the Sandbox Expo and the colocated user-group route are open, and we moderate an IBM Community user group | Register, or decide not to attend | Owner |
| **Not open as of 2026-09-16** | IBM Champions nomination. Checked 2026-09-16: the [programme page](https://www.ibm.com/community/champions-program/) shows no nomination window and no class-of-2027 call has been announced. The previous cycle [opened 2025-09-15](https://community.ibm.com/community/user/blogs/libby-ingrassia/2025/09/15/ibm-champions-nominations) and closed 2025-11-21. The page now also points to an IBM Rising Champions Advocacy badge route marked "new details coming soon", so the intake may change. Our record already matches all four of IBM's published criteria (spoke at an IBM event, moderate a user group, published on their community, built on Granite). Caveat checked 2026-09-16: production has no `WATSONX_*` credentials and `/api/ibm/galaxy` answers `watsonx_not_configured`, so Granite is not running in production today; restore the credentials before any nomination says it is. Draft: [ibm-champions-nomination.md](../../marketing/partner-packets/ibm-champions-nomination.md). We have never entered | Check the programme page weekly; when the call opens, nominate a person (the program is for individuals, not companies) | Owner |
| **Watch weekly** | NVIDIA GTC 2027 call for speaking/poster submissions. This is separate from the Startup Pavilion, which NVIDIA confirmed is invite-only | Keep the CFP page on a weekly check; maintain the demo and profile for Pavilion consideration | Either |
| Spring 2027 | IBM TechXchange 2027 call for speakers | Submit when it opens | Owner |

Dates and intake routes for the IBM rows are verified in
[ibm-visibility-map.md](../ibm-visibility-map.md); the GTC row in
[nvidia-visibility-map.md](../nvidia-visibility-map.md).

---

## Do these next

Ranked by value divided by remaining effort, not by size of logo. Every one of these has the
work already done and is waiting on a single human step.

| # | Opportunity | The one action | Why it is first |
|---|---|---|---|
| 1 | **OKX.AI agent #2632** | Submit the on-chain `agent update`, then activate | A built listing is sitting rejected over a payment bug **that was fixed and shipped on 2026-09-05**. OKX's own `agent x402-check` now reads `valid: true` on all four paid rows. Nothing is being built here, a finished listing is simply not live. |
| 2 | **IBM Agent Connect catalog listing** | Email `IBMAgentConnect@ibm.com` for the BYOL `APP_ID` | Everything else is built and verified ([submission pack](../../marketing/ibm-partner-plus/agent-connect-listing.md)). One email opens an IBM-backed enterprise channel. |
| 3 | **AWS Marketplace** | Create the product in the AWS Marketplace Management Portal | The SaaS integration is built, deployed, and conformant. The listing was simply never created, so an enterprise procurement channel we already paid the engineering cost for returns nothing. |
| 4 | **NVIDIA Accelerated Apps Catalog** | Complete the existing Shipping product record exactly as NVIDIA requested | NVIDIA answered the request: the portal record is the periodically reviewed application. Copy, technical evidence, logo, brand color, and screenshots are ready; only the authenticated save remains. On 2026-09-16 three.ws was absent from all 1,846 public catalog records. |
| 5 | **NVIDIA NGC Catalog** | One container build plus the partner legal agreement | The only NVIDIA directory with self-serve intake. The EULA prerequisite is already closed. |
| 6 | **OpenAI Plugin Directory** | Submit | We already meet the gating requirement (public OAuth 2.1 MCP server), and the output-quality blocker that held this back is closed: the forge quality gate measured **10/10 verdicts** on production 2026-09-11, up from 0/10 two days earlier. It was closed by fixing the vision failover chain, not by clearing the GCP billing hold. |
| 7 | **Second IBM community event** | Pick a date | A fully costed proposal ([ibm-next-event.md](../ibm-next-event.md)) has been waiting on nothing but a calendar decision. Cheapest unblock on this page. |

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
| Alibaba Cloud Marketplace | live; product page, storefront, and blog feature all render three.ws (checked 2026-09-16) | [listings.md](../listings.md) |
| BNB Chain Dappbay | live | [listings.md](../listings.md) |
| Hugging Face org account | live; one Space, one model, two articles, latest article 2026-08-29 (checked 2026-09-16) | [huggingface.md](../huggingface.md) |
| Official MCP Registry | live; 72 servers under `io.github.nirholas/*`, including `io.github.nirholas/three.ws` 1.0.1 (published 2026-06-12) (checked 2026-09-16) | [registry search](https://registry.modelcontextprotocol.io/v0/servers?search=three.ws) |
| PulseMCP | live, ingested from the official registry, 215 visitors that week (checked 2026-09-16) | [pulsemcp.com/servers/nirholas-three-ws](https://www.pulsemcp.com/servers/nirholas-three-ws) |
| Glama MCP directory | live as connectors ingested from the official registry, but **unclaimed** (checked 2026-09-16); see the claim row below | [three.ws connector](https://glama.ai/mcp/connectors/io.github.nirholas/three.ws) |
| LobeHub MCP marketplace | live; `@three-ws/portal`, `@three-ws/avatar-mcp`, `@three-ws/x402-mcp` and other `nirholas-*` servers are indexed (checked 2026-09-16). The chat plugin is not; see Open, unclaimed | [@three-ws/portal](https://lobehub.com/mcp/nirholas-three-ws-portal) |
| IBM Community user group | live, we moderate it | [ibm-community.md](../ibm-community.md) |
| pump.fun verification and feature article | live | [listings.md](../listings.md) |

---

## In flight, blocked on us

The work is done or nearly done. A human on our side has to act.

| Opportunity | State | Next action | Owner |
|---|---|---|---|
| OKX.AI agent #2632 | Rejected 2026-09-03, cause fixed 2026-09-05 | On-chain `agent update`, then activate. The stored listing copy is stale, so it is update-then-activate, not activate alone | Owner |
| IBM Agent Connect (BYOL MCP listing) | Fully prepared | `APP_ID` request email, then Concierge | Owner |
| AWS Marketplace | Integration code deployed, listing never created. Checked 2026-09-16: `three-ws-api` carries **no `AWS_MP_*` variable** (none in `.env`/`.env.local` either), so `POST /api/aws-marketplace/subscription` answers `503 not_configured` and a buyer arriving from a new listing would hit the error page | From seller account `155407237916`, create the metering IAM key and SNS/EventBridge secret listed in [aws-marketplace.md](../aws-marketplace.md), set them with `gcloud run services update --update-env-vars`, then create the product in the portal | Owner |
| NVIDIA NGC Catalog | Prerequisites cleared | One build plus partner legal agreement | Owner + eng |
| NVIDIA Accelerated Apps Catalog | NVIDIA answered 2026-09-14; complete Shipping records are periodically reviewed, and the current record still understates the runtime stack | Complete the technology fields, Product Description, Technical Details, logo, and brand color in the portal; then check the public catalog monthly | Owner |
| OpenAI Plugin Directory | Eligible | Submit | Owner |
| OpenAI Showcase Gallery | Eligible, open web form | Submit | Owner |
| IBM My Digital Marketing | Entitled, never used | Request access and the Build track marketing kit | Owner |
| Second IBM community event | Proposal written and costed | Pick a date | Owner |
| IBM G2 review | Draft ready in [ibm-g2-review.md](../../marketing/partner-packets/ibm-g2-review.md), written in the past tense because production has had no `WATSONX_*` credentials since at least 2026-07-29 (checked 2026-09-16) | The actual watsonx.ai user rewrites it in their own words with their own console screenshot, or restores the credentials first | Owner |
| CoinGecko market addition for $THREE | Form researched; only one of our live venues qualifies | Submit for that venue | Owner |
| HackerNoon author page | Checked 2026-09-16: [hackernoon.com/u/three-ws](https://hackernoon.com/u/three-ws) is live but shows **no published stories** ("eagerly awaiting @three-ws's next masterpiece"). RSS import lands in the drafts queue; nothing has gone out from it | Open the HackerNoon drafts queue and submit the imported announcements for editorial review | Owner |
| Glama connector claim | Checked 2026-09-16: at least seven three.ws connectors are listed. The main `three.ws` connector is unclaimed and reports **Unhealthy** because Glama has no OAuth test credentials for `https://three.ws/api/mcp` | Claim ownership on the connector page (maintainer email `support@three.ws` is already declared in `public/.well-known/glama.json`), then add a test profile under Admin | Owner |

### Anthropic, which this page was missing

Worth stating plainly: [partners.md](../partners.md) lists eight partners and Anthropic is
not one of them, while the agent brain defaults to Claude models and three Anthropic
surfaces sit at `ready-to-submit` in
[the submission tracker](../../prompts/store-submissions/_generated/TRACKER.md). It is the
most underdeveloped big-tech relationship relative to how much the product already depends
on it, and the cheapest to move.

| Opportunity | State | Next action | Owner |
|---|---|---|---|
| Official MCP Registry, remaining batch | 72 servers are already live (see Live and working). Checked 2026-09-16: the three new servers in the staged batch (`herald-mcp`, `knock-mcp`, `home-mcp`) are still absent from the registry | `mcp-publisher login github`, review the staged batch, run it | Owner |
| Claude plugin marketplace | Ready, install evidence captured | Submit | Owner |
| Claude Connectors Directory | Ready. The old blocker (auth-gated discovery) is resolved | Org role plus a reviewer-credential decision, then submit | Owner |
| Smithery, mcp.so | Checked 2026-09-16: **not listed**. [Smithery's registry API](https://registry.smithery.ai/servers?q=three.ws) and its rendered search return no three.ws or `nirholas` server; [mcp.so search](https://mcp.so/search?q=three.ws) shows "0 results" for both `three.ws` and `nirholas`. Listing content is generated and committed. (PulseMCP, previously grouped here, is already live.) | Create each account and submit | Owner |
| punkpeye/awesome-mcp-servers, AxiomeCG/awesome-threejs | Checked 2026-09-16: **absent** from both READMEs, and neither repo has a PR or issue mentioning three.ws. Copies are ready in `marketing/growth/submissions/` | Open one PR per list from the prepared copy | Owner |

## In flight, blocked on them

Nothing for us to do but keep the thread warm. Do not re-scope these into our own backlog.

| Opportunity | State | Note |
|---|---|---|
| OpenAI Cookbook PR #2874 | Open since 2026-07-21. Checked 2026-09-16: still open and unmerged, review required, 24 comments, last activity our own comment on 2026-09-14 | Revival steps are in [openai-listing-channels.md](../openai-listing-channels.md) |
| Dedicated three.ws page on the IBM domain | Promised 2026-06-18, not live | **Do not link it or describe it as public until IBM ships it** |
| IBM co-promotion on X | Promised 2026-06-18, no recorded delivery | Reopen alongside the Agent Connect conversation |

### Written and never posted

Four finished artefacts are sitting in the repo. Publishing is self-serve on the partner's
own domain, which is the channel with our best track record.

| Artefact | Venue | Owner |
|---|---|---|
| [nvidia-forum-browser-digital-human.md](../nvidia-forum-browser-digital-human.md) | NVIDIA Developer Forums, post 3 | Owner posts |
| [nvidia-forum-gpu-fleet-post.md](../nvidia-forum-gpu-fleet-post.md) | NVIDIA Developer Forums | Owner posts |
| [ibm-community-governed-agents-post.md](../ibm-community-governed-agents-post.md) | Our own IBM user group, against a one-per-week allowance | Owner posts |
| [openai-community-3d-studio-post.md](../openai-community-3d-studio-post.md), [openai-community-physical-world-post.md](../openai-community-physical-world-post.md) | OpenAI Developer Community | Owner posts |

Two more NVIDIA rows with no artefact to write, only an action to take: the AI Podcast guest
nomination (one form, self-nomination invited, answers already drafted) and the Inception
membership announcement on our own channels, which has never been posted. NVIDIA restored
the co-branded asset benefit on 2026-09-14, so retrieve and reconcile the current kit before
publishing. Both are in
[nvidia-visibility-map.md](../nvidia-visibility-map.md), which also flags that the strongest
piece of social proof the company owns is recorded with a null source link and cannot
currently be shown to anyone.

## Open, unclaimed

Real opportunities with no owner and no motion. Each needs a decision before it needs work.

| Opportunity | Why it is plausible | What it needs first |
|---|---|---|
| Google Cloud Marketplace | Production already runs entirely on Google Cloud Run and Vertex AI. The technical story is finished before the conversation starts | A decision to pursue co-listing and joint GTM |
| Microsoft Azure Marketplace | Third leg of the enterprise procurement story after AWS and Alibaba | Sequencing decision. Do not start before the AWS listing exists |
| LobeHub chat plugin index | `public/.well-known/lobehub-plugin.json` (identifier `3d-agent`) is shipped, dated 2026-04-17. Checked 2026-09-16: the [plugin index](https://chat-plugins.lobehub.com/index.json) holds 40 plugins and none is three.ws. Our MCP servers are already listed separately | A decision: submit the plugin to the LobeHub plugin index, or retire the manifest in favour of the MCP listings that already exist |
| A DeFi protocol partnership | A five-pillar proposal was drafted 2026-07-08 and lives in this directory. It is a point-in-time pitch with figures that are now over a year stale | Decide whether to revive. If yes, the numbers need refreshing before it is sent |

---

## The two manifests nobody was tracking: resolved 2026-09-16

Two directory manifests are shipped in `public/.well-known/` and were in no listing doc. Both
directories were checked on 2026-09-16:

- `glama.json`: three.ws is on Glama, as at least seven connectors Glama ingested from the
  official MCP Registry. The main `three.ws` connector is unclaimed and reports Unhealthy for
  lack of OAuth test credentials. The claim is a row under *blocked on us*.
- `lobehub-plugin.json`: our MCP servers are on the LobeHub MCP marketplace, indexed from
  GitHub. The chat plugin this manifest describes is not in LobeHub's plugin index. The
  keep-or-retire decision is a row under *Open, unclaimed*.

Both are now recorded in [listings.md](../listings.md).

---

## Doors that are closed: do not re-research these

Each of these was investigated and ruled out. Recorded so the next person does not spend a
morning rediscovering it.

| Surface | Why not |
|---|---|
| NVIDIA Connect for ISVs | Retired. The page redirects; the programme folded into the Developer Program |
| A self-serve "list my product" form on any NVIDIA marketing surface | None exists except NGC. Everything else runs through the portal record plus a human at the programme inbox |
| NVIDIA Omniverse Exchange | Correctly blocked: OpenUSD interop is roadmap, not shipping |
| NVIDIA Technical Blog | No public guest-submission process. The realistic path is a forum post that performs, then a pitch |
| IBM TechXchange 2026 speaking | CFP closed 2026-05-22, acceptances went out from 2026-07-15. There is no late route to a session |
| `ibm.com/community/ibm-champion-nominate/` | Returns 404 despite ranking in search results. Use the programme page |
| OpenAI Grove | Explicitly aimed at pre-idea and pre-seed founders. three.ws is past that stage |
| Solana ecosystem directory | Checked 2026-09-16: [solana.com/ecosystem](https://solana.com/ecosystem) is now a hub page with no project directory, search, or listing form, and every `/ecosystem/<slug>` path redirects to it. The [solana-labs/ecosystem](https://github.com/solana-labs/ecosystem) data repo behind the 2021 directory is archived, last pushed 2024-03-29. There is nothing to be listed in |
| OpenAI Cookbook as a *primary* channel | The repo promises no merges and most that land come from staff or affiliated partners. Worth reviving, never worth leading with |

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
