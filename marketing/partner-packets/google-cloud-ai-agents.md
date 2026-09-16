# Google Cloud: Partner Network, AI Agents program, agent finder, Marketplace

**Target:** Google Cloud Marketplace for agent builders, the Google Cloud AI Agents program, and the
AI agent finder
**Source of the path:** https://cloud.google.com/marketplace/sell ("Agent builders" tab, read in a real
browser 2026-09-16)
**Deadline:** none published. Pipeline target **2026-09-25** ([opportunities.csv](../growth/opportunities.csv)).
**Owner's one step:** enroll the company in Google Cloud Partner Network at
https://partners.cloud.google.com/enrollment, signed in with the Google account that should hold the
Partner Administrator role. Everything after that needs a Partner Network login, which is why it is
the one step.

---

## Read this first: two findings that change the ask

**1. Vertex AI is denied on the production project today.** Cloud Run logs for `three-ws-api` on
2026-09-16 at 16:14Z and 16:15Z read `vertex imagen failed, falling back: Lightning dunning decision is
deny for project: projects/93741856042` (that is `aerial-vehicle-466722-p5`), and the Vertex reference
image lane returned 403. Google's AI agent listing requirements say an A2A agent must "use Google
foundation or 3rd party models hosted in Model Garden as a default"
([requirements](https://docs.cloud.google.com/marketplace/docs/partners/ai-agents)). Production does not
meet that today: Vertex is billing-denied and `VERTEX_CLAUDE_PRIMARY` is `0` on the service, so the
default brain is the free third-party chain. **Clear the billing hold and make a Model Garden model the
default before submitting the A2A agent type.** Partner Network enrollment itself does not depend on
it, which is why enrollment is still the first step.

**2. The public Agent Card is not yet a valid Marketplace Agent Card.** Read from
`https://three.ws/.well-known/agent-card.json` on 2026-09-16:

| Requirement | Current card | Gap |
|---|---|---|
| A2A Agent Card specification ([a2a-protocol.org](https://a2a-protocol.org/dev/specification/)) | Has `name`, `description`, `url`, `provider`, `version` 1.5.1, `capabilities`, `defaultInputModes`, `defaultOutputModes`, 10 `skills` | Missing `protocolVersion`, `preferredTransport`, and `securitySchemes`/`security` (uses the older `authentication` key) |
| The card's `url` is the agent's A2A endpoint | `https://three.ws/` (the website) | The A2A JSON-RPC handler lives at `/api/agents/a2a-paid`; `POST /api/a2a` returns 404 |
| Stored as a JSON file in Cloud Storage and attached in Producer Portal ([Agent Card doc](https://docs.cloud.google.com/marketplace/docs/partners/ai-agents/agent-card)) | Served from the website only | Upload a Marketplace copy to a Cloud Storage bucket in the project |
| Customers are billed through Google Cloud Marketplace | Declares the x402 payments extension with `"required": true` | A Marketplace customer cannot be required to settle each call on-chain; the Marketplace variant must make that extension optional or omit it |
| Passes the Agent ScoreCard thresholds | Never run | Run validation in Producer Portal after upload |

Fixing the card is engineering work that needs no permission; it is listed here so the owner does not
submit the current file.

---

## The verified intake path, in order

From the "Agent builders" tab of the sell page and the linked docs, all resolved 2026-09-16:

1. **Enroll in Partner Network:** https://partners.cloud.google.com/enrollment
2. **Become a Marketplace vendor:** in Partner Network Hub choose "Initiate onboarding your product to
   Marketplace", submit the architecture diagram and business inputs, then accept the
   [Marketplace Vendor Agreement](https://cloud.google.com/terms/marketplace-vendor-agreement) (needs
   Partner Administrator). Complete the project info form the Marketplace team sends to get Producer
   Portal access. ([vendor steps](https://docs.cloud.google.com/marketplace/docs/partners/offer-products))
3. **Apply for the Google Cloud AI Agents program:**
   https://partners.cloud.google.com/resources/google-cloud-ai-agent-program (Google sign-in required;
   the program page content could not be read logged out)
4. **Onboard the agent in Producer Portal:** create the AI agent, attach the Agent Card from Cloud
   Storage, add product details, add pricing (about 4 business days of review), integrate account
   creation and Google sign-in, then submit for publication.
   ([onboarding](https://docs.cloud.google.com/marketplace/docs/partners/ai-agents))
5. **Agent finder discoverability:** https://cloud.withgoogle.com/agentfinder/ (linked from the sell
   page under "Enhance discoverability"; the page does not publish a separate submission form, so ask
   the assigned partner manager how an approved listing is routed into it)

**Listing type decision.** Google offers "AI Agents as a Service (A2A protocol)" and "Software as a
Service (SaaS)" for agents using other protocols. The A2A type is the stronger fit and the one that
reaches Gemini Enterprise, but it carries the Model Garden default requirement above. SaaS is the
fallback if the billing hold cannot be cleared quickly.

**Pricing model decision.** Google supports Free, Subscription, Usage-based, and Combined. Recommend
**Free** for the first listing: it matches the free, keyless generation lane that already exists, and
it avoids rebuilding x402 per-call billing onto Marketplace metering before there is demand.

---

## Forwardable packet

**One-sentence pitch:** three.ws is a production 3D agent platform that already runs on Cloud Run,
Cloud Scheduler, and a Cloud Run GPU fleet, and wants to bring an A2A agent that turns text into rigged,
embeddable 3D characters to Google Cloud Marketplace and the AI agent finder.

**100-word abstract:** three.ws turns a text prompt or photo into a textured, rigged, animation-ready
3D character and embeds it anywhere with one web component. Production runs on Google Cloud: one Cloud
Run API service scaling from 6 to 100 instances, eight Cloud Run GPU services for 3D generation,
rigging, and motion, and 120 Cloud Scheduler jobs. Since June 2026 it has started 39,675 generations,
33,941 of them completed. It already publishes an Agent Card with ten skills and supports A2A. We want
to enroll in Partner Network, join the AI Agents program, and list a Marketplace A2A agent that
enterprise teams can discover through the agent finder.

**Working link:** https://three.ws/forge (200 on 2026-09-16; the free lane needs no account)

**Screenshot:** [images/forge.png](images/forge.png), captured 2026-09-16. Alt text: "The three.ws Forge
page: a prompt box, quality and engine selectors, and a Generate button, free with no sign-up."

**Two proposed dates** (intro call with the assigned partner manager after enrollment):
**2026-09-30** or **2026-10-02**, any time 9 AM to 12 PM US Pacific. Proposals only; nothing is booked.

**Requested action:** after enrollment, assign a partner manager and confirm the AI Agents program
intake, including how an approved agent is routed into the AI agent finder and the Gemini Enterprise
validation path.

**Approved relationship wording** (from [docs/listings.md](../../docs/listings.md) and
[docs/partners.md](../../docs/partners.md)): three.ws is a **member of Google Cloud for Web3 Startups**
and runs its production stack on Google Cloud. It is **not yet a Google Cloud Partner** (no Partner
Network enrollment) and has **no Marketplace listing**. The `/partners` card chip "Cloud" describes the
technical dependency, not a program tier. Do not write "Google Cloud partner" or "partnership" in the
outreach, even though the blog post's URL slug says `google-cloud-partnership`; its title is "three.ws
Joins Google Cloud for Web3 Startups".

---

## Marketplace business case (draft for the "business inputs" step)

**Product.** A 3D agent platform. The Marketplace offer is a hosted A2A agent that generates a textured
3D model from text or images, rigs humanoid characters for animation, validates and inspects GLB files,
and returns an embeddable viewer. Its skills are already declared in the public Agent Card:
`list-avatars`, `get-avatar`, `search-avatars`, `render-avatar`, `delete-avatar`, `validate-model`,
`inspect-model`, `optimize-model`, `inspect-glb-a2a`, `x402-service-catalog`. The Marketplace variant
should drop `delete-avatar` from a first listing unless account linking is complete, and scope out
`x402-service-catalog`.

**Customer problem.** Enterprise product, marketing, and commerce teams want 3D assets and embodied
agents but do not have 3D pipelines. Agents in Gemini Enterprise answer in text; this agent returns a
3D object a user can inspect, place in AR, or embed.

**Why Google Cloud Marketplace.** Production already runs on Google Cloud, so the customer's data and
compute path does not change vendors. Marketplace procurement and commit drawdown remove the purchasing
step that blocks enterprise pilots.

**Architecture (for the diagram).**
- `three-ws-api` on Cloud Run, us-central1: serves the frontend, route table, and every API handler;
  min 6, max 100 instances (read from the service on 2026-09-16; live revision
  `three-ws-api-00437-lsv`, commit `58224bd69`, per `https://three.ws/api/version`).
- GPU generation fleet on Cloud Run: seven services on NVIDIA L4 (`model-trellis`, `model-hunyuan3d`,
  `model-hunyuan3d-21`, `model-rig`, `model-text2motion`, `model-triposg`, `model-triposr`) and one on
  NVIDIA RTX PRO 6000 (`model-hunyuan3d-21-rtx`), plus CPU services for background removal, remeshing,
  segmentation, stylization, and reconstruction.
- `three-ws-multiplayer` on Cloud Run for the live 3D world.
- Cloud Scheduler: 120 jobs in us-central1, synced from the 117 cron definitions in `vercel.json`.
- Cloud Build with a pinned build service account; runbook in
  [docs/ops/gcp-production.md](../../docs/ops/gcp-production.md).
- Vertex AI: Gemini and Imagen lanes, plus Claude on Vertex as an optional transport. **Currently
  billing-denied**; restore before claiming it in the business case.

**Evidence of production readiness.**

| Metric | Value | Source | Captured |
|---|---|---|---|
| 90-day uptime, external probe every 5 minutes | 99.85% overall; Platform API 99.78% | `https://three.ws/status` | 2026-09-16 |
| Generations started / completed | 39,675 / 33,941 since 2026-06-11 | Production database, `forge_creations` | 2026-09-16 |
| Generations in the last 30 days | 22,638 | Same | 2026-09-16 |
| Avatars / agents / embedded widgets | 74,846 / 3,817 / 632 | `https://three.ws/api/platform/stats` | 2026-09-16T16:02Z |
| Agent Card skills | 10 | `https://three.ws/.well-known/agent-card.json` | 2026-09-16 |

**Go to market.** A Free listing first, measured on activated Marketplace accounts and completed
generations per account. After the first ten active accounts, propose a usage-based plan and a joint
startup success story. Existing distribution that can point at the listing: the OpenAI Select Partner
connector, the IBM Community user group, and the public docs.

**What we would ask Google for after acceptance.** AI agent finder placement, Gemini Enterprise
validation, and consideration for a Google Cloud startup success story once there is a measured
Marketplace outcome ([growth register](../growth/opportunities.md) sets that trigger).

---

## Not verifiable from outside

- The AI Agents program page content, eligibility, and application questions (behind Google sign-in).
- Whether Partner Network enrollment has any tier or revenue threshold for the AI Agents program.
- Whether the Google Cloud for Web3 Startups membership carries a partner-manager contact who can
  shortcut step 1; nothing in the repo names one.
