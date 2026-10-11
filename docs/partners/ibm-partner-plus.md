# IBM Partner Plus: what we are entitled to and are not using

three.ws is already an **IBM Business Partner**. This doc is the audit of what that
membership actually gives us, written against our verified position rather than against
the program brochure. It exists because the Partner Plus newsletter arrives monthly, most
of it is aimed at hardware resellers, and the two or three items that genuinely apply to us
keep getting lost in the noise.

Companion docs: [IBM watsonx and Granite](../ibm.md) is the technical integration and the
partnership record, [IBM Granite x402 MCP](../ibm-x402-mcp.md) is the pay-per-call path,
[Partner ecosystem](../partners.md) is the public partner map, and
[the second community event](../ibm-next-event.md) is the event proposal awaiting a date.

---

## The framing rules come first

Everything below inherits the rules set in [`docs/ibm.md`](../ibm.md), and none of them may
be softened to make a listing or a campaign read better:

- three.ws is an IBM Business Partner. That is a designation, **not an endorsement**.
- The public showcase under `/api/ibm/*` is an independent set of developer tools built on
  IBM's publicly available Granite models. It is **not** an IBM product, **not** an
  official partnership deliverable, and must never be presented as the partnership work.
- The formal partnership work lives on the IBM platform and is not public yet.
- The `@three-ws/ibm-watsonx-mcp` connector is community-built. IBM does not operate or
  endorse it.

Any catalog listing, press line, or co-marketing asset that comes out of this doc carries
those constraints into its copy.

---

## Where we actually stand

Verified on 2026-09-09 against the live site and the repo:

| Asset | State | Evidence |
|---|---|---|
| IBM Business Partner status | Active | [`docs/ibm.md`](../ibm.md), `/partners` IBM card (Strategic chip) |
| Granite on watsonx.ai in the product | Live | [`docs/ibm.md`](../ibm.md) |
| Partnership page | Live | `three.ws/ibm/hello` |
| x402 demo | Live | `three.ws/ibm/x402-demo` |
| Free keyless MCP server | Live | `three.ws/api/mcp-studio` |
| Paid MCP server (OAuth 2.1 or x402 per call) | Live | `three.ws/api/mcp-3d`, protocol `2025-06-18` |
| A2A agent card, 10 declared skills | Live, HTTP 200 | `three.ws/.well-known/agent-card.json` |
| x402 paid-service catalog | Live, HTTP 200 | `three.ws/.well-known/x402.json` |
| OAuth metadata with static client auth | Live | `three.ws/.well-known/oauth-authorization-server` |
| IBM user group on IBM Community | Active, moderated by us | [`docs/ibm-community.md`](../ibm-community.md) |
| In-world community meetup | Held | [`docs/ibm-community-blog-meetup-jessica.md`](../ibm-community-blog-meetup-jessica.md) |
| CSP allows framing from IBM and Seismic | Live | `frame-ancestors 'self' https://ibm.com https://*.ibm.com https://*.seismic.com` |

That last row matters more than it looks. The newsletter's footer points partners at the
Partner News and Enablement Hub on Seismic, and our production CSP already permits
`*.seismic.com` and `*.ibm.com` to frame three.ws. The technical hook for embedding our
product inside IBM's own partner surfaces is already shipped.

We sit in the Partner Plus **Build track**, which IBM defines as partners who embed or
integrate IBM software into their commercial solutions **or publish AI agents in the
watsonx Orchestrate catalog**. We qualify on the first clause today and are unusually well
positioned on the second.

---

## The headline opportunity: Agent Connect

**IBM Agent Connect** lists partner agents and MCP servers in the **watsonx Orchestrate
Agent Catalog**. IBM describes it as a route to market backed by its own sales channels and
partner network, with agents accepted from any framework.

This is the one item in the whole program where our existing engineering is the
qualification. We are not being asked to build something new to get in.

### Two listing paths, and why BYOL is the right first move

| | Paid listing | **BYOL listing (recommended)** |
|---|---|---|
| Who bills the customer | IBM | We do, through our existing rails |
| Tax docs (W-9 / W-8), banking, payout setup | Required | Not required |
| Approval | 5 to 7 business days, plus up to 3 weeks to appear | "Bypasses several approval steps... publish immediately after configuration" |
| Extra prerequisite | None | "Your own license validation and management system" |

The BYOL extra prerequisite is the one we already satisfy and most applicants do not: our
per-call x402 settlement, OAuth scopes, and access keys **are** a license validation and
management system, running in production today. The paid path's blockers are all
owner-level business administration (legal entity documents, banking for IBM payouts), not
engineering. So BYOL first, paid listing later if the volume justifies the paperwork.

### Prerequisite check against what we have

| IBM requirement | Our position |
|---|---|
| Functioning Remote MCP server endpoint | Have it: `three.ws/api/mcp-3d`, live, MCP protocol `2025-06-18` |
| Supported auth (OAuth2 without Dynamic Client Registration, API key, bearer, basic, key-value) | **Satisfied with no code change.** Our OAuth advertises a `registration_endpoint`, but it also supports `client_secret_basic` and `client_secret_post`, so IBM gets a pre-registered static client and never touches DCR |
| Test credentials that stay valid through onboarding | We can mint these; they must be tracked so they are not rotated mid-review |
| Setup documentation plus at least one use case | Have it: [`docs/mcp-3d-studio.md`](../mcp-3d-studio.md), [`docs/mcp-studio.md`](../mcp-studio.md) |
| Listing icon | **Built and verified.** IBM requires SVG only, transparent background, under 200 KB, legible at 48x48. A PNG fails validation. Shipped at `public/partners/ibm/three-ws-agent-connect-icon.svg` |
| `APP_ID` from the IBM Ecosystem team | **The only true blocker.** Obtained by emailing `IBMAgentConnect@ibm.com` |
| IBM Cloud account, Concierge access | Owner action |

Note that IBM currently builds the MCP server wiring for partners by hand and calls
self-service "coming soon", quoting 3 to 5 business days for setup. Treat their timeline as
the long pole, not ours.

---

## The newsletter, triaged

The September 2026 Partner Plus mailer, item by item:

| Item | Verdict | Why |
|---|---|---|
| 6% extra on Power, Flash, Fusion, Scale deals | **Ignore** | Resale margin on IBM hardware for competitive takeouts. We are a Build partner, not a reseller. Nothing here is reachable. |
| IBM Bob marketing assets in My Digital Marketing | **Pursue** | This is the co-marketing platform benefit. See below. |
| G2 review for a $25 gift card | **Do, and it is honest** | Only honest once Granite is actually serving again: checked 2026-09-16, production has no `WATSONX_*` credentials and `/api/ibm/galaxy` answers `watsonx_not_configured`. Draft in [ibm-g2-review.md](../../marketing/partner-packets/ibm-g2-review.md). Cheap, and partner reviews are visible to the IBM ecosystem team we already have a relationship with. |
| Partner Day AI experience | **Relationship value only** | Sales enablement, not technical. Worth attending only if the marketing contacts from the June meetings will be there. |
| IBM Software Quoting session | **Ignore** | A quoting tool for resellers. |
| Partner Growth Day with Confluent | **Ignore** | Kafka data streaming, framed for partner sales. We are on GCP credits; Pub/Sub and the existing Cloud Scheduler crons cover our volume, and Confluent Cloud would be a new paid third-party API requiring owner approval. |

### October 2026 ("Partnering for success", received 2026-10-07)

This issue is the most relevant one yet: two of its three events are about exactly the
two things a Build track partner wants, Marketplace distribution and agent-ready
integrations, and its IBM Bob item turned out to be a client we could support the same day.

| Item | Verdict | What we did or will do |
|---|---|---|
| Year-end incentives across Infrastructure and Software, deals closed by 31 December | **Ignore** | Resale incentives on eligible IBM deals. We do not resell IBM software or hardware, so there is no eligible deal to close. |
| Boomerang (share IBM content through a partner-branded experience) | **Ignore for now** | Built for partners who generate pipeline for IBM products. Our audience comes to us for three.ws, not for IBM content, and a partner-branded IBM reading room would dilute the no-endorsement framing above. Revisit only if an Agent Connect listing gives us an IBM product to point prospects at. |
| Download your partner certificate from the Partner Portal | **Do (owner, 2 minutes)** | It is the proof document for bids, marketplace applications, and "are you really an IBM Business Partner" questions. Download it once and keep it with the owner's business records, **not in this repo** (it carries the partner ID) and not on the public site. When a listing form asks for proof, attach it from there. |
| My Digital Marketing: Affinity Plays (sell IBM into AWS, Microsoft, Veeam accounts) | **Ignore** | Cross-sell kits for resellers. |
| My Digital Marketing: Webinar Playbook | **Pull it** | Directly useful for the second community event in [ibm-next-event.md](../ibm-next-event.md) and the in-world session kits under `marketing/growth/events/`. Read it against our format (an hour inside `/play`, not a slide webinar) and keep what applies, chiefly the promotion timeline and the follow-up sequence. |
| My Digital Marketing: IBM Photography (100+ persona-based images) | **Use only inside IBM co-marketing** | Licensed for IBM partner campaigns. Fine on an IBM Community post or a co-branded asset in `marketing/ibm-partner-plus/`; never as general three.ws site imagery, where it would imply an IBM endorsement we may not claim. |
| My Digital Marketing: Confluent Kafka migration kits | **Ignore** | Same reasoning as September's Confluent track. |
| IBM Bob self-hosted option | **Shipped on our side** | Bob is IBM's AI development partner, and it reads remote MCP servers from `.bob/mcp.json`. We added it as a first-class client on the same day: an **IBM Bob** tab on [three.ws/connect](/connect) that writes the entry for whichever server you pick, `npx three-ws setup --clients bob` in the [CLI](../cli.md), and an `ibm-bob` block in `/.well-known/mcp.json` recommending the free, no-sign-in 3D Studio server. The self-hosted angle matters for IBM's sensitive-workload customers: our free server needs no account and no key, so a locked-down Bob install can use it without handing us credentials. Untested against a live Bob install; the config follows IBM's published format. |
| Chatter reminders for partner-owned opportunities inactive 45+ days | **Ignore** | CRM hygiene for registered deals. We have none registered. |
| Customer story (GlassHouse Systems, IBM i on Power Virtual Server) | **Ignore** | Not our market. |
| **Partner Growth Day: Accelerate through Marketplace**, Tue 20 October, virtual | **Attend (owner)** | The Marketplace route is where Agent Connect lives. Go with a concrete ask: the BYOL listing for the 3D Studio MCP server, the submission pack already filled in at [agent-connect-listing.md](../../marketing/ibm-partner-plus/agent-connect-listing.md). The `APP_ID` request to `IBMAgentConnect@ibm.com` should go out **before** the 20th so the session can be used to chase it rather than start it. |
| **Making your existing integrations agent-ready**, Tue 3 November, virtual | **Attend (owner), highest value of the issue** | This is our thesis as an IBM session title. We already run eight hosted MCP servers, an A2A agent card, x402 pay-per-call, and now IBM Bob support. Attend to learn what IBM means by "agent-ready" for Orchestrate, and bring the three questions below. |
| **Cross brand partner marketing enablement**, Thu 5 November, virtual | **Attend (owner)** | The co-marketing ramp agreed in June (see "Stalled since June" below) has had no recorded delivery. This is the room to restart it, with [marketing/ibm-partner-plus/](../../marketing/ibm-partner-plus/README.md) as the ready kit. |
| Partner News and Enablement Hub on Seismic | **Already wired** | Our CSP already permits `*.seismic.com` to frame three.ws (see "Where we actually stand"). |

**Three questions to take to the 3 November session.** Each one is something we cannot
answer from IBM's public docs, and each answer changes what we build next:

1. Does watsonx Orchestrate's remote MCP import support OAuth 2.1 with protected-resource
   discovery, or only the static-credential modes listed for Agent Connect? Our main
   server (`/api/mcp`) speaks both; the answer decides which one we list.
2. What does Orchestrate do with MCP tool annotations (`readOnlyHint`,
   `destructiveHint`)? Every three.ws tool declares them, and an enterprise buyer's first
   question is which tools can act without a human.
3. Is there a path for a listed MCP server to be offered inside IBM Bob as well as
   Orchestrate, or are they separate catalogs?

**Blocking everything IBM-facing in this issue: Granite is still dark in production.**
Re-checked 2026-10-09: `/api/ibm/galaxy` answers `watsonx_not_configured`,
`/api/guardian/assess` answers `guardian_unconfigured`, and neither the Cloud Run service
nor the local env files carry a `WATSONX_*` or `GRANITE_GUARDIAN_*` variable. Walking into
an "agent-ready" session as an IBM partner whose IBM-model endpoints are switched off is
the weakest position available. Two ways out, either one sufficient:

- **Owner:** provide a watsonx.ai API key and project ID (IBM Cloud, the company account),
  set as `WATSONX_API_KEY` and `WATSONX_PROJECT_ID` on the Cloud Run service. That
  restores every Granite surface at once.
- **Engineering, needs a deploy approval:** deploy the self-hosted Guardian worker in
  `workers/granite-guardian/` on GCP credits and set `GRANITE_GUARDIAN_URL`. That restores
  governance (`/api/guardian/assess`, `@three-ws/guardian`) without an IBM Cloud account,
  but not the other Granite surfaces.

---

## My Digital Marketing: the co-marketing benefit we are not using

IBM's My Digital Marketing is the Partner Plus marketing automation platform. For Build
partners it carries 1:1 concierge marketing support, ready-to-execute Partner Marketing
Kits, and co-marketing resources for demand generation. IBM's 2026 program updates expanded
co-marketing funding, and tier advancement unlocks progressively more of it.

We have campaign kits for other programs and none for IBM:

```
marketing/openai-select-partner/   README, badge-usage, press release, social copy, cards
marketing/nvidia-inception/        README, social copy
marketing/quicknode/               finished graphics
(no marketing/ibm-partner-plus/)
```

That gap is the reason IBM co-marketing keeps being improvised per event. The fix is a kit
built to the same shape as the OpenAI one, carrying the badge rules and the
no-endorsement language from [`docs/ibm.md`](../ibm.md) so nobody has to rediscover the
constraints under deadline.

---

## Stalled since June, worth restarting in the same conversation

[`docs/ibm.md`](../ibm.md) records a co-marketing ramp-up agreed on 2026-06-18 after
meetings with IBM's development and marketing sides. Three things were promised. As of the
last update to that doc, the status is:

1. **More co-promotion on X from IBM.** No recorded delivery.
2. **A dedicated three.ws page on the IBM domain.** Recorded as not yet live. The doc's
   instruction stands: do not link to it or present it as public until IBM ships it.
3. **A second live IBM Community event.** The proposal is written and costed in
   [`ibm-next-event.md`](../ibm-next-event.md), recommending a one-week open creation
   contest closing with a crowning ceremony inside the three.ws world. It has been waiting
   on one decision since it was written: **a date**. That is the cheapest unblock on this
   entire page.

An Agent Connect conversation is the natural moment to reopen all three, because it gives
IBM's ecosystem team something new to co-market.

---

## Actions

**Owner (external contact and business administration, gated):**

1. Email `IBMAgentConnect@ibm.com`, subject `MCP APP_ID Request - three.ws`, to request the
   `APP_ID` for a **BYOL** MCP server listing. This is the single unblock for the catalog.
2. Confirm IBM Cloud account and Concierge access for the company entity.
3. Pick a date for the second community event so
   [`ibm-next-event.md`](../ibm-next-event.md) can leave the shelf.
4. Request My Digital Marketing access and the Build track Partner Marketing Kit.
5. Decide whether the paid listing is worth the tax and banking paperwork later. It is not
   needed for the first listing.

Added from the October 2026 mailer (see its triage above), in date order:

6. **Before Tue 20 October:** send item 1 if it has not gone out, then attend Partner
   Growth Day: Accelerate through Marketplace with the BYOL listing as the ask.
7. **Tue 3 November:** attend "Making your existing integrations agent-ready" with the
   three questions above.
8. **Thu 5 November:** attend cross brand partner marketing enablement and restart the
   June co-marketing ramp.
9. Download the partner certificate from the Partner Portal and file it with the business
   records (not in this repo).
10. Pull the Webinar Playbook from My Digital Marketing for the second community event.
11. Unblock Granite in production: either provide `WATSONX_API_KEY` and
    `WATSONX_PROJECT_ID`, or approve deploying `workers/granite-guardian/`.

**Engineering (unblocked, no external dependency):**

Done on 2026-09-10, all of it in [`marketing/ibm-partner-plus/`](../../marketing/ibm-partner-plus/README.md):

1. The kit itself, built to the shape of `marketing/openai-select-partner/`, with the
   no-endorsement rules carried over.
2. The catalog icon, `public/partners/ibm/three-ws-agent-connect-icon.svg`. IBM's spec is
   SVG with a transparent background, so the shipped 3D Studio mark could not be reused
   as-is: its dark rounded background plate is the exact thing the guidelines reject.
3. The full submission pack in
   [`agent-connect-listing.md`](../../marketing/ibm-partner-plus/agent-connect-listing.md):
   every Concierge field, the required use case, and the verified support, EULA, and
   documentation URLs.
4. The QA credential requirements, including the rotation trap that would silently fail
   IBM's connection test during the 3-week release window.

Held until the listing is live: the announcement copy in
[`social-copy.md`](../../marketing/ibm-partner-plus/social-copy.md).

Done on 2026-10-09: IBM Bob is a supported client on [/connect](/connect), in
`npx three-ws setup --clients bob`, and in `/.well-known/mcp.json` (`ibm-bob`).

**Explicitly not doing:** the infrastructure resale incentive, IBM Software Quoting, and
the Confluent track. None of them are reachable from a Build track partner and none of them
touch our product.

---

## Sources

- [IBM Partner Plus](https://www.ibm.com/partnerplus/)
- [IBM watsonx Orchestrate Agent Catalog](https://www.ibm.com/products/watsonx-orchestrate/agent-catalog)
- [IBM Agent Connect](https://www.ibm.com/products/watsonx-orchestrate/agent-connect)
- [Agent Connect: get started](https://connect.watson-orchestrate.ibm.com/agent-connect/get-started)
- [Agent Connect: MCP server BYOL listing](https://connect.watson-orchestrate.ibm.com/agent/mcp-server-byol)
- [Agent Connect: MCP server paid listing](https://connect.watson-orchestrate.ibm.com/agent/mcp-server)
- [Partner agents in watsonx Orchestrate](https://www.ibm.com/docs/en/watsonx/watson-orchestrate/base?topic=catalog-partner-agents)
- [Introduction to IBM's Agent Connect Partner Program](https://community.ibm.com/community/user/blogs/samina-hossain/2025/05/29/introduction-to-ibms-agent-connect-partner-program)
