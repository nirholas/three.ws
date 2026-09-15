# OpenAI, IBM, and NVIDIA distribution and co-marketing plan

This is the execution plan for turning three.ws's existing relationships and technical
integrations into public listings, enterprise distribution, and partner-supported stories.
It was reconciled on **2026-09-14** against the live program pages and the submission
materials already in this repository.

The main finding is simple: the highest-value work is no longer product development. The
listing copy, technical proof, screenshots, and submission packets already exist. The next
stage is a small number of portal actions, emails, and well-timed follow-ups.

## Recommended order

| Priority | Opportunity | Action | Effort | Expected value |
|---|---|---|---|---|
| 1 | IBM watsonx Orchestrate Agent Catalog | Request the BYOL `APP_ID`, then submit the Remote MCP listing through Agent Connect | Low | Enterprise discovery inside IBM's governed agent catalog |
| 2 | OpenAI Developer Showcase | Submit the completed Showcase packet | Low | Public proof, a durable OpenAI-hosted project page, and a stronger app-review story |
| 3 | NVIDIA AI Accelerated | Complete the Shipping record with every field NVIDIA named, then wait for periodic catalog review | Low | Product validation and visibility in NVIDIA's accelerated application ecosystem |
| 4 | IBM Partner Plus marketing | Activate My Digital Marketing, obtain the Build-track marketing kit, and reopen the promised IBM page and social support | Low | Campaign assets and IBM-owned distribution without another engineering project |
| 5 | NVIDIA Inception visibility | Retrieve the restored co-brand kit; reply only for the unanswered Showcase route and ACE contact; keep the demo current for invite-only GTC Pavilion review | Low | Member spotlight, official assets, technical-team introductions, and event access |
| 6 | NVIDIA NGC Catalog | Package one useful GPU service as a maintained container and complete publisher onboarding | Medium | A self-contained NVIDIA catalog artifact developers can deploy |
| 7 | IBM Cloud Catalog | Start only after deciding whether three.ws will offer an IBM-hosted deployable product or commercial SaaS plan | High | Enterprise procurement and consolidated IBM billing |

## OpenAI

### What to pursue

1. **Complete the ChatGPT app review.** The plugin submission is the main distribution
   route for the interactive 3D Studio experience.
2. **Submit to the OpenAI Developer Showcase now.** OpenAI's community page explicitly
   routes builders to the Showcase, and the gallery accepts categories that fit three.ws,
   including apps, creative tools, Three.js, and WebMCP.
3. **Publish the two prepared Developer Community posts.** They should teach the build and
   link to a working demo. They should not read like token promotion.
4. **Keep Cookbook PR #2874 as a supporting channel.** Repair and maintain the PR, but do
   not wait on it before pursuing the Showcase or app directory.
5. **Use traction to make an editorial ask.** After the app is live, collect 30 days of
   installs, successful model generations, completion rate, and a few strong examples.
   Pitch a specific builder story rather than a general request for promotion.

### Positioning

> Turn a plain-language request into a textured, downloadable 3D asset and inspect it in an
> interactive viewer without leaving ChatGPT.

Lead with the native ChatGPT experience, visible output, and interoperability with GLB
workflows. Keep x402 and `$THREE` out of the primary OpenAI listing unless the reviewed app
actually exposes that payment flow. The creative tool is the clearest story for this
audience.

### Assets already prepared

- [Showcase submission](../../prompts/store-submissions/_generated/openai-showcase-submission.md)
- [ChatGPT app submission](../../prompts/store-submissions/_generated/openai-submission.md)
- [OpenAI listing channel map](../openai-listing-channels.md)
- [Developer Community: 3D Studio](../openai-community-3d-studio-post.md)
- [Developer Community: physical-world agents](../openai-community-physical-world-post.md)

## IBM

### 1. Agent Connect is the best immediate marketplace route

IBM's current watsonx Orchestrate catalog includes external partner agents and supports
partner-hosted agents. IBM's Agent Connect onboarding materials also describe Remote MCP
server listings and require an `APP_ID` from the IBM Ecosystem team.

three.ws already has the hard parts:

- a production Remote MCP endpoint at `https://three.ws/api/mcp-3d`;
- static OAuth support suitable for a pre-registered IBM client;
- setup documentation and test cases;
- a compliant SVG listing icon;
- a complete BYOL submission pack.

The next action is to email **IBMAgentConnect@ibm.com** for the BYOL `APP_ID`, then submit
through IBM Concierge. BYOL should come first because three.ws already controls access and
licensing. It avoids adding IBM payout, tax, and banking setup before demand is proven.

Prepared asset: [Agent Connect listing](../../marketing/ibm-partner-plus/agent-connect-listing.md).

### 2. Activate the Partner Plus marketing benefits

IBM currently offers Partner Plus members co-marketing resources, My Digital Marketing,
and partner marketing kits. Use them for one narrow enterprise campaign:

> Add production 3D generation and digital-human capabilities to governed enterprise agent
> workflows through a Remote MCP server.

The actions are:

- request or activate **IBM My Digital Marketing** access;
- request the current **Build-track partner marketing kit**;
- verify and publish the **Partner Plus Directory** company profile;
- reopen the June 18 commitment for a dedicated IBM-domain page and IBM social support;
- propose one joint webinar or community session built around a real Granite/watsonx
  workflow, with a live generation result rather than a company overview.

Bundle these requests into the same partner-manager thread. Give the IBM contact a title,
abstract, screenshot, speaker bio, working demo, and two possible dates so the request can
be forwarded internally without rewriting it.

### 3. Treat IBM Cloud Catalog as a separate commercial project

IBM Cloud Catalog is a real sales channel with self-service onboarding, but it requires a
product that fits IBM's hosting or deployable-software rules, support commitments, account
roles, and applicable provider/reseller agreements. It is more work than Agent Connect.

Pursue it after choosing one concrete offer:

- a deployable three.ws GPU/service container for IBM Cloud customers; or
- a commercial SaaS integration with an IBM-aligned deployment and support model.

Do not submit the current public website as a generic catalog product. Define what the IBM
customer buys, how it is deployed, who supports it, and how usage is metered first.

### IBM framing rules

Use **“three.ws is an IBM Business Partner.”** Do not imply IBM endorsement. Describe the
public Granite and watsonx integrations as three.ws-built integrations unless IBM has
approved stronger wording. For IBM-owned channels, lead with governed agents, Remote MCP,
Granite, and enterprise workflow value. Token-specific messaging can be a separate
developer story when it is technically relevant and the venue permits it.

Full internal audit: [IBM Partner Plus opportunities](./ibm-partner-plus.md).

## NVIDIA

### 1. Complete the AI Accelerated portal path

NVIDIA's current AI Accelerated page invites software and solution providers to apply,
validate performance on NVIDIA platforms, and increase application visibility. This is the
best public catalog target for the full three.ws product. As of 2026-09-14, however, its
public **Apply Now** link resolves to a retired Salesforce URL and returns 404. Use the
Inception portal product record: NVIDIA's 2026-09-14 reply confirmed that complete Shipping
records are the periodically reviewed catalog path and supplied no replacement form.

To enter review with an accurate record, correct the Inception portal product:

- mark **Riva**, **Audio2Face**, and applicable **NIM microservices** as technologies used;
- remove **DeepVariant NIM**;
- leave **TensorRT**, **Triton Inference Server**, and **Omniverse Kit** as considering until
  they ship;
- retain the verified CUDA, Kaolin, nvdiffrast, L4, and RTX PRO 6000 Blackwell usage.

The public catalog remains curated. Treat the corrected portal record as the internal
application and the existing Inception email as the catalog request. Do not wait on the dead
public link or ask again for an intake URL NVIDIA did not identify as part of the process.

### 2. Act on NVIDIA's reply without restarting the thread

The consolidated request was sent to `inceptionprogram@nvidia.com` on **2026-09-04** and
answered on **2026-09-14**. NVIDIA confirmed:

1. Accelerated Apps Catalog consideration comes from a complete, periodically reviewed
   Shipping product record;
2. the Co-Branded Marketing Assets benefit is accessible again through the portal; and
3. the GTC Startup Pavilion is exclusive and invite-only, with current profiles, clear
   NVIDIA-accelerated demos, and active NVIDIA relationships as the selection signals.

Do not send a second broad email and do not send the old September 25 no-response follow-up.
Complete the product record, download the current asset package from
`Portal > Benefits > Co-Branded Marketing Assets`, then use the narrow reply already drafted
for the two unanswered asks: Startup Showcase routing and an ACE/digital-human contact.

Prepared asset: [NVIDIA catalog and co-marketing request](../nvidia-apps-catalog-request.md).

### 3. Build proof that NVIDIA can amplify

NVIDIA's strongest story is specific and measurable:

> A browser-native digital-human and 3D generation stack running across NVIDIA L4 and RTX
> PRO 6000 Blackwell, with Riva speech, Audio2Face facial animation, and NIM-hosted models.

Use a monthly evidence loop:

- publish the prepared browser digital-human post on the NVIDIA Developer Forums;
- publish the prepared GPU fleet engineering post the following week;
- record latency, throughput, GPU type, completion rate, and cost-per-successful-output;
- turn the best-performing technical post into the Startup Showcase pitch;
- send the browser Audio2Face implementation to the ACE team if the introduction arrives.

This creates a trail that an NVIDIA program manager can verify and reuse. A working demo
and benchmark are more useful to them than a general partnership announcement.

### 4. Use NGC for one deployable artifact

NGC supports public entities such as containers, models, Helm charts, and resources. It is
appropriate for one maintained GPU artifact, not for mirroring the whole website. Choose a
service with clean model and redistribution rights, publish a versioned container, include
GPU compatibility and performance data, and commit to security and maintenance updates.

The container should lead users back to three.ws documentation and hosted demos, making
NGC both a technical distribution surface and proof of NVIDIA optimization.

### 5. Prepare the next event pitch early

NVIDIA confirmed that the GTC Startup Pavilion is invite-only. Keep the member profile and
browser-native digital-human demo current so they are strong selection evidence; there is
no Pavilion form to submit. Separately, prepare the browser-digital-human abstract now and
submit it only through the public speaking/poster call when the next call opens.

Use **“three.ws is a member of NVIDIA Inception.”** Do not use “NVIDIA partner” or imply
endorsement unless NVIDIA provides approved co-marketing copy.

## The co-marketing package every partner should receive

Maintain one evidence folder, then tailor the story for each partner. Every request should
contain:

- a one-sentence customer problem and outcome;
- the exact partner technology running in production;
- a public demo that works without special access;
- two screenshots and a 60 to 90 second video;
- three verified metrics;
- a short founder or technical-lead bio;
- approved logo files and exact relationship wording;
- one concrete ask, owner, and desired publication window.

The stories should remain partner-specific:

| Partner | Lead story | Proof to emphasize |
|---|---|---|
| OpenAI | Interactive 3D creation inside ChatGPT | tool calls, viewer UX, generated GLB examples |
| IBM | Governed enterprise agents gaining 3D capabilities through Remote MCP | auth, deployment, workflow, Granite/watsonx integration |
| NVIDIA | GPU-accelerated 3D and browser digital humans | L4/Blackwell performance, Riva, Audio2Face, NIM |

A combined “OpenAI + IBM + NVIDIA stack” story can run on three.ws-owned channels, with
each technology described factually. Partner-owned pitches should focus on that partner's
audience and product.

## Thirty-day action board

| Date | Action | Owner | Completion evidence |
|---|---|---|---|
| Sep 14 to 18 | Submit the OpenAI Showcase packet | Owner | confirmation email or submission ID |
| Sep 14 to 18 | Request IBM Agent Connect BYOL `APP_ID` | Owner | IBM thread and assigned ID |
| Sep 14 to 18 | Activate IBM My Digital Marketing and verify Partner Plus Directory profile | Owner | portal screenshots and live profile URL |
| Sep 14 to 18 | Complete the NVIDIA Inception Shipping record, including runtime technology fields, descriptions, logo, and brand color; retrieve the restored co-brand kit | Owner | saved portal record plus dated asset-package receipt |
| Sep 18 to 24 | Publish the prepared OpenAI and NVIDIA technical posts on a measured cadence | Owner | live URLs added to the publishing tracker |
| After portal save | Reply once to NVIDIA with only the unanswered Showcase-routing and ACE-contact questions | Owner | sent reply in the existing thread |
| By Sep 29 | Decide on IBM TechXchange attendance | Owner | registration or explicit close |
| By Oct 14 | Assemble 30-day proof: usage, completion rate, latency, installs, and examples | Growth + engineering | partner-ready one-page evidence brief |

## Official program references

- [OpenAI developer community](https://developers.openai.com/community)
- [OpenAI Developer Showcase](https://developers.openai.com/showcase)
- [IBM watsonx Orchestrate Agent Catalog](https://www.ibm.com/products/watsonx-orchestrate/agent-catalog)
- [IBM Agent Connect onboarding](https://connect.watson-orchestrate.ibm.com/agent/onboard)
- [IBM Partner Plus go-to-market benefits](https://www.ibm.com/partnerplus/marketing)
- [Selling on IBM Cloud Catalog](https://www.ibm.com/products/cloud/partners/catalog-sell)
- [IBM Cloud catalog onboarding requirements](https://cloud.ibm.com/docs/sell?topic=sell-selling-clouds)
- [NVIDIA AI Accelerated](https://www.nvidia.com/en-us/ai-data-science/ai-accelerated/) (program page; its public application link returned 404 on 2026-09-14)
- [NVIDIA Developer Program and Inception benefits](https://developer.nvidia.com/developer-program)
- [NVIDIA GTC for startups and VCs](https://www.nvidia.com/gtc/startups/)
- [NVIDIA NGC Catalog](https://catalog.ngc.nvidia.com/)
