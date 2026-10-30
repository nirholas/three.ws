# Co-marketing and partnership opportunity register

This is the human-readable strategy behind [`opportunities.csv`](./opportunities.csv). The
CSV is the status ledger; this page explains why the opportunities are ranked, what three.ws
can offer, and what to ask for.

## How opportunities are scored

Score each route from 1 to 5 on four dimensions:

- **Brand:** how much third-party credibility or relevant reach a win creates.
- **Fit:** how directly the shipping product uses the partner technology or serves its
  audience.
- **Readiness:** whether the proof, copy, integration, and relationship already exist.
- **Access:** how direct the intake route is, where 5 is self-serve or an existing contact.

`priority_score = brand + fit + readiness + access`. Work the highest score first, but a
closing date overrides the score. An opportunity does not enter the register without an
official source, a concrete next action, an owner, and evidence that would prove completion.

## The big-brand engagement ladder

Do not lead with “Can we partner?” Lead with the smallest useful action and earn the next
one.

| Level | Ask                                                    | What we give the brand                                                 | Proof of success                              |
| ----: | ------------------------------------------------------ | ---------------------------------------------------------------------- | --------------------------------------------- |
|     1 | Employee or program account comments on a working demo | A safe, accurate post and a reply-ready summary                        | Public comment URL                            |
|     2 | Program handle reposts or includes it in a roundup     | Approved assets, native copy, and a partner-domain proof link          | Repost or newsletter URL                      |
|     3 | Technical article or community event on its property   | Reproducible implementation, moderation, recording, and recap          | Partner-domain article/event URL              |
|     4 | Directory, catalog, marketplace, or showcase placement | Production integration, support process, screenshots, and metrics      | Live listing URL                              |
|     5 | Joint case study, event series, or formal GTM motion   | Customer outcome, named spokesperson, legal-ready claims, and pipeline | Published case study or signed program motion |

Each successful campaign should ask for only the next level. IBM has already demonstrated
the sequence: official social engagement led into partner content and a dedicated community
group, and the group led into an in-world event.

## Existing relationships: activate what is already earned

| Partner       | Best next placement                                                                    | Exact ask                                                                                                                               | What we offer                                                                        | Source/status                                                                                                                                                                                                                       |
| ------------- | -------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| IBM           | watsonx Orchestrate Agent Catalog and recurring user-group events                      | Issue the BYOL `APP_ID`; confirm event two; restore the promised IBM-domain page and social co-promotion; activate My Digital Marketing | Governed 3D agent demo, existing user group, event world, written listing pack       | [IBM Agent Catalog](https://www.ibm.com/products/watsonx-orchestrate/agent-catalog), [Partner Plus marketing](https://www.ibm.com/partnerplus/marketing), [user-group benefits](https://www.ibm.com/community/user-groups-program/) |
| OpenAI        | Developer Showcase, Plugin Directory, and Partner Locator                              | Publish the prepared submission; make the Select Partner profile discoverable; route a measured story to partner GTM                    | Keyless 3D Studio connector, interactive Three.js output, open-source implementation | [Developer community](https://developers.openai.com/community), [Apps showcase](https://developers.openai.com/showcase/apps), [Partner Network](https://openai.com/business/partners/)                                              |
| NVIDIA        | Developer Forums, Inception Startup Showcase, Accelerated Apps, and GTC startup routes | Complete the Shipping product record; retrieve the restored co-brand kit; ask only about Showcase routing and an ACE contact; keep the demo current for invite-only GTC Pavilion review | Browser-native Audio2Face/Riva demo, GPU fleet story, measured implementation        | [NVIDIA startups](https://www.nvidia.com/en-us/startups/), [GTC](https://www.nvidia.com/gtc/), [existing visibility map](../../docs/nvidia-visibility-map.md)                                                                       |
| AWS           | Marketplace listing followed by reviewed launch amplification                          | Create the product; submit launch copy for AWS review; notify AWS when live and request the stated repost support                       | Production SaaS integration, procurement story, existing Builder Center audience     | [AWS Marketplace marketing guide](https://docs.aws.amazon.com/marketplace/latest/userguide/product-marketing.html), [Partner Central](https://aws.amazon.com/partners/partner-central/)                                             |
| Google Cloud  | AI Agents program, AI agent finder, and Cloud Marketplace                              | Enroll through Partner Network; submit the production Agent Card and Marketplace business case                                          | Production Cloud Run/Vertex workload, public Agent Cards, A2A and MCP support        | [Sell on Cloud Marketplace](https://cloud.google.com/marketplace/sell), [Marketplace requirements](https://docs.cloud.google.com/marketplace/docs/partners/get-started)                                                             |
| Alibaba Cloud | Technical follow-up on the live Marketplace relationship                               | Pitch a measured Qwen/router implementation and APAC workshop rather than another partnership announcement                              | Live listing, Qwen lane, reproducible routing story                                  | [Current listing record](../../docs/listings.md)                                                                                                                                                                                    |
| HackerNoon    | Recurring canonical syndication and a flagship founder story                           | Keep RSS healthy; pitch only the strongest quarterly proof as an editorial package                                                      | Automatic clean feed, original technical reporting, canonical URLs                   | [Syndication runbook](../../docs/syndication.md)                                                                                                                                                                                    |
| QuickNode     | Startup-program spotlight and technical reliability story                              | Ask the program contact for a founder spotlight or co-authored RPC failover post                                                        | Real Solana RPC failover implementation and operational lessons                      | [Partner record](../../docs/partners.md)                                                                                                                                                                                            |

## Installable distribution already built in the repo

These are unusually efficient because the product work exists and the result lives on a
recognized third-party install surface. Treat each listing as its own launch with a native
workflow capture and an activation measure.

### VS Code Marketplace

`packages/vscode-3d` and `packages/vscode-x402` already contain extensions, build scripts,
tests, icons, READMEs, and Marketplace metadata. Resolve the inconsistent publisher IDs,
package and inspect both, then publish the 3D extension first. Its preview, generation,
animation, optimization, and embed workflow has the broadest immediate audience.

**Official source:** [Publishing Extensions](https://code.visualstudio.com/api/working-with-extensions/publishing-extension).

### Comfy Registry and Manager

`integrations/comfyui` contains working Text-to-3D and Image-to-3D nodes plus a real
server-backed smoke test. Add the required `pyproject.toml`, create the publisher and Registry
key, package, and publish. The Registry powers ComfyUI Manager discovery, so the same release
creates both a listing and a native install channel.

**Official source:** [Publishing Nodes](https://docs.comfy.org/registry/publishing).

### Blender Extensions

`integrations/blender` contains a working stdlib-only Forge add-on. Before submission, make
outbound requests honor `bpy.app.online_access`, which Blender requires for networked
extensions. Then add the extension manifest, package, and upload through the official surface.
A listing is distribution, not a Blender partnership.

**Official sources:** [Add-on Guidelines](https://developer.blender.org/docs/handbook/extensions/addon_guidelines/),
[Extension Hosting](https://developer.blender.org/docs/handbook/extensions/hosted/).

### The IBM event series

The IBM Community user-group route is the fastest repeatable partner-owned channel because
three.ws already moderates the group, has held a successful in-world event, and can create
the venue at will. IBM's official user-group program says it can support events with IBM
product experts, content, promotion, and branded giveaways.

Proposed next three events:

| Month             | Event                                        | Partner role                                                                                       | Community artifact                                 |
| ----------------- | -------------------------------------------- | -------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| September/October | **Give an enterprise agent a 3D body, live** | IBM Community host; invite an IBM product expert for governance discussion                         | A rigged avatar and replay clip                    |
| October/November  | **An AI agent pays for its own tool**        | IBM remains the confirmed venue; invite the relevant payments ecosystem team only after acceptance | Public x402 receipt and $THREE utility walkthrough |
| November/December | **Browser-native digital humans**            | IBM venue; invite NVIDIA and ElevenLabs as speakers, not co-hosts, until approved                  | A live speaking avatar and technical recap         |

Each event ends with one partner escalation: event one asks for the IBM Agent Catalog
listing, event two asks for a partner-authored recap, event three asks for a multi-company
technical session at a larger event.

## New relationships with unusually strong fit

### 1. Coinbase Developer Platform Founders Fuel

**Why it fits.** The repository has a production Coinbase Developer Platform x402
facilitator integration, Bazaar discovery, an official SDK dependency, live endpoints, and a
large evidence base around agent payments. Founders Fuel explicitly accepts working products
integrating x402 and offers a Launch Spotlight, social amplification, Builder Showcase
placement, GTM support, and partner introductions.

**Ask.** Apply with the x402 agent-economy proof, a live product link, and a 90-day launch
plan centered on agents discovering and purchasing 3D work. Do not pitch $THREE price or a
generic platform; pitch a specific CDP integration with measurable settlement volume.

**Official source:** [CDP Founders Fuel](https://www.coinbase.com/developer-platform/discover/launches/founders-fuel).

### 2. ElevenLabs Startup Grants and Demo Day

**Why it fits.** ElevenLabs voice synthesis and cloning are integrated in the live agent
product. The grant program is designed for monetized, long-term voice products at companies
with fewer than 25 employees, offers 12 months of product access and founder programming,
and feeds the ElevenLabs Demo Day. Demo Day winners receive an invitation to present at the
ElevenLabs Summit, creating exactly the brand-owned event and social loop sought here.

**Ask.** If three.ws meets the employee-count and account-status eligibility rules, apply
with the “voice becomes a face and body” demo. Request Demo Day consideration after the
grant is accepted. The application is rolling; do not claim participation before acceptance.

**Official sources:** [Startup Grants](https://elevenlabs.io/startup-grants),
[Demo Day](https://demoday.elevenlabs.io/).

### 3. Google Cloud AI Agents program and agent finder

**Why it fits.** Google now publishes a specific Marketplace path for agent builders,
including an AI Agents program, A2A and Gemini Enterprise validations, Agent Cards, and an AI
agent finder. three.ws already runs in Google Cloud production, ships public Agent Cards,
and supports A2A. This is a substantially stronger fit than a generic SaaS Marketplace
application.

**Ask.** Enroll in the Google Cloud Partner Network, apply for the AI Agents program, and ask
the assigned partner manager to route three.ws into the agent finder and Gemini Enterprise
validation path. Use production Agent Card and A2A evidence in the first message.

**Official source:** [Google Cloud Marketplace for agent builders](https://cloud.google.com/marketplace/sell).

### 4. GitHub open-source programs

**Why it fits.** Open Source Friday is already approved. The next relationship is not a cold
application; it is a strong episode that generates a real merged contribution. GitHub Stars
is an individual recognition path for people who educate and grow developer communities,
which becomes credible after repeated public contributor onboarding.

**Ask.** Book the Open Source Friday date now, co-produce the episode assets, and make the
on-air PR the result. After the episode and two additional community workshops, assemble a
GitHub Stars nomination around open-source education, not company promotion.

**Official sources:** [approved issue #254](https://github.com/githubevents/open-source-friday/issues/254),
[GitHub Stars](https://stars.github.com/).

### 5. Hugging Face Space and community feature

**Why it fits.** The organization already has published models, two community articles, and
a working Space. Hugging Face invites innovative Spaces to apply for a community GPU grant
from the Space settings page. A stronger Space creates a visual destination Hugging Face can
feature and every partner can link.

**Ask.** Upgrade the existing Space into a prompt-to-rig-to-view demo or a focused rig
inspector, apply for the community GPU grant if compute is required, and publish the finished
feedback-loop article alongside it.

**Official source:** [Hugging Face Spaces overview](https://huggingface.co/docs/hub/spaces-overview).

### 6. Solana ecosystem directory and Foundation public-good funding

**Why it fits.** Solana is the home chain, the project is Apache-2.0, and the repo includes
free developer tools and public infrastructure. The Foundation evaluates rolling grant
applications on public-good value, open source, why the work is only possible on Solana, and
clear milestones. The ecosystem directory offers another partner-owned discovery surface.

**Ask.** First verify whether three.ws is already in the current ecosystem directory. If
absent, submit the product with current screenshots. Separately scope a grant around a narrow
public good, such as open agent identity/payment/3D tooling, not general company marketing.

**Official sources:** [Foundation grants](https://solana.org/grants-funding),
[ecosystem directory process](https://solana.com/news/new-solana-ecosystem-directory).

## From the CloudCredits sweep (2026-09-18)

All 187 programs in the [CloudCredits](https://cloudcredits.io/) sitemap were checked against
two questions, in the order the [CloudCredits filter](./github-growth-surfaces.md#use-cloudcredits-as-a-filter-not-a-shopping-list)
sets: does the shipping product already use the vendor, and does the program offer
distribution or co-marketing on top of credits? Every row below was then re-checked on the
vendor's own page on 2026-09-18, because the directory lags: it still lists ElevenLabs as a
three-month grant (the official page now says 12 months) and still links two program pages
that return 404.

### Passes the filter

| Program | Stack fit, from the code | What it gives beyond credits | Gate before applying |
| --- | --- | --- | --- |
| [PostHog for Startups](https://posthog.com/startups) | Production analytics: `src/analytics.js` is the PostHog identity and event taxonomy | $50,000 in credits for 12 months, about $12,000 in partner benefits, and a **startup spotlight** | Apply at `app.posthog.com/startups` from the production PostHog org. The official page no longer states age or funding caps (the directory still quotes under 2 years and under $5M raised); confirm on the application form |
| [Codex for Open Source](https://developers.openai.com/community/codex-for-oss) | The platform is public on GitHub (194 stars, 44 forks on 2026-09-18) with npm packages in monthly use (`@three-ws/avatar` 711 downloads, `@three-ws/avatar-mcp` 557, last 30 days). OpenAI models are a live lane via `@ai-sdk/openai` | Six months of ChatGPT Pro with Codex, conditional Codex Security access, and up to $25,000 in API credits from the Codex Open Source Fund. It deepens the existing OpenAI Select Partner relationship | Aimed at "core maintainers and operators of widely-used public projects", judged on merit with no stated threshold. The form at `openai.com/form/codex-for-oss/` blocks automated reads, so its questions are unverified |
| [Microsoft for Startups](https://www.microsoft.com/en-us/startups) | No Azure credits recorded. The Microsoft partnership and the Microsoft Marketplace listing went live in 2026-10 ([microsoft.md](../../docs/microsoft.md)) | Up to $150,000 in Azure credits and "access to the Microsoft network of customers", now on top of an existing Microsoft relationship | Owner application. The old "wait for AWS first" sequencing rule is retired: the Microsoft listing already exists |
| Cerebras startup deal | Free-tier Llama rung in the LLM failover chain (`api/_lib/llm.js`, active when `CEREBRAS_API_KEY` is set) | Up to $22,500 in inference credits with priority support and **co-marketing** | The public `cerebras.ai/startup-deal` page returned 404 on 2026-09-18; only the [YC variant](https://www.cerebras.ai/yc-startup-deal) is live. Ask `info@cerebras.ai` whether the non-YC deal still exists before preparing anything |
| [Deepgram Startup Program](https://deepgram.com/startup-program) | Not in the stack. `/api/asr` runs on NVIDIA Riva with no paid backstop by design | Up to $100,000 in credits for 12 months, a founder community, and "powered by Deepgram" customer stories | **Owner decision first.** Joining means onboarding a new external speech API as a second ASR rung, which needs approval. If approved, the rung and the application ship together; if not, record the no-go |

### Credit-only: file when cost relief matters, never for reach

These fit the stack but offer no distribution, so they never outrank a row above.

- [Cloudflare for Startups](https://www.cloudflare.com/forstartups/): $10,000 for bootstrapped
  companies, up to $350,000 when backed by an affiliated investor. Workers AI is already an
  optional LLM rung. First-time applicants only.
- [Sentry startup sponsorship](https://sentry.io/sponsorship/?promo_name=startup-sponsorship):
  error reporting already runs through `api/_lib/sentry.js`. Eligible only while the account
  has no prior paid usage.
- [OVHcloud Startup Program](https://startup.ovhcloud.com/en/): OVH AI Endpoints are a keyless
  rung in the LLM chain. EUR 10,000 in credits plus six hours with an engineer.

### Checked and ruled out

| Program | Why not |
| --- | --- |
| ElevenLabs grants | Already a P1 row; the directory's terms are stale. Use the [grant packet](../partner-packets/elevenlabs-startup-grants.md) |
| Google AI Startup Program | Eligibility is gated on prior Google Cloud credit usage, and three.ws already draws the Google for Startups Web3 grant. The Google Cloud AI Agents row above is the route that adds reach |
| Nebius for Startups | Credits now flow only through Nebius VC partners with $5M+ raised, and "crypto-only businesses" are excluded |
| Scaleway program for NVIDIA Inception members | Requires an EU-based startup; the three.ws Terms of Service are governed by Delaware law |
| Alibaba Cloud Startup Catalyst | The program page returns 404. The existing Alibaba Cloud Marketplace listing is unaffected |
| Mistral AI Ambassador Program | The page returns 404 and the only cohort ran August 2025 to January 2026. It was an individual advocacy role, not a company program |
| xAI data sharing credits | Pays in exchange for sharing request data and outputs. Our requests carry user prompts, so the trade is not ours to make |
| 1Password for Open Source | Limited to non-commercial projects |
| Mem0 startup program | New users only, three months of Pro, no co-marketing; agent memory is self-hosted |

## From the GitHub and npm sweep (2026-09-18)

A read-only sweep of GitHub and npm for directories, upstream showcases, and integration
registries that are **not** already tracked here, in [`opportunities.csv`](./opportunities.csv),
[the submission kit](./submissions/README.md), or
[the partnership pipeline](../../docs/partners/opportunities.md). Every row was checked on
2026-09-18: three.ws and `nirholas` are absent from each target, and each intake is proved by
a community pull request the maintainers merged recently.

Two live facts decide which URL each submission uses:

- `https://three.ws/api/mcp-studio` answers MCP `initialize` with 200 and needs no auth. Remote
  directories get this URL. `https://three.ws/api/mcp` is OAuth-gated and answers 401 to an
  anonymous probe.
- `@three-ws/mcp-server` 1.2.3 (Apache-2.0) ships the `3d-agent-mcp` bin, so stdio and `npx`
  directories get `npx -y @three-ws/mcp-server`.

Keep every entry below to the free 3D lanes (Forge, `<agent-3d>`, Materialize). An entry that
names a payment rail or token crosses the commit gate on other crypto projects and needs the
owner's approval first.

### Lists and directories (a pull request, no build)

| Target | Size and activity | Proof the intake works | The entry |
| --- | --- | --- | --- |
| [TensorBlock/awesome-mcp-servers](https://github.com/TensorBlock/awesome-mcp-servers) | 856 stars, pushed 2026-09-17 | [#2463](https://github.com/TensorBlock/awesome-mcp-servers/pull/2463) merged 2026-09-17 | `@three-ws/mcp-server` in the 3D or creative category |
| [toolsdk-ai/toolsdk-mcp-registry](https://github.com/toolsdk-ai/toolsdk-mcp-registry) | 186 stars, pushed 2026-09-15 | [#518](https://github.com/toolsdk-ai/toolsdk-mcp-registry/pull/518), a remote server, merged 2026-09-15 | JSON entry for the `mcp-studio` remote, per its `docs/CONTRIBUTING.md` |
| [Docker MCP Catalog](https://github.com/docker/mcp-registry) | 554 stars, pushed 2026-09-18 | [#661](https://github.com/docker/mcp-registry/pull/661) merged 2026-04-03; recent merges are mostly updates | A remote-server `server.yaml` (no Dockerfile needed; Apache-2.0 qualifies). Reaches Docker Desktop MCP Toolkit users |
| [Goose extensions directory](https://github.com/aaif-goose/goose) (`documentation/static/servers.json`; the repo moved from `block/goose`) | 54,416 stars, pushed 2026-09-18 | [#10638](https://github.com/aaif-goose/goose/pull/10638) added Glif, a generative-media MCP, on 2026-07-29 | `npx -y @three-ws/mcp-server` |
| [kyrolabs/awesome-agents](https://github.com/kyrolabs/awesome-agents) | 2,823 stars, pushed 2026-09-18 | [#766](https://github.com/kyrolabs/awesome-agents/pull/766) merged 2026-09-13 | `<agent-3d>` under Frameworks or Tools |
| [Jenqyang/Awesome-AI-Agents](https://github.com/Jenqyang/Awesome-AI-Agents) | 1,241 stars, pushed 2026-09-18 | [#498](https://github.com/Jenqyang/Awesome-AI-Agents/pull/498) merged 2026-09-18 | One line under Applications or Tools |
| [DasterProkio/awesome-ai-companion](https://github.com/DasterProkio/awesome-ai-companion) | 705 stars, pushed 2026-09-18 | [#19](https://github.com/DasterProkio/awesome-ai-companion/pull/19) merged 2026-09-13 | `<agent-3d>` under "Visual Presence & VTuber-Style Companions", which is exactly an embodied avatar for an AI companion |
| [caramaschiHG/awesome-ai-agents-2026](https://github.com/caramaschiHG/awesome-ai-agents-2026) | 1,830 stars, pushed 2026-06-10 | [#93](https://github.com/caramaschiHG/awesome-ai-agents-2026/pull/93) merged 2026-04-02; intake has slowed | One entry. Lower priority |
| [YuzeHao2023/Awesome-MCP-Servers](https://github.com/YuzeHao2023/Awesome-MCP-Servers) | 1,065 stars, pushed 2026-08-07 | [#132](https://github.com/YuzeHao2023/Awesome-MCP-Servers/pull/132) merged 2026-04-01 | `@three-ws/mcp-server`. Lower priority |
| [three.js forum Showcase](https://discourse.threejs.org/c/showcase/7) | 24 new showcase topics since 2026-09-01 | Open self-post; forum search for three.ws returns nothing | A Forge or `<agent-3d>` showcase thread. This is a post, so it is owner-gated |

### Upstream dependencies that feature their users

Both are libraries the product already runs in production, so the entry is a true statement
about real use, and each README asks for exactly this pull request.

| Dependency | Where we use it | The showcase | Proof |
| --- | --- | --- | --- |
| [`manifold-3d`](https://github.com/elalish/manifold) (2,279 stars) | `api/_lib/print/manifold-kernel.js`, the manifold check, volume, and repair behind `/materialize` | The README users table, next to Blender, Godot, and Babylon.js: "Please feel free to send a PR to update this list with your own project" | [#1768](https://github.com/elalish/manifold/pull/1768) merged 2026-07-02 |
| [`@ricky0123/vad-web`](https://github.com/ricky0123/vad) (2,056 stars) | `src/voice/vad.js`, voice activity detection for talking to an avatar | "Cool projects using this library" has a single entry, so ours would be the second | Community PR [#263](https://github.com/ricky0123/vad/pull/263) merged 2026-09-11 |

### Integration registries (build first, then submit)

Each needs a small package or extension before the listing, and each has a same-shaped
precedent that was accepted.

| Registry | What to build | Precedent |
| --- | --- | --- |
| [Vercel AI SDK tools registry](https://github.com/vercel/ai) (`content/tools-registry/registry.ts`, 26,820 stars) | An AI SDK `tool()` export for the no-key Forge text-to-3D lane, then a PR per `contributing/add-new-tool-to-registry.md`. It lists on ai-sdk.dev | [#14992](https://github.com/vercel/ai/pull/14992) merged 2026-06-03 |
| [LangChain JS tool integrations](https://github.com/langchain-ai/docs) | A `langchain-three-ws` npm package, then a docs PR (`packages.yml`, `integration_external_docs.yaml`, `tools/index.mdx`) | [#5632](https://github.com/langchain-ai/docs/pull/5632), a generative-media tool, merged 2026-09-02 |
| [Zed MCP extensions](https://github.com/zed-industries/extensions) (1,890 stars) | A thin context-server extension that runs `npx @three-ws/mcp-server` | [#6945](https://github.com/zed-industries/extensions/pull/6945) merged 2026-07-27; `pollinations-mcp`, a generative-media analog, is already listed |
| [Dify plugin marketplace](https://github.com/langgenius/dify-plugins) (553 stars) | A packaged Forge text-to-3D tool plugin. Dify also speaks MCP natively, so this is optional reach, not access | [#3112](https://github.com/langgenius/dify-plugins/pull/3112) merged 2026-09-18 |
| [LiveKit Agents avatar plugins](https://github.com/livekit/agents) (14,250 stars) | **Design decision first.** We already ship `livekit-client` (`src/runtime/livekit-voice.js`), but every accepted avatar plugin publishes server-rendered video into the room and ours renders in the browser. Either a server render lane, or a docs ask to list client-rendered avatars. Pipecat's `community-integrations.mdx` has the same shape | [#7216](https://github.com/livekit/agents/pull/7216), Synthesia's avatar plugin, merged |
| n8n verified community node | A node package in the Creator Portal. **Blocked by our own rule:** verification requires publishing through a GitHub Actions workflow with npm provenance, and this repo does not use GitHub Actions. An unverified node can still be self-installed. Owner decides or skips | Submission docs at `docs.n8n.io/integrations/creating-nodes/deploy/submit-community-nodes/` |

### Checked and dropped

`modelcontextprotocol/servers` retired its third-party list for the registry on 2026-04-14.
`cline/mcp-marketplace` has over 1,000 open submissions, no visible approvals, and no push
since 2025-06-24. `e2b-dev/awesome-ai-sdks` has merged no community entry since 2023,
`mahseema/awesome-ai-tools` since 2025-08, `filipecalegario/awesome-generative-ai` since
2025-12, and `aframevr/awesome-aframe` since 2017. The Colyseus showcase has added nothing
since 2024. `moeru-ai/airi` takes VRM and Live2D only, and we have no VRM export. Mastra and
the OpenAI Agents SDK have no community listing surface. glTF-Transform, three-mesh-bvh,
Spark, and Rapier have no users showcase. `Shubhamsaboo/awesome-llm-apps` is owner-authored
tutorials. `cursor.directory` answered 429 and stays unverified.

## The wide sweep (2026-09-18)

The same day, a wider sweep covered 52 verified awesome and curated lists, launch platforms, AI and MCP directories, newsletters,
podcasts, guest-post programs, app stores, events and CFPs, standards bodies, and the Solana
and crypto ecosystem. Its full evidence and dropped lists live in
[sweep-2026-09-18.md](./sweep-2026-09-18.md); the dated rows that need an owner action are in
[`opportunities.csv`](./opportunities.csv). Closest deadlines: Web3D 2026 Competitions
(2026-09-30), AI Native DevCon CFP (2026-10-01), AI Engineer Code Summit CFP (2026-10-11),
Colosseum Crypto World's Fair (2026-10-12).

## High-value editorial routes

These are earned after a measurable launch, not submitted as generic company profiles:

| Route                                    | Trigger required before pitching                               | Pitch                                                                     |
| ---------------------------------------- | -------------------------------------------------------------- | ------------------------------------------------------------------------- |
| OpenAI customer story                    | Directory listing plus meaningful tool-call or user outcome    | Interactive 3D creation inside ChatGPT with measured completion and reuse |
| Google Cloud startup success story       | Marketplace/AI Agents acceptance plus Cloud Run/Vertex metrics | A free browser 3D service kept reliable by an elastic GPU and model fleet |
| AWS Partner Success                      | Marketplace live plus a customer or procurement outcome        | Agent-native metering behind enterprise procurement                       |
| NVIDIA Technical Blog / Startup Showcase | High-performing forum post plus benchmark                      | Browser-native digital human on NVIDIA infrastructure                     |
| ElevenLabs customer story                | Grant/Demo Day acceptance plus voice usage                     | Voice that drives a visible 3D body rather than an audio-only agent       |
| Coinbase Builder Showcase                | Founders Fuel acceptance plus settlement proof                 | Agents buying creative work over x402                                     |

## First ten business days

| By         | Action                                                               | Completion evidence                                     |
| ---------- | -------------------------------------------------------------------- | ------------------------------------------------------- |
| 2026-09-17 | Book GitHub Open Source Friday and reply on issue #254               | Confirmed date and public issue comment                 |
| 2026-09-18 | Send IBM relationship note; send Agent Connect request separately    | Sent-thread IDs and next checkpoint                     |
| 2026-09-19 | Submit OpenAI Showcase packet and check Partner Locator profile      | Submission confirmation and profile URL or support case |
| 2026-09-22 | Publish one prepared NVIDIA forum post                               | Live NVIDIA-domain URL                                  |
| 2026-09-23 | Apply to Coinbase Founders Fuel                                      | Application confirmation                                |
| 2026-09-24 | Confirm ElevenLabs eligibility and apply if eligible                 | Application confirmation or recorded ineligibility      |
| After portal save | Send the focused NVIDIA reply for only Showcase routing and an ACE contact | Sent reply in the existing thread                       |
| 2026-09-25 | Begin Google Cloud AI Agents/Marketplace enrollment                  | Partner/application ID                                  |
| 2026-09-28 | Lock date and speaker for IBM event two                              | Live event URL                                          |

External sends, submissions, posts, and event publication remain owner-gated. The material
can be prepared completely in advance; the actual dispatch is recorded only after it occurs.

## Research rules

- Prefer official program, documentation, or owned community sources.
- Record `last_verified` for every row; re-check any intake older than 30 days before using it.
- “Applied” and “submitted” are not wins. A live URL or explicit acceptance is the win.
- A manifest in `public/.well-known` is not a directory listing.
- If a program is membership-based, state the eligibility dependency in the row.
- Never imply a partner endorsed three.ws because an employee replied. Preserve the exact
  public action and exact relationship wording.

Last verified: **2026-09-15**; the CloudCredits sweep section on **2026-09-18**.
