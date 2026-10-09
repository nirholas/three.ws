# Partnership and listing pipeline

Every partnership, program, marketplace, and directory three.ws touches, in one place, with
the **single next action** and **who owns it**. This is the decision tool. It deliberately
does not restate the reference docs:

- [Partner ecosystem](../partners.md) is what each partnership **is**, and the framing rules.
- [Listings and distribution](../listings.md) is the descriptive record of every listing.
- [Publishing program](../publishing-program-2026-09.md) is the content and venue matrix.
- [OpenAI, IBM, and NVIDIA growth plan](./openai-ibm-nvidia-growth-plan.md) turns the
  highest-value partner opportunities into a 30-day listing and co-marketing sequence.
- [Partner prospects](./prospects.md) is the scored list of new partners from the 2026-10-09
  sweep, and [the outreach plan](./outreach-plan.md) is how it is worked. A prospect moves
  onto this page when it gets its first action.

This page is the part those three do not answer: **what is actually stuck, on whom, and
what unblocks it.**

Last reconciled against the source docs and live program pages on 2026-09-15. Startup programs from the CloudCredits sweep were added on 2026-09-18 and carry "checked 2026-09-18". On 2026-09-16 the
external directories, PRs, and program windows that were unverified or stale were re-checked
against their live sources; only rows that say "checked 2026-09-16" carry that re-check, and each
states what the live page showed and links the proof. On **2026-10-08** every external row was
re-checked again; rows that say "checked 2026-10-08" carry that pass, and the ones whose status
changed are called out in place.

---

## Closing windows

Everything else on this page waits. These do not: miss the date and the opportunity is gone
for a cycle, not delayed. Nothing here is on anyone's calendar yet.

| By when | Opportunity | The one action | Owner |
|---|---|---|---|
| **2026-10-09, 5 p.m. PT** | NVIDIA GTC 2027 Content Interest Survey ([form](https://forms.gle/iwGUwc5YQfw6f7X27)). Checked 2026-10-08: open since 2026-09-16, closes tomorrow. Answers are written | Paste the answers from [nvidia-gtc-2027-poster.md](../nvidia-gtc-2027-poster.md#content-interest-survey-closes-2026-10-09-5-pm-pt) | Owner |
| **2026-11-10, 5 p.m. PT** | NVIDIA GTC 2027 poster call (San Jose, 2027-03-15 to 03-18). Checked 2026-10-08: [open](https://www.nvidia.com/en-us/gtc/present/call-for-submissions/), original technical work only, nothing promotional. Two submissions are written with measured production evidence, including a new rig-coverage benchmark (`node scripts/a2f-rig-coverage.mjs`). No speaker call is posted; the Startup Pavilion stays invite-only | Submit poster A from [nvidia-gtc-2027-poster.md](../nvidia-gtc-2027-poster.md) as the presenting author (acceptance means attending the poster reception) | Owner |
| **Now** | GitHub Open Source Friday. [Issue #254](https://github.com/githubevents/open-source-friday/issues/254) is open with the `approved` label. Checked 2026-10-08: still no date posted, and no activity since GitHub's 2026-09-01 request to pick a slot | Select a Friday at `https://gh.io/osf-booking`, then reply on issue #254 with the date | Owner |
| **Before 2026-10-31** | [Hacktoberfest 2026 Fest](https://hacktoberfest.com/host/). Checked 2026-10-08: still "Applications are now open and Fests are confirmed on a rolling basis" with no published deadline, but Hacktoberfest ends 2026-10-31 and decisions take about a week, so a Fest application is only useful in roughly the next two weeks. Apply at `https://hacktoberfest.com/my/` | Name the venue, city, capacity, and host, then submit either a one-day Hack Day or Meet Up application | Owner |
| **2026-10-26** | IBM TechXchange attendance. [IBM's FAQ](https://www.ibm.com/events/techxchange/faq), checked 2026-10-08: the early bird (USD 1279.20) **closed 2026-09-26 unused**; the standard pass is USD 1599, the hotel block closed 2026-10-01, and full refunds ended 2026-09-22. The event runs 2026-10-26 to 10-29 at the Georgia World Congress Center, Atlanta; the speaking CFP closed in May, but sponsorship, the Sandbox Expo and the colocated user-group route are open, and we moderate an IBM Community user group | Register, or decide not to attend | Owner |
| **Not open as of 2026-10-08** | IBM Champions nomination. Checked 2026-10-08: the [programme page](https://www.ibm.com/community/champions-program/) still shows no nomination window and no class-of-2027 call, which is now three weeks later than last year's opening. The previous cycle [opened 2025-09-15](https://community.ibm.com/community/user/blogs/libby-ingrassia/2025/09/15/ibm-champions-nominations) and closed 2025-11-21. The page now also points to an IBM Rising Champions Advocacy badge route marked "new details coming soon", so the intake may change. Our record already matches all four of IBM's published criteria (spoke at an IBM event, moderate a user group, published on their community, built on Granite). Caveat checked 2026-09-16 and again 2026-10-08 (not on `three-ws-api`, not in Secret Manager, not in either env file): production has no `WATSONX_*` credentials and `/api/ibm/galaxy` answers `watsonx_not_configured`, so Granite is not running in production today; restore the credentials before any nomination says it is. Draft: [ibm-champions-nomination.md](../../marketing/partner-packets/ibm-champions-nomination.md). We have never entered | Check the programme page weekly; when the call opens, nominate a person (the program is for individuals, not companies) | Owner |
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
| 4 | **NVIDIA Accelerated Apps Catalog** | Complete the existing Shipping product record exactly as NVIDIA requested | NVIDIA answered the request: the portal record is the periodically reviewed application. Copy, technical evidence, logo, brand color, and screenshots are ready; only the authenticated save remains. On 2026-09-16 three.ws was absent from all 1,846 public catalog records. Checked 2026-10-08: the catalog URL now redirects to `marketplace.nvidia.com/en-us/enterprise/applications/`, which did not load for an automated check, and a web search finds no three.ws listing. |
| 5 | **NVIDIA NGC Catalog** | Sign the partner legal agreement and ask NVIDIA whether one replica per GPU meets the multi-GPU rule | The only NVIDIA directory with self-serve intake. The EULA prerequisite is closed, and the portable container is built and passes its in-image tests (rebuilt 2026-10-08 on current source; [details](../nvidia-ngc-listing.md#gate-2-the-kernels-are-compiled-for-one-gpu-generation)). |
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
| Official MCP Registry | live; 72 servers under `io.github.nirholas/*`, including `io.github.nirholas/three.ws` 1.0.1 (published 2026-06-12) (checked 2026-09-16). The staged batch has since landed: `herald-mcp`, `knock-mcp`, and `home-mcp` 0.1.0 all resolve (checked 2026-10-08) | [registry search](https://registry.modelcontextprotocol.io/v0/servers?search=three.ws) |
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
| AWS Marketplace | Integration code deployed, listing never created. Checked 2026-09-16 and again 2026-10-08: `three-ws-api` carries **no `AWS_MP_*` variable** (none in `.env`/`.env.local` either), so `POST /api/aws-marketplace/subscription` answers `503 not_configured` and a buyer arriving from a new listing would hit the error page | From seller account `155407237916`, create the metering IAM key and SNS/EventBridge secret listed in [aws-marketplace.md](../aws-marketplace.md), set them with `gcloud run services update --update-env-vars`, then create the product in the portal | Owner |
| NVIDIA NGC Catalog | Prerequisites cleared; portable `ngc-candidate` image rebuilt and tested 2026-10-08 | Partner legal agreement (owner), then one Ampere or Hopper inference check on a GCE VM (eng) | Owner + eng |
| NVIDIA Accelerated Apps Catalog | NVIDIA answered 2026-09-14; complete Shipping records are periodically reviewed, and the current record still understates the runtime stack | Complete the technology fields, Product Description, Technical Details, logo, and brand color in the portal; then check the public catalog monthly | Owner |
| OpenAI Plugin Directory | Eligible | Submit | Owner |
| OpenAI Showcase Gallery | Eligible, open web form | Submit | Owner |
| IBM My Digital Marketing | Entitled, never used | Request access and the Build track marketing kit | Owner |
| Second IBM community event | Proposal written and costed | Pick a date | Owner |
| IBM G2 review | Draft ready in [ibm-g2-review.md](../../marketing/partner-packets/ibm-g2-review.md), written in the past tense because production has had no `WATSONX_*` credentials since at least 2026-07-29 (checked 2026-09-16) | The actual watsonx.ai user rewrites it in their own words with their own console screenshot, or restores the credentials first | Owner |
| CoinGecko market addition for $THREE | Form researched; only one of our live venues qualifies | Submit for that venue | Owner |
| HackerNoon author page | Checked 2026-10-08: [hackernoon.com/u/three-ws](https://hackernoon.com/u/three-ws) still shows **no published stories**. RSS import lands in the drafts queue; nothing has gone out from it. **New 2026-10-08:** the profile carries stray data that is not ours: the job title, the "Read My Stories" button, and the "Portfolio" link all describe or point at someone else's profile. The bio itself is correct | First clean the profile (title, stories link, portfolio link). Then open the drafts queue and submit the imported announcements for editorial review | Owner |
| DEXTools, reciprocal 3D embed | Our side is shipped: DEXTools charts are already a provider in every three.ws chart switcher, and as of 2026-09-20 `/coin3d` is framable and keyed by pair address, which is the identifier a DEXTools pair page already holds. As of 2026-10-08 proposal pillars 3 and 4 are built too: DEXTools leads every terminal row, launches get a Social Boost card, and every link we send is counted at `/api/coin/dextools-stats` ([surface map](../listings.md#dextools)). The relationship has public receipts in both directions: three $THREE Social Boost wins with DEXTools buybacks behind them | Send [dextools-proposal.md](./dextools-proposal.md) to a DEXTools partnerships or front-end contact. Nothing else is blocked; the embed is live and free whether or not they answer | Owner |
| Glama connector claim | Checked 2026-10-08: still unclaimed and **Unhealthy, 0.0% uptime over 51 days**, last tested 2026-10-07; Glama's own note blames missing test credentials. That is correct behaviour on our side, not a bug: `/api/mcp` deliberately answers an MCP client's `initialize` with the 401 that starts OAuth, so no unauthenticated health check can pass. Glama now also offers a domain claim through `https://three.ws/.well-known/glama.json` (already served) or a `_glama-claim.three.ws` DNS record | Claim ownership on the connector page (maintainer email `support@three.ws` is already declared in `public/.well-known/glama.json`), then add a test profile under Admin | Owner |

### Anthropic, which this page was missing

Worth stating plainly: [partners.md](../partners.md) lists eight partners and Anthropic is
not one of them, while the agent brain defaults to Claude models and three Anthropic
surfaces sit at `ready-to-submit` in
[the submission tracker](../../prompts/store-submissions/_generated/TRACKER.md). It is the
most underdeveloped big-tech relationship relative to how much the product already depends
on it, and the cheapest to move.

| Opportunity | State | Next action | Owner |
|---|---|---|---|
| Claude plugin marketplace | Ready, install evidence captured | Submit | Owner |
| Claude Connectors Directory | Ready. The old blocker (auth-gated discovery) is resolved | Org role plus a reviewer-credential decision, then submit | Owner |
| Smithery, mcp.so | Checked 2026-09-16 and again 2026-10-08: **not listed**. [Smithery's registry API](https://registry.smithery.ai/servers?q=three.ws) and its rendered search return no three.ws or `nirholas` server; [mcp.so search](https://mcp.so/search?q=three.ws) shows "0 results" for both `three.ws` and `nirholas`. Listing content is generated and committed. (PulseMCP, previously grouped here, is already live.) | Create each account and submit | Owner |
| punkpeye/awesome-mcp-servers, AxiomeCG/awesome-threejs | Checked 2026-09-16 and again 2026-10-08: **absent** from both READMEs, and neither repo has a PR or issue mentioning three.ws. Copies are ready in `marketing/growth/submissions/` | Open one PR per list from the prepared copy | Owner |

## In flight, blocked on them

Nothing for us to do but keep the thread warm. Do not re-scope these into our own backlog.

| Opportunity | State | Note |
|---|---|---|
| OpenAI Cookbook PR #2874 | Open since 2026-07-21. Checked 2026-10-08: still open and unmerged, review required, 24 comments, no activity since our own comment on 2026-09-14 | Revival steps are in [openai-listing-channels.md](../openai-listing-channels.md) |
| Dedicated three.ws page on the IBM domain | Promised 2026-06-18, not live | **Do not link it or describe it as public until IBM ships it** |
| IBM co-promotion on X | Promised 2026-06-18, no recorded delivery | Reopen alongside the Agent Connect conversation |

### Written and never posted

Four finished artefacts are sitting in the repo. Publishing is self-serve on the partner's
own domain, which is the channel with our best track record.

| Artefact | Venue | Owner |
|---|---|---|
| [nvidia-forum-browser-digital-human.md](../nvidia-forum-browser-digital-human.md) | NVIDIA Developer Forums, NIM > Models | [Posted 2026-09-22](https://forums.developer.nvidia.com/t/a-digital-human-in-a-browser-tab-streaming-audio2face-3d-onto-whatever-rig-the-visitor-brought/383953) |
| [nvidia-forum-gpu-fleet-post.md](../nvidia-forum-gpu-fleet-post.md) | NVIDIA Developer Forums | Owner posts |
| [nvidia-forum-model-retirement-post.md](../nvidia-forum-model-retirement-post.md) | NVIDIA Developer Forums, NIM > Models | [Posted 2026-09-21](https://forums.developer.nvidia.com/t/nvidia-nim-model-retirements-what-a-410-gone-does-to-a-fallback-chain-and-how-we-survive-it-now/383950) |
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
| Microsoft Azure Marketplace | Third leg of the enterprise procurement story after AWS and Alibaba. Checked 2026-10-08: [Microsoft for Startups](https://www.microsoft.com/en-us/startups) is still open (up to USD 150,000 in Azure credits plus customer-network access) and is the entry route | Sequencing decision. Do not start before the AWS listing exists |
| LobeHub chat plugin index | `public/.well-known/lobehub-plugin.json` (identifier `3d-agent`) is shipped, dated 2026-04-17. Checked 2026-10-08: the [plugin index](https://chat-plugins.lobehub.com/index.json) still holds 40 plugins and none is three.ws. Our MCP servers are already listed separately | A decision: submit the plugin to the LobeHub plugin index, or retire the manifest in favour of the MCP listings that already exist |
| PostHog for Startups | PostHog is the production analytics stack (`src/analytics.js`). Checked 2026-10-08: still open, USD 50,000 in credits for 12 months plus a startup spotlight | Apply from the production org; confirm the age and funding rules on the form |
| OpenAI Codex for Open Source | A new program inside an existing partner: six months of ChatGPT Pro with Codex and up to USD 25,000 in API credits for maintainers of widely used public projects. Checked 2026-10-08: open, reviewed on a rolling basis | Submit the maintainer application |
| Cerebras startup deal | Cerebras is a live free-tier rung in the LLM chain and the deal includes co-marketing. Checked 2026-09-18: the public non-YC page returns 404 | Ask Cerebras whether the non-YC deal still exists |
| Deepgram Startup Program | Up to USD 100,000 in speech credits and customer stories. Not in the stack: `/api/asr` runs on NVIDIA Riva | A decision to add a second ASR rung, which onboards a new external API |
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
| Nebius, Scaleway (Inception track), Alibaba Startup Catalyst, Mistral Ambassador, xAI data-sharing credits | Checked 2026-09-18 in the CloudCredits sweep: Nebius credits flow only through VC partners and exclude crypto-only businesses; Scaleway's Inception track requires an EU-based startup; the Alibaba and Mistral program pages return 404; xAI pays for sharing request data that carries user prompts. Details in the [growth register](../../marketing/growth/opportunities.md#checked-and-ruled-out) |
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
