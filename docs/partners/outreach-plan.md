# Partnership outreach plan

*Written 2026-10-09 to work the [partner prospects list](./prospects.md). The prospects page
says who; this page says in what order, with what message, and who does each step. The
engineering behind each wave is a set of work orders in the `partners-` campaign
([shared context](../../prompts/finish/_context/partners-00-CONTEXT.md)), so the build can run
in parallel with the conversations.*

## The approach in one paragraph

Lead with what already runs. Almost every strong prospect on the list is something three.ws
already uses, renders, retargets or serves, so the first message is never "we would like to
partner". It is "your work already powers this, here are the numbers, here is what we can do
together". Where we depend on someone's open source and have never given back, the first move
is a contribution or a credit, not a request. Every number quoted comes from the
[30-day proof brief](./proof-brief-2026-10.md), quoted the way it says to.

## The engagement ladder

Every relationship climbs the same rungs. Do not skip one: a commercial ask to a project we
have never credited reads as extraction.

| Rung | What it means | Example |
|---|---|---|
| 1. Use | We run their work in production | TripoSG in the Forge, three-vrm in the avatar stack |
| 2. Credit | A visitor can see that we do | The open-source credits page (order 086), engine attribution in the Forge |
| 3. Contribute | We send fixes, samples or money upstream | A three-vrm pull request, a GitHub Sponsors tier |
| 4. List | We appear in their directory, registry or docs | The LiveKit avatar page, ClawHub, the HACS default store |
| 5. Co-market | A joint post, a case study, a showcase slot | A Tripo launch post when the house lane ships |
| 6. Commercial | Credits, partner pricing, revenue share, a grant | Tripo deal shapes A to C |

## Waves

Each wave starts when the one before it has begun, not when it has finished. Target dates
assume the owner can spend about two hours a week on outreach.

### Wave 0: Tripo (this week)

| Step | Who | Detail |
|---|---|---|
| Reply to Tripo with the draft in [tripo.md](./tripo.md) | Owner | Copy `business@tripo3d.ai` if the first contact did not come from there |
| Build the v3 house lane behind `TRIPO_API_KEY`, BYOK unchanged | Agent, order 084 | Runnable now; nothing in it waits on the deal |
| First call, using the six questions in the brief | Owner | Start at deal shape A, the 60-day credits pilot |
| Approve the house key once terms are agreed | Owner, order 936 | A platform-paid key onboards a paid API, so it is the owner's call |

**Done when:** a signed pilot, the key on the Cloud Run service, and Tripo running as a house
lane in the Forge with its completion and latency numbers reported back to Tripo from `forge_creations`.

### Wave 1: fix before we pitch, then free listings (weeks 1 and 2)

The cheapest credibility there is, and a precondition for Waves 2 and 3.

| Step | Who | Order |
|---|---|---|
| Move the public animation library off Mixamo clips | Agent | 085 |
| Ship the open-source credits page and in-surface credits (Poly Haven on /objects, engine names in the Forge) | Agent | 086 |
| Build the tool packages and registry entries for the agent tools (AI SDK, LangChain, ADK page, skills index, OpenRouter attribution, Postman collection) | Agent | 093 |
| Open the pull requests and submit the forms for the agent registries | Owner | 938 |
| Start the sponsorships the owner approves | Owner | 937 |
| Re-tag the Sketchfab models uploaded before 2026-10-09 | Owner | 940 |

**Done when:** no "fix before we pitch" item on the prospects page is still open, and the
first ten registry entries are live.

### Wave 2: build to pitch (weeks 2 to 6)

Each of these is a working integration first and a conversation second. A partner says yes to
a demo far more often than to a proposal.

| Integration | Who builds | Who opens the door |
|---|---|---|
| LiveKit avatar plugin and Pipecat service | Agent, order 087 | Owner: plugin pull request and LiveKit Startups application (938, 939) |
| Discord Activity | Agent, order 088 | Owner: app verification and Discovery (939) |
| "Get it printed" through Craftcloud, plus slicer trusted-host patches | Agent, order 089 | Owner: Craftcloud account, Bambu and Prusa pull requests (938, 939) |
| Mocap migration landing for stranded mocap users | Agent, order 090 | Owner: announce it (938) |
| Shopify product-media app | Agent, order 091 | Owner: Partner account and App Store submission (939) |
| VRoid Hub import | Agent, order 092 | Owner: VRoid Hub app approval (939) |
| WordPress, Framer and Webflow embeds | Agent, order 094 | Owner: directory submissions (938) |
| Home Assistant HACS package | Agent, order 095 | Owner: the HACS default pull request and its CI exception (938) |

Engine bridges (Unity, Unreal, Godot) and store publishing (Fab, Unity Asset Store, itch) are
already planned in best3d orders [072](../../prompts/finish/072-best3d-06-engine-bridges.md) and
[935](../../prompts/finish/935-best3d-08-engine-store-publishing.md). The orphaned avatar
campaign is [934](../../prompts/finish/934-best3d-07-orphaned-avatar-campaign.md), with the
three-vrm work and VRM 0.x export in [075](../../prompts/finish/075-best3d-09-three-vrm.md).
This plan does not duplicate them.

### Wave 3: commercial partners (weeks 4 to 10)

Once Wave 2 has something live to show, approach the companies whose products we would put
inside ours on commercial terms.

| Prospect | The ask | Owner action |
|---|---|---|
| Meshy | Platform pricing for a house lane, on the Tripo pattern | Partner form |
| ElevenLabs | The startup grant (pipeline row), then the Commercial Partner Program | Two forms |
| Composio | Toolkit partnership: they build and list the three.ws toolkit | One form |
| Avaturn | Case study and a "works with" badge for users who lost their old avatar provider | Contact form |
| Uthana, Rokoko | Licensed motion data, an integrations listing | Email and form |
| Microsoft | Certified MCP server in Copilot Studio and Microsoft 365 Copilot | Partner Center enrollment; the legacy route closes 2026-10-31 |
| Hitem3D, Rodin, Hunyuan3D | API access and credits for the print-quality and premium lanes | Email |

Any new paid API, even one on credits, is an owner decision before it is wired.

### Wave 4: standards and memberships (quarter)

| Body | The step | Cost |
|---|---|---|
| Khronos Group | Associate membership and 3D Commerce viewer certification for `<agent-3d>` | USD 4,000 minimum a year |
| VRM Consortium | Supporting membership and a listing as a VRM-compatible service | Ask `vrmc-pr@vrm-consortium.org` |
| Blender Development Fund | Bronze corporate membership | EUR 6,000 a year |

## Message templates

Fill every bracket from a verified source. Never send a number the proof brief does not
support, and never claim a relationship that does not exist yet.

### 1. A company whose API or model we already run

> Subject: three.ws runs [product] in production
>
> Hi [name], I run three.ws, an open platform where makers and AI agents create, rig and
> publish 3D. [Product] already powers [surface] for us: [one sentence on how, with the file
> or page a reader can open].
>
> Last month the Forge took [audited number] generation and rigging requests from real makers,
> and agents called our MCP tools [number] times from clients including ChatGPT, Claude and
> Cursor. We would like [the specific ask], and in return we can offer [the specific offer].
>
> Would a 20-minute call next week work? Happy to show it live.

### 2. An open-source project we depend on

Lead with the contribution, not the request. Open the pull request or the sponsorship first,
then post once:

> We build three.ws on [project], which powers [surface]. We just [sent PR #n / started
> sponsoring] and added [project] to our [credits page]. If a showcase or case study would be
> useful to you, we would be glad to write one, and if not, thank you for the work.

### 3. A platform listing or directory

Most of these need no message: follow the intake route on the prospects page exactly, and
put the pull request description or the form answers in the order that prepared them.

### 4. Replying to an inbound approach

Answer within one business day. Show them where their work already appears in three.ws, name
one concrete first step, and propose a call. The [Tripo reply draft](./tripo.md#reply-draft)
is the model.

## Cadence and follow-up

- **Day 0:** the first message, from the owner's own address.
- **Day 5:** one short follow-up adding something new (a demo link, a merged pull request, a
  number).
- **Day 12:** a last note saying the door stays open. Then mark the row `no_reply` in the
  tracker and move on.
- An inbound always beats the plan: drop the current wave for a day to answer it.

## Tracking

- **One row per relationship** in
  [`marketing/growth/opportunities.csv`](../../marketing/growth/opportunities.csv), using its
  existing columns and status words. A prospect moves there when it gets its first action.
- **Re-verify intake routes and numbers** on the day of the first message and update
  `last_verified`.
- **Log every outcome** (sent, replied, call held, declined, signed) in the row's `status` and
  `next_action`, so the [pipeline page](./opportunities.md) stays the single answer to "where
  is this".
- A signed partner gets a card on [the partner page](../partners.md) only once the work is
  live, under that page's framing rules.

## How we measure it

| Measure | Source | Target for the first 60 days |
|---|---|---|
| Live listings and registry entries | The tracker | 20 |
| Partner conversations held | The tracker | 10 |
| Signed partnerships (credits, pricing, grant or co-marketing) | The tracker | 3, Tripo first |
| Generation jobs on partner house lanes | `forge_creations`, grouped by `backend` | Tripo above 10% of High-tier jobs |
| Agent-tool clients | OAuth clients on the MCP servers | From 13 to 25 distinct clients |

## Who does what

| Owner only | Agents |
|---|---|
| Sending any message, reply or email | Building every integration, package and page in orders 084 to 095 |
| Opening any pull request, issue or listing on a third-party site | Preparing the exact pull request text, form answers and screenshots |
| Any spend: sponsorships, memberships, paid keys, boosts | Re-verifying numbers and intake routes before each send |
| Approving a new paid API | Updating the tracker and the pipeline page afterwards |
| Signing anything | Writing the case study or launch post draft |

## Related

- [Partner prospects](./prospects.md): the scored list this plan works.
- [Tripo partnership brief](./tripo.md): Wave 0 in full.
- [Partnership and listing pipeline](./opportunities.md): what is already in flight.
- [30-day proof brief](./proof-brief-2026-10.md): the numbers every message quotes.
- [Partner ecosystem](../partners.md): live partner cards and framing rules.
