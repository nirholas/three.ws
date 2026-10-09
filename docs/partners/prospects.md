# Partner prospects

*Swept 2026-10-09, the day Tripo reached out. This page is the list of companies and
projects three.ws could partner with directly, scored and with a verified way in.
[Partnership outreach plan](./outreach-plan.md) is how the list gets worked.*

**How this page differs from the [partnership and listing pipeline](./opportunities.md).**
The pipeline tracks programs, directories and listings we have already started, each with a
single next action. This page is the layer above it: company-to-company partnerships, the kind
that starts with a Tripo email. When a prospect here gets a first action, it moves into the
pipeline and the ledger at
[`marketing/growth/opportunities.csv`](../../marketing/growth/opportunities.csv), and this page
links to it rather than restating it.

**How it was built.** Five research passes on 2026-10-09:
- 3D generation and inference hosts.
- Avatars, animation and motion capture.
- Voice, real-time and streaming.
- 3D web, assets, printing and commerce.
- Agent frameworks, coding tools and registries.

Each pass read the repository first, so the **Touchpoint today** column describes code that
exists, not a hope. Each fact carries the source it was read from:
- GitHub star counts come from the GitHub API on 2026-10-09.
- npm downloads are for the week 2026-10-01 to 2026-10-07, from the npm downloads API.
- A figure a company publishes about itself is marked *(vendor claim)*.
- A figure seen only in search results, not on the source page, is marked *(search-reported)*.
- Intake routes, contact addresses and program terms were read on the company's own page that
  day. An address is listed only when it was printed there.

**Scoring.** Three 1 to 5 scores, added up to a score out of 15:

| Score | 1 | 5 |
|---|---|---|
| **F**it: how naturally it joins what three.ws already ships | A new product line | Already in our code |
| **R**each: who it puts us in front of | A niche | Millions of the right users |
| **A**ccess: how easy the door is | No public route | Self-serve |

The score ranks the list. It does not replace judgment: a 15 with a slow review can still lose
to an 11 that ships in a day.

**Naming.** Prospects are named, the way [Tripo](./tripo.md) and the existing partner cards are.
Companies that compete with three.ws directly were screened out and are not named (see
[Screened out](#screened-out)), following the house rule for competitors in committed files.
Crypto and on-chain partners are kept in a separate list.

---

## The short list

The sixteen highest-value moves across every category, ranked by value divided by effort. The
category tables below carry the detail and the source for each claim.

| # | Prospect | Score | The move | Why now |
|---|---|---|---|---|
| 1 | **Tripo** | 15 | Reply, propose a 60-day partner-credits pilot, ship the v3 house lane | They reached out. Brief and reply draft: [tripo.md](./tripo.md) |
| 2 | **LiveKit** | 14 | Ship the 3D avatar plugin, apply to LiveKit Startups | The open design question on the plugin is answered (see the voice table), and the program is new |
| 3 | **Shopify** | 14 | Build a "photo to 3D product media" app for the App Store | Product pages already take GLB and USDZ with AR, so the Forge fills a slot that already exists |
| 4 | **Discord Activities** | 14 | Ship /play or a 3D agent as an Activity, list it in the App Directory | We already run a Discord gateway; discovery is self-serve within 24 hours of verification |
| 5 | **three.js, glTF-Transform, three-vrm** | 14, 12, 14 | Sponsor, credit, and send the upstream fixes we already carry | Load-bearing dependencies with no contribution from us yet; the cheapest credibility in our audience |
| 6 | **Poly Haven** | 14 | Credit the source of /objects, then sponsor | A credibility gap today: /objects is built on their catalog and never says so |
| 7 | **Meshy** | 14 | Apply to their partner program for platform pricing | We already ship the lane; same house-key logic as Tripo |
| 8 | **Bambu Lab, OrcaSlicer, Prusa** | 13, 13, 11 | Get three.ws onto the slicers' trusted hosts | The "Open in slicer" buttons are live; a trust prompt and a hard block sit in front of them |
| 9 | **Craftcloud** | 13 | Wire a "get it printed" button on its public order API | No deal needed to start; we already serve print-ready STL and 3MF |
| 10 | **pixiv (VRoid Hub)** | 13 | Register a VRoid Hub app and ship VRoid import | The format is already supported across the avatar stack |
| 11 | **Mesh2Motion and Quaternius** | 13, 13 | Import their CC0 clips, sponsor, cross-link | The fastest way out of the Mixamo licensing risk ([below](#fix-before-we-pitch)) |
| 12 | **Pipecat** | 13 | List our avatar service as a community integration | The route is documented step by step and shares the LiveKit plugin's work |
| 13 | **Epic Fab and Sketchfab** | 13, 13 | Publish CC0 and labeled AI packs on Fab; keep the Sketchfab showcase compliant | Fab accepts GLB and labeled AI work; the Sketchfab tag is fixed (2026-10-09) |
| 14 | **Home Assistant** | 12 | Get the integration into the default HACS store | The integration is built; about 700,000 active installs |
| 15 | **GitHub, Hermes Agent, OpenClaw, Google ADK** | 13, 14, 14, 14 | Get our MCP servers and skills into the curated registries and catalogs of the biggest agent tools | MCP is our best-proven channel, and these are mostly a pull request each. Detail in the [agent tools table](#agent-frameworks-coding-tools-and-registries) |
| 16 | **Vercel AI SDK and LangChain** | 14, 14 | Publish `@three-ws` tool packages for both frameworks | 29M and 6M weekly downloads, and we already depend on the AI SDK |

---

## Time-sensitive

These lose value by waiting. Everything else on this page can be worked in wave order.

| Opening | Why it is closing | Our asset | Where it is worked |
|---|---|---|---|
| **Tripo's inbound** | An inbound conversation cools in days | [tripo.md](./tripo.md): brief, asks, offers, reply draft | Wave 0 of the [outreach plan](./outreach-plan.md) |
| **Ready Player Me users** | The service shut down on 2026-01-31 and both its hostnames are dead in DNS today. Two competitors are already publishing "alternative to Ready Player Me" pages for these users | `/import/rpm` exists and the Wolf3D skeleton already animates, but the page is marked `noindex` | Owner-gated order [934](../../prompts/finish/934-best3d-07-orphaned-avatar-campaign.md) and order [075](../../prompts/finish/075-best3d-09-three-vrm.md) |
| **Motion-capture users stranded in 2026** | Meshcapade (now part of Epic Games) shut its online platforms, including MoCapade. RADiCAL's web portal closed on 2026-07-06 after Autodesk bought its core technology, and user data was not transferred | [`workers/model-video2motion`](../../workers/model-video2motion/) turns a video into a clip | Order 090 of the [partners campaign](../../prompts/finish/_context/partners-00-CONTEXT.md) |
| **LiveKit Startups** | Launched 2026-09-16: up to USD 23,000 for companies under 50 people and under USD 5M raised | The avatar plugin | Wave 1 |
| **Hume's voice and TTS APIs end 2026-11-13** | Hume's changelog of 2026-10-02 retires TTS and EVI on that date | Nothing in our code uses Hume (checked 2026-10-09). Do not start an integration | No action |

---

## Fix before we pitch

A partner who looks at three.ws will look at how we treat their work. The sweep found these,
and each has an owner.

| Finding | Status |
|---|---|
| Our copy said VRM avatars open in VTube Studio and Mozilla Hubs. VTube Studio loads Live2D models only, and Mozilla Hubs shut down in 2024 | **Fixed** in `e30e90c34` (the copy now names Warudo, VNyan, Resonite, and VRChat through Unity) |
| Sketchfab showcase uploads were tagged `ai-generated`, while Sketchfab's [AI-generated content policy](https://help.sketchfab.com/en/articles/16152133) asks for its "Created With AI" tag (API slug `createdwithai`) | **Fixed** in `919e54e82`. Models uploaded before the fix keep their old tags until they are re-tagged, which is an edit to public listings, so it is owner-gated |
| **Licensing risk.** [`api/animations/library.js`](../../api/animations/library.js) publicly serves the Mixamo-sourced clip library as raw JSON, and [`scripts/mirror-animation-library.mjs`](../../scripts/mirror-animation-library.mjs) exists so third parties can mirror it. Mixamo's terms, as quoted on Adobe's community forum, allow royalty-free use in projects but forbid distributing the raw animation files | Order 085 of the partners campaign: move the public library to CC0 and self-generated clips, and ask Adobe in writing for anything we keep |
| /objects is built from Poly Haven's CC0 catalog and never credits them where a visitor can see it. meshoptimizer's credit lives only in the header of a vendored file. No page credits the open-source projects the product stands on | Order 086 of the partners campaign: a public credits page and in-surface credits |
| VSeeFace, a popular free VTuber app, reads VRM 0.x only, and our exporter writes VRM 1.0 | Covered by order [075](../../prompts/finish/075-best3d-09-three-vrm.md) (three-vrm and orphaned-avatar import) |

---

## 3D generation engines and inference hosts

The partners whose models produce what the Forge sells. Engines we already run are the strongest
prospects, because the pitch is volume, not a promise.

| Prospect | What they are | Scale (source) | Touchpoint today | The deal | Intake route | F·R·A | Score |
|---|---|---|---|---|---|---|---|
| **Tripo (VAST)** | Text, image and multiview to 3D, plus rig, retarget, low-poly, splat and segmentation endpoints | Series B/B+ of about USD 446M, 2026-09 *(search-reported)*; TripoSR 7,035 stars | Bring-your-own-key lane in [`api/_providers/tripo.js`](../../api/_providers/tripo.js); self-hosted TripoSG and TripoSR workers | Partner credits, then partner pricing; full brief in [tripo.md](./tripo.md) | They reached out; `business@tripo3d.ai` on their pricing page | 5·5·5 | **15** |
| **Meshy** | Text and image to 3D, texturing, rigging | Series B of about USD 400M at USD 1.5B, 2026-07 (PR Newswire); 12M+ users *(vendor claim)* | Bring-your-own-key lane, [`api/_providers/meshy.js`](../../api/_providers/meshy.js) | Platform pricing so Meshy can be a house lane; co-marketing | Partner form at meshy.ai/partners (aimed at enterprise resale, starting in Europe) | 5·5·4 | **14** |
| **fal.ai** | Inference host that sells Tripo, Hunyuan3D, TRELLIS.2, Rodin, Meshy and SAM 3D behind one key | `@fal-ai/client` 1.64M/wk (npm) | None for 3D | One account would turn several bring-your-own-key lanes into house lanes | Not verified | 5·5·3 | **13** |
| **Hugging Face** | Model hub, ZeroGPU Spaces, Inference Providers | `@huggingface/inference` 369K/wk (npm) | The free Spaces failover chain ([`api/_providers/huggingface.js`](../../api/_providers/huggingface.js)) | ZeroGPU quota or a community GPU grant, which raises free-tier reliability directly | Already in the [pipeline](./opportunities.md) as the Space feature and GPU grant row | 5·5·3 | **13** |
| **Tencent Hunyuan3D** | Open-weight 3D generation (2.x); newer versions API-only | Hunyuan3D-2 15,041 stars | Self-hosted worker and Spaces rung | API access to newer versions; a production showcase | Not verified (Tencent Cloud) | 5·5·2 | **12** |
| **World Labs (Spark)** | Marble world generation, World API, and the Spark splat renderer | Spark 3,711 stars and about 215K/wk (npm); an AMD deal is pending | Spark renders [`src/splat-stage.js`](../../src/splat-stage.js) | Spark production showcase and upstream fixes; World API credits | World API and the Spark GitHub repo | 4·5·3 | **12** |
| **Microsoft TRELLIS** | Open-weight structured 3D latents (TRELLIS, TRELLIS.2), MIT | 13,813 and 11,610 stars | Our default engine; TRELLIS.2 lane built in order 067 | A production case study and upstream fixes | GitHub issues and pull requests | 5·4·2 | **11** |
| **Hitem3D (Sparc3D)** | High-fidelity image to 3D, strong print geometry | Agent-skill launch, 2026-03 (PR Newswire) | Research notes only | An API lane for print-quality output | `apicontact@hi3d.ai` (their API docs) | 4·3·4 | **11** |
| **Hyper3D Rodin** | Rodin Gen-2 and Gen-2.5 generation with quad meshes | 2025 round led by strategic investors *(search-reported)* | Bring-your-own-key lane, [`api/_providers/rodin.js`](../../api/_providers/rodin.js) | Gen-2.5 upgrade, credits, early access | Contact page and Discord; no partner program | 4·4·3 | **11** |
| **Replicate** | Model host, now part of Cloudflare | `replicate` 573K/wk (npm) | [`api/_providers/replicate.js`](../../api/_providers/replicate.js) | Credits | Not verified | 4·4·3 | **11** |
| **Stability AI** | SF3D and SPAR3D fast image to 3D | SF3D 1,843 stars | Bring-your-own-key lane | Clarity on the enterprise license past the community license's USD 1M revenue cap | Not verified | 3·4·3 | **10** |
| **Polycam** | Capture and reconstruction with public APIs | Series A USD 18M, 2024 (press) | None | Capture-to-avatar and capture-to-Forge | `sales.poly.cam/contact` | 3·4·3 | **10** |
| **KIRI Engine** | Photogrammetry, Gaussian splats, splat to mesh API | Not verified | None | Splat-to-mesh lane on the splat stage | `contact@kiri-innov.com` (their API page) | 3·3·4 | **10** |
| **Zoo.dev** | Text-to-CAD API with an agent and MCP server | modeling-app 1,312 stars | None | A CAD lane for makers who print | `sales@zoo.dev` (API pricing page) | 3·3·4 | **10** |
| **Niantic Spatial** | Scaniverse, visual positioning, the `.spz` splat format | USD 250M at spin-out (press) | `.spz` support ([splat docs](../splat.md)) | A format and positioning integration | Not verified | 3·4·2 | **9** |
| **Kaedim** | AI plus artist 3D production for studios | Series A USD 15M, 2024 (PocketGamer) | None | A premium "artist-finished" tier routed to them | `kaedim3d.com/contactUs` | 3·3·3 | **9** |

GPU and compute credit programs (Modal up to USD 50K, RunPod up to USD 25K, Baseten USD 25K,
Together up to USD 50K) overlap the Google Cloud credits we already hold. The standing rule is to
prefer GCP, so they stay off the active list.

---

## Avatars, animation and motion capture

Where three.ws avatars come from and how they move. Our universal retargeter means any humanoid
source is a potential partner, not just one rig family.

| Prospect | What they are | Scale (source) | Touchpoint today | The deal | Intake route | F·R·A | Score |
|---|---|---|---|---|---|---|---|
| **pixiv three-vrm** | The three.js VRM loader | 2,210 stars; `@pixiv/three-vrm` 105,715/wk (npm) | Core dependency ([`src/runtime/pose-solve.js`](../../src/runtime/pose-solve.js), [`src/avatar-export.js`](../../src/avatar-export.js)) | Upstream fixes from our retargeter, then a showcase listing | GitHub issues and pull requests | 5·4·5 | **14** |
| **pixiv VRoid Hub and VRoid Studio** | Free anime-style VRM creator and its hosting hub | VRoid Studio 4,758 Steam reviews, Very Positive (Steam API) | VRM support across the avatar stack | An approved VRoid Hub app: import a user's own models with consent, listed on hub.vroid.com/apps | Register at hub.vroid.com/oauth/applications, then the approval form (reply within about a week, per developer.vroid.com) | 5·4·4 | **13** |
| **Mesh2Motion** | Browser auto-rigger plus a CC0 animation library for humans and creatures | 3,395 stars, pushed 2026-10-06; MIT code, CC0 assets | None | Import its CC0 clips; sponsorship; cross-links | GitHub, support.mesh2motion.org | 5·3·5 | **13** |
| **Quaternius** | CC0 rigged characters and the Universal Animation Library (120+ clips) | CC0 *(vendor claim)* | Named in [`src/glb-canonicalize.js`](../../src/glb-canonicalize.js) | Bulk CC0 ingest with credit; Patreon sponsorship | `laulhet@gmail.com` (printed on quaternius.com), Patreon | 5·3·5 | **13** |
| **Avaturn (Goodsize)** | Selfie-to-avatar SDK for web, Unity, Unreal and mobile; same company as in3D | `@avaturn/sdk` 728/wk (npm); free tier, PRO USD 800/mo *(vendor pricing page)* | Shipping: [`src/avatar-creator.js`](../../src/avatar-creator.js), [`src/avaturn-client.js`](../../src/avaturn-client.js) | Case study, "works with" badge, a joint page for avatar users who lost their old provider | developer.avaturn.me, the contact form on avaturn.me, Discord; `hello@in3d.io` | 5·3·4 | **12** |
| **Uthana** | Motion models (text and video to motion, retarget, auto-rig) and licensed motion data | Seed USD 4.3M, 2025-03; "45,000+ characters animated" *(vendor claim)* | None | Licensed clips and a commercial motion lane behind our open-source one | `sales@uthana.com` | 5·3·4 | **12** |
| **Rokoko** | Mocap suits, Rokoko Vision, Studio, Motion Library | "250,000 users" *(vendor claim)* | None | A listing on their integrations page; live mocap into web agents | rokoko.com/get-in-touch, sdk.rokoko.com | 4·4·4 | **12** |
| **Human Motion Diffusion Model (MDM)** | Open-source text to motion, MIT | 4,114 stars | Live: [`workers/model-text2motion`](../../workers/model-text2motion/), [`api/forge-motion.js`](../../api/forge-motion.js) | Credit the project publicly and contribute fixes | GitHub | 4·3·5 | **12** |
| **Adobe Mixamo** | Free auto-rigging plus an animation library | Online but not updated in years | The public clip library ([licensing risk](#fix-before-we-pitch)) | Written permission for anything we keep; otherwise replace | No partner channel found; Adobe's community forum | 5·5·1 | **11** |
| **VRM Consortium** | Steward of the VRM standard | 21 members including pixiv and Unity Technologies Japan (vrm-consortium.org) | VRM compatibility checker in our paid pipelines | Supporting membership and a listing as a VRM-compatible service | `vrmc-pr@vrm-consortium.org` (printed on the site) | 4·3·4 | **11** |
| **Warudo** | 3D VRM VTubing app with C# plugin mods and Steam Workshop | 674 Steam reviews, 91% positive | Named in our VRM export copy | A mod connecting a Warudo avatar to a three.ws agent's brain, voice and visemes | Mod SDK at docs.warudo.app, Steam Workshop; `info@warudo.app` | 4·3·4 | **11** |
| **DeepMotion** | Video to motion and text to motion, both with APIs | "1M+ users" *(founder interview)* | None | A commercial rung in the motion failover chain | deepmotion.com/contact | 4·3·4 | **11** |
| **Daz 3D** | Genesis figures and an asset store | "Tens of thousands" of models *(vendor claim)* | Genesis bone map in [`src/glb-canonicalize.js`](../../src/glb-canonicalize.js) | "Works with Genesis" badge, affiliate | daz3d.com/help, affiliate program page | 3·4·4 | **11** |
| **Open text-to-motion models** (Kimodo from NVIDIA, MotionGPT) | Next text-to-motion lanes | Kimodo 3,743 stars, Apache-2.0 code; MotionGPT 1,975, MIT | Research notes | A second open lane; read each weights license first | GitHub | 4·3·4 | **11** |
| **TalkingHead** | JavaScript lip-synced full-body avatars, MIT | 1,599 stars; 11,982/wk (npm) | Named in our feature copy | Interop with our Audio2Face lip-sync | GitHub | 3·3·5 | **11** |
| **Reallusion** | Character Creator, the free AccuRIG auto-rigger, ActorCore motions | "4,500+ ActorCore motions" *(vendor claim)* | `CC_Base_` bone map in [`src/glb-canonicalize.js`](../../src/glb-canonicalize.js) | "Works with Character Creator" badge; web playback rights for ActorCore | Not verified | 4·4·2 | **10** |
| **FreeMoCap** | Open-source multi-camera mocap, AGPL-3.0 | 10,416 stars | None | A file-import path (file import keeps AGPL code out of our product) | Discord, freemocap.org | 3·3·4 | **10** |
| **AIRI** | Open-source VRM and Live2D AI companion, MIT | 50,217 stars | None | Hosted agent backend for its VRM companions, as a plugin | Pull request to moeru-ai/airi (it already has plugin and integration folders) | 4·4·3 | **11** |

Lower priority: Cascadeur (`info@cascadeur.com`), Move AI (demo form only), MakeHuman and MPFB
(GPL code, CC0 output), XR Animator (no license file), VSeeFace (see VRM 0.x above), Animaze
(intake not verified), Mate Engine.

---

## Voice, real-time and streaming

Where a three.ws agent talks and gets watched. The pattern is the same everywhere: a voice
framework or streaming tool that has a face slot, and our full 3D body to put in it.

| Prospect | What they are | Scale (source) | Touchpoint today | The deal | Intake route | F·R·A | Score |
|---|---|---|---|---|---|---|---|
| **LiveKit Agents** | Open-source WebRTC and the Agents voice and video AI framework | livekit/agents 14,665 stars; `livekit-client` 4.36M/wk; Series C USD 100M at USD 1B, 2026-01 *(search-reported)* | [`src/runtime/livekit-voice.js`](../../src/runtime/livekit-voice.js), [`api/agents/_id/livekit-token.js`](../../api/agents/_id/livekit-token.js) | An avatar plugin in their framework, listed on their avatar docs page; Startups credits | Plugin: pull request per their CONTRIBUTING guide (CLA bot, ruff, pdoc). Credits: livekit.com/startups | 5·5·4 | **14** |
| **Discord Activities** | Web apps that run inside Discord | "200 million" monthly users, 2024 *(vendor claim)*; `@discord/embedded-app-sdk` 355K/wk | Agent chat gateway ([`api/gateway/discord.js`](../../api/gateway/discord.js)); no Embedded App SDK yet | /play or a 3D agent as a group Activity, with in-app purchases | Verify app and team, meet Discovery criteria, listed within 24 hours. Purchases: 15% on the first USD 1M, then 30% | 5·5·4 | **14** |
| **Pipecat (Daily)** | Open-source Python voice agent framework | 16,309 stars; `@daily-co/daily-js` 942K/wk | None | A 3D avatar output service, listed as a community integration | COMMUNITY_INTEGRATIONS.md in the pipecat repo: own repo, docs pull request, 30 to 60 second demo video, Discord post. `pipecat-ai@daily.co` printed there | 4·4·5 | **13** |
| **ElevenLabs** | Voice AI: agents, TTS API, creative tools | Series D USD 500M at USD 11B, 2026-02 *(vendor blog)*; `@elevenlabs/client` 1.09M/wk | [`api/tts/eleven.js`](../../api/tts/eleven.js), bring-your-own-key lane | The startup grant (already in the [pipeline](./opportunities.md)); then the Commercial Partner Program, a route the pipeline did not have | Grant: elevenlabs.io/grants-application. Partner: elevenlabs.io/partner-application | 4·5·4 | **13** |
| **Home Assistant** | Open-source home automation | 696,482 opt-in active installs, with `mcp_server` on 27,330 (analytics.home-assistant.io, 2026-10-09) | [`home-assistant-integration/`](../../home-assistant-integration/), [`services/home-satellite`](../../services/home-satellite/), [`packages/home-mcp`](../../packages/home-mcp/) | A listing in the default HACS store | Pull request to hacs/default: a dedicated public repo, HACS Action and Hassfest passing, a release and a brand icon. Reviews are slow | 5·4·3 | **12** |
| **Twitch Extensions** | Panel and overlay web apps inside Twitch | "Millions" daily *(vendor claim)* | None | An AI co-host or 3D agent overlay for streamers, with Bits revenue | Hosted Test, then Submit for Review. All code ships in the zip (no remote scripts), every fetch domain declared, 1 MB mobile limit | 4·5·3 | **12** |
| **StreamElements** | Overlays, alerts and tipping for streamers, now owned by Razer | 2.6M creators daily *(vendor claim)* | None | A paste-in custom widget; no gatekeeper | Overlay Editor custom widget, docs.streamelements.com | 3·4·5 | **12** |
| **OBS Studio** | Open-source streaming app | 77,196 stars | The agent overlay URL ([chart companion](../chart-companion.md)) | A documented Browser Source URL per agent; no listing needed | None needed. Their forum forbids resources written mostly with AI coding tools and any use of OBS branding | 3·4·4 | **11** |
| **Telegram Mini Apps** | Web apps inside Telegram | "Over 1B" monthly users *(vendor claim)* | [`api/gateway/telegram.js`](../../api/gateway/telegram.js) | A crypto-free agent companion Mini App | BotFather; featuring is discretionary. Telegram's bot terms (section 7) restrict wallets in Mini Apps to a chain we do not use, so no wallet or token features | 3·5·3 | **11** |
| **Deepgram** | Speech-to-text, TTS and voice agent APIs | `@deepgram/sdk` 913K/wk | None (our ASR runs on NVIDIA Riva) | Credits plus a Technology partner listing, a track the pipeline did not have | deepgram.com/partners (Technology track form); credits row already in the [pipeline](./opportunities.md) | 3·4·4 | **11** |
| **Cartesia** | Real-time TTS and STT | `@cartesia/cartesia-js` 79,696/wk | None | 12 months of the Scale plan, in exchange for a logo and case study | cartesia.ai/startups/apply. Adding it onboards a new paid API, so it is owner-gated | 3·3·4 | **10** |
| **TEN Framework** | Voice agent framework with avatar extensions | 11,155 stars | None | A 3D avatar extension | Pull request. Its license is "Apache 2.0 with additional restrictions": read it before contributing | 3·3·3 | **9** |
| **Hyperfy** | Open-source multiplayer web worlds, GPL-3.0 | 305 stars; last release 2025-12 | `world.three.ws` runs a pinned Hyperfy server | Upstream our hardening patches | GitHub pull requests (five outside ones are unmerged) | 4·1·2 | **7** |

Lower priority: Streamlabs (most apps need its paid tier, intake status unclear), AssemblyAI
(pick one of it or Deepgram), VRChat (external URLs need an allowlist, so live agents are
impractical), Spatial (Unity-only route).

---

## 3D web, standards and the open source we depend on

These are partnerships of goodwill and credibility. Most are with projects we already depend
on and have never contributed to, so the first move is a contribution, not a request.

| Prospect | What they are | Scale (source) | Touchpoint today | The deal | Intake route | F·R·A | Score |
|---|---|---|---|---|---|---|---|
| **three.js** | The web 3D library | 116,174 stars; `three` 20.1M/wk (npm) | Core dependency (`three ^0.184.0`); no issues or pull requests from us | Recurring GitHub Sponsors tier; upstream fixes from our loader and AR use; a tile on the threejs.org showcase | github.com/sponsors/mrdoob (tiers USD 5 to 1,000 a month); showcase via discourse.threejs.org (forum thread already in the pipeline) | 5·5·4 | **14** |
| **Poly Haven** | CC0 HDRIs, textures and models | 11.2M monthly users *(vendor claim)*; 2,385 assets from api.polyhaven.com | Source of the /objects library ([`scripts/fetch-polyhaven-objects.mjs`](../../scripts/fetch-polyhaven-objects.mjs)) | Visible credit first, then Patreon or a corporate "Sponsored Project" for CC0 models we need. Keep AI output out of anything credited to them: their catalog is certified human-made | polyhaven.com/corporate; `info@polyhaven.com` | 5·4·5 | **14** |
| **pmndrs (react-three-fiber, drei)** | React renderer and helpers for three.js | R3F 32,817 stars; `@react-three/fiber` 5.9M/wk | `@three-ws/react` ships an iframe component, not R3F-native | An R3F-native component for the CC0 library and Forge GLBs; a guest post on the pmnd.rs blog | github.com/sponsors/pmndrs, opencollective.com/react-three-fiber, their Discord | 5·5·3 | **13** |
| **Blender Development Fund** | Funds Blender core development | USD 326,692 a month from 7,652 individuals and 46 corporate members (fund.blender.org) | [`integrations/blender`](../../integrations/blender/) add-on | Bronze corporate membership, EUR 6,000 a year, logo on the fund site | Self-checkout at fund.blender.org/corporate-memberships | 4·4·5 | **13** |
| **Godot** | Open-source game engine, Asset Library and a beta Asset Store | 118,143 stars; 1,829 fund members | Forge "Game" destination | A Godot addon importing three.ws GLBs and the CC0 library | godotengine.org/asset-library (manual review, a few days); store.godotengine.org (beta) | 4·5·4 | **13** |
| **glTF-Transform** | glTF processing SDK by Don McCurdy | 1,982 stars; `@gltf-transform/core` 854K/wk | Direct dependency across the Forge ([`api/forge.js`](../../api/forge.js)) | The USD 500 a month company sponsor tier | github.com/sponsors/donmccurdy | 5·2·5 | **12** |
| **Google model-viewer** | `<model-viewer>` web component for 3D and AR | 8,267 stars; 547K/wk (npm) | Our whole AR path ([AR docs](../ar.md)) | Bug reports and pull requests from production Quick Look and Scene Viewer use; a show-and-tell post | github.com/google/model-viewer/discussions | 5·3·4 | **12** |
| **Babylon.js** | Web 3D engine | 26,147 stars; `@babylonjs/core` 350K/wk | Our GLBs load in it | A sample loading three.ws avatars and CC0 GLBs; a forum demo post | forum.babylonjs.com "Demos and projects" | 3·4·5 | **12** |
| **Khronos Group** | Standards body for glTF and 3D Commerce | glTF repo 7,850 stars | Adopter Program and Project Explorer rows are already in the [pipeline](./opportunities.md) | New: 3D Commerce viewer certification for the `<agent-3d>` viewer, and Associate membership (USD 220 per employee, USD 4,000 minimum, firms up to 100 staff) | khronos.org/members/join; `memberservices@khronosgroup.org` | 4·3·4 | **11** |
| **PlayCanvas and SuperSplat** | Open-source engine and the SuperSplat splat platform | engine 16,998 stars; SuperSplat 10,314 | [/splat](../splat.md) | Publish from /splat to superspl.at through their Publishing API, which launched 2026-08-17 with three partners; a Developer Spotlight post | `support@playcanvas.com`; Discord | 4·3·3 | **10** |
| **meshoptimizer** | Mesh optimization and the meshopt compression we serve by default | 8,527 stars; 12.9M/wk (npm) | Dependency, vendored decoder, pinned `gltfpack` in workers | A visible credit, then upstream bug reports | GitHub issues and Discussions | 4·2·3 | **9** |
| **Needle Engine** | Web 3D from Unity, Blender or code | 7,718/wk (npm) | Research docs only | A joint sample; commercial use needs their Pro plan | needle.tools: book a call, forum, Discord | 3·2·3 | **8** |

---

## Printing and fabrication

The Forge already hands models to slicers and serves print-ready files at `/api/slicer/<id>/`.
These partners turn that into a finished print.

| Prospect | What they are | Scale (source) | Touchpoint today | The deal | Intake route | F·R·A | Score |
|---|---|---|---|---|---|---|---|
| **Craftcloud (All3DP)** | Price comparison and ordering across print and CNC shops | 186 manufacturing partners (craftcloud3d.com) | None, but we serve the STL and 3MF it needs | A "get it printed" button on its public order API, with a referral voucher | Public API v5 at api.craftcloud3d.com/docs (price, offer, cart, order, payment, referral) | 5·3·5 | **13** |
| **Bambu Lab (Bambu Studio, MakerWorld)** | Printer maker; a model site built into its slicer | BambuStudio 5,097 stars | "Open in Bambu Studio" button; non-allowlisted hosts get a "not from a trusted site" prompt (seen in their `GUI_App.cpp`) | Add three.ws to trusted download hosts; MakerWorld uploads labeled "AIGC" (a real print photo is required since 2026-02-05) | BambuStudio GitHub issues and pull requests | 5·5·3 | **13** |
| **OrcaSlicer** | Open-source slicer | 15,903 stars | "Open in OrcaSlicer" ([`src/slicer-handoff.js`](../../src/slicer-handoff.js)); its URL scheme accepts any https host | Recurring sponsorship; a mention as a model source | github.com/sponsors/SoftFever | 5·4·4 | **13** |
| **Prusa Research (PrusaSlicer, Printables)** | Printer maker, model site, open-source slicer | PrusaSlicer 9,394 stars | No button possible: `Downloader.cpp` only allows printables.com and thingiverse.com URLs (read in source 2026-10-09) | A pull request making the trusted-host list configurable | github.com/prusa3d/PrusaSlicer | 5·4·2 | **11** |
| **Treatstock** | Manufacturing and 3D printing marketplace | "Thousands of manufacturers" *(vendor claim)* | None | API partner status plus its affiliate share ("50% of our earning") | treatstock.com help article 113 (become an API partner); affiliate page | 4·2·5 | **11** |
| **Shapeways (with Thangs)** | Industrial print service; owns the Thangs model search | "1M+ customers" *(vendor claim)* | None | "Order a print" through its free API | developers.shapeways.com; `support@thangs.com` | 3·3·4 | **10** |

Printer-maker affiliate programs (Elegoo and Anycubic, 5% or more) fit a later "what printer do I
need" page and stay off the active list.

---

## Marketplaces, game platforms and XR

Places a three.ws model or agent can be listed, sold or run.

| Prospect | What they are | Scale (source) | Touchpoint today | The deal | Intake route | F·R·A | Score |
|---|---|---|---|---|---|---|---|
| **Sketchfab (Epic)** | 3D hosting and embeds | "Millions" of members *(vendor claim)* | Live showcase cron ([`api/cron/sketchfab-showcase.js`](../../api/cron/sketchfab-showcase.js)), now tagged to their policy | Staff picks and a featured collection | Data API v3 | 4·4·5 | **13** |
| **Epic Fab** | Epic's unified marketplace (replaced the Unreal Marketplace, the Sketchfab Store and Quixel) | 420,000+ listings and USD 24M+ paid to creators in 2025 *(search-reported)* | None | Free CC0 packs and labeled AI packs as a funnel back to the Forge | fab.com, Publish; 88% to the creator. Accepts GLB, glTF and USDZ; AI work must be tagged "CreatedWithAI" | 4·5·4 | **13** |
| **Roblox** | UGC game platform with a Creator Store and Open Cloud APIs | About 123M daily users, Q2 2026 (SEC filing) | R15 and R6 rig mapping in [`src/glb-canonicalize.js`](../../src/glb-canonicalize.js) | "Send to Roblox" through the Open Cloud Assets API (accepts GLB up to 20 MB); an approved OAuth app | Open Cloud OAuth review: ID-verified developer, a demo video of a minute or less, scope justifications | 4·5·4 | **13** |
| **Unity Asset Store** | Asset marketplace for Unity | 1.7M+ monthly users *(vendor claim)* | Forge "Game" destination | CC0 and Forge packs, converted to FBX (their guidelines accept only FBX, DAE, ABC and OBJ meshes) | publisher.unity.com; 70% to the publisher. AI work needs an AI description, and mass-produced AI may be rejected | 3·5·4 | **12** |
| **Meta Quest (Horizon Store)** | VR headsets and a store that accepts web apps | Not verified | WebXR through model-viewer and /ar | three.ws WebXR scenes listed as a Quest web app | developers.meta.com/horizon (PWA guide, Bubblewrap `--metaquest`) | 3·4·4 | **11** |
| **itch.io** | Indie game and asset store | 16,789 results under 3D game assets | None | Free CC0 3D packs that link back | itch.io/game/new; AI disclosure is mandatory on asset pages | 3·3·5 | **11** |
| **Snap (Lens Studio, Camera Kit)** | AR Lens authoring and embeddable Snap AR | "More than 250M" use AR daily *(vendor claim)* | None | Forge models in Lens Studio; agent-made Lenses | developers.snap.com, my-lenses.snapchat.com/camera-kit. Test a GLB import first: GLB support is not confirmed | 3·5·3 | **11** |
| **PICO** | VR and MR headsets with a store that accepts web apps | Not verified | None | three.ws WebXR scenes as a PICO web app | developer.picoxr.com/console | 3·3·4 | **10** |

Lower priority: Apple visionOS and AR Quick Look (no partner intake, but Quick Look banners can
carry a call to action), XREAL (Unity only, no WebXR), Zappar (no partner program).

---

## Site builders, design tools and commerce

Every site builder is a place to drop an `<agent-3d>` or a Forge model. Shopify stands apart
because its product pages already render 3D.

| Prospect | What they are | Scale (source) | Touchpoint today | The deal | Intake route | F·R·A | Score |
|---|---|---|---|---|---|---|---|
| **Shopify** | Commerce platform and App Store | 100,000+ partners, USD 1.3B paid to partners in 2025 *(vendor claim)* | [Share and embed](../share-and-embed.md) lists Shopify as an iframe target; no app | An app that generates a product's GLB and USDZ from its photo and uploads them as product media (native, up to 500 MB, with AR on iOS and Android) | partners.shopify.com/signup; App Store review needs a screencast and test credentials, and billing must run through Shopify | 5·5·4 | **14** |
| **WordPress.org** | CMS plugin directory | The top 3D viewer plugin has 9,000+ active installs | oEmbed endpoints ([`api/widgets/oembed.js`](../../api/widgets/oembed.js)) | A block and shortcode for `<agent-3d>` and Forge models in an uncrowded niche | wordpress.org/plugins/developers/add (manual review, 1 to 10 days) | 4·4·5 | **13** |
| **Wix** | Site builder and App Market | 300M+ users *(vendor claim)* | Our embed editor mentions Wix | A 3D and agent embed app | Submit from the Wix app dashboard; review is automated (doc updated 2026-07-28) | 3·5·5 | **13** |
| **Webflow** | Visual site builder with an Apps marketplace | 3.5M users *(search-reported)* | Iframe embed | A Designer Extension that places `<agent-3d>` or a GLB viewer (Webflow has no native GLB element) | developers.webflow.com/submit (10 to 15 business days) | 4·4·4 | **12** |
| **Framer** | Site builder and marketplace | 23,100 community resources *(vendor claim)* | Iframe embed | An `<agent-3d>` component and plugin (auto-enrolls in their Creator Program) | framer.com/marketplace dashboard | 4·3·5 | **12** |
| **Figma** | Design tool and plugin community | Not verified | None | A plugin that renders a Forge model into a frame | Publish from the desktop app (two-factor required) | 3·5·4 | **12** |
| **Canva** | Design platform and Apps SDK | Not verified | None | An "insert 3D render" app backed by the Forge | canva.dev, submitting apps guide | 3·5·3 | **11** |
| **Adobe Express add-ons** | Add-on marketplace inside Express | "Millions of users" *(vendor claim)* | None | A 3D render add-on; Adobe takes no commission | developer.adobe.com/express/add-ons | 2·4·4 | **10** |

---

## Agent frameworks, coding tools and registries

This is where three.ws already earns its strongest proof: 13,898 MCP tool calls in September at
99.4% handler success, from 13 OAuth clients. Every row below is a place where an agent, an
editor or an automation tool picks up those servers. Most of them are free listings that take
nothing more than a pull request or a form.

| Prospect | What they are | Scale (source) | Touchpoint today | The deal | Intake route | F·R·A | Score |
|---|---|---|---|---|---|---|---|
| **GitHub** | Code host, Copilot, and a curated MCP registry | "100M+ developers" *(Technology Partners page)*; github-mcp-server 33,476 stars | Approved for Open Source Friday; VS Code extension; our servers are in the official MCP registry | Inclusion in GitHub's curated MCP registry, which lists 394 servers and none of ours (searched 2026-10-09), and a Technology Partner listing | github.com/partners/technology-partners/apply | 5·5·3 | **13** |
| **Vercel AI SDK** | TypeScript AI toolkit | vercel/ai 27,210 stars; `ai` 29.1M/wk, `@ai-sdk/mcp` 4.78M/wk (npm) | `ai` and `@ai-sdk/*` power [`api/brain/chat.js`](../../api/brain/chat.js); the pipeline lists a tools-registry row | A `@three-ws` AI SDK tools package, listed under "Ready-to-Use Tool Packages". It also works as a bring-your-own MCP in v0 | Pull request to the AI SDK docs. We do not host on Vercel, so their startup credits are worth little | 5·5·4 | **14** |
| **LangChain** | LangChain, LangGraph and LangSmith | langchain 147,470 stars; `@langchain/core` 6.15M/wk, `@langchain/mcp-adapters` 263K/wk | [`api/3d/openapi.js`](../../api/3d/openapi.js) and the [3D API docs](../3d-api.md) point to its OpenAPI toolkit | A LangChain tools package and a docs listing | Publish on npm, then file their "Integration listing issue". **Hand-written listing pull requests are now closed automatically**, so the pipeline row's "open a docs PR" step needs changing | 5·5·4 | **14** |
| **Hermes Agent (Nous Research)** | Open-source personal agent | 252,229 stars | The three-ws CLI already has a `hermes` client | An entry in its curated MCP catalog, plus our skills | Pull request to `optional-mcps/` (65 entries; an outside pull request merged 2026-10-02). Skills publish self-serve through a GitHub tap or `/.well-known/skills/index.json` | 5·5·4 | **14** |
| **OpenClaw (ClawHub)** | Open-source personal agent and its skills registry | 391,518 stars | None | Our 3D studio skills on ClawHub | Self-serve: `clawhub skill publish`. Publishing relicenses the skill as MIT-0, so publish only skills we are happy to release that way | 4·5·5 | **14** |
| **Google ADK** | Google's Agent Development Kit | adk-python 21,757 stars; `@google/adk` 338,685/wk; 107 integration cards | Production runs on Google Cloud, and we are an existing Google Cloud partner | A runnable MCP integration page for our studio server | Pull request to `docs/integrations/` in google/adk-docs, with a logo and working code | 5·4·5 | **14** |
| **Composio** | Tool and integration layer for agents | 30,474 stars; `@composio/core` 1.04M/wk; "1,500+ integrated products" *(vendor claim)* | None | Composio builds and lists a three.ws toolkit, and offers "launch announcements, case studies, webinars" | The Toolkit Partnership form at composio.dev/partnerships/toolkit; `partnerships@composio.dev` | 4·4·5 | **13** |
| **OpenCode** | Open-source coding agent | 212,363 stars; `opencode-ai` 3.07M/wk; "16M monthly devs" *(vendor claim)* | None | A recipe on its ecosystem page | Open an issue first, then a pull request to `ecosystem.mdx` on the `dev` branch (outside pull requests merged 2026-07-29 and 2026-10-05) | 4·5·4 | **13** |
| **Dify** | Open-source LLM app platform | 157,998 stars; about 10 plugin pull requests merged on 2026-10-07 and 08 | None | A `.difypkg` 3D plugin and the Marketplace Partner track | Pull request to langgenius/dify-plugins; partner replies "within five business days"; `business@dify.ai` | 4·5·5 | **14** |
| **Postman** | API platform with an MCP catalog and the API Network | "Millions of developers" *(vendor claim)* | A pipeline row exists, not started | A public MCP collection and an OpenAPI workspace, forked into the official catalog | Email `api-network@postman.com` once the collection is ready | 4·4·5 | **13** |
| **Microsoft (Copilot Studio, Microsoft 365 Copilot, Teams)** | Enterprise agent surfaces | Power Platform "over 1,200 connectors"; Microsoft for Startups "up to $150K" in credits *(vendor claims)* | VS Code publisher `threews`; Azure is on the listings roadmap | A certified MCP server published across Foundry, Copilot chat and Copilot Studio, then a Teams agent | Partner Center verified publisher, the "Microsoft 365 and Copilot program". The legacy Copilot Studio MCP route closes **2026-10-31**. Startups: startups.microsoft.com | 4·5·3 | **12** |
| **Mastra** | TypeScript agent framework | 28,668 stars; `@mastra/core` 1.95M/wk, `@mastra/mcp` 645K/wk | None | A 3D avatar agent template, aiming for a "Partner" tag | Template contributions per mastra.ai/templates and its CONTRIBUTING file | 4·4·3 | **11** |
| **Cursor** | AI code editor | About 190 plugins in its marketplace (counted) | The three-ws CLI `cursor` client and /connect | An open-source plugin bundling our MCP server and skills | Plugins are manually reviewed and must be open source; staff say submissions now go through cursor.directory | 5·5·3 | **13** |
| **Kilo Code** | Coding agent for VS Code, JetBrains and the terminal; inherited Roo Code's users | 27,536 stars; "5M+" users *(vendor claim)* | None | MCP and skills marketplace entries | Pull request with `mcps/<id>/MCP.yaml` to Kilo-Org/kilo-marketplace (78 merged, including outside ones) | 4·4·4 | **12** |
| **OpenHands** | Open-source coding agent | 90,383 stars | None | Skill and MCP catalog entries | Pull request to OpenHands/extensions; each entry needs a `docsUrl` | 4·4·4 | **12** |
| **CopilotKit and AG-UI** | Agent UI protocol and React kit | AG-UI 16,413 stars, `@ag-ui/core` 2.42M/wk; CopilotKit 37,866 stars | None | `<agent-3d>` as an embodied AG-UI client, shown in their dojo | Open an issue and tag a code owner, then a pull request to `integrations/` with dojo and end-to-end tests | 4·4·3 | **11** |
| **Pipedream** | Integration platform with automatic MCP | "3,000+ integrated APIs" *(vendor claim)* | None | Pipedream builds the integration, and it becomes MCP tools automatically | App partners program; contact through pipedream.com/support | 4·4·4 | **12** |
| **Zapier** | Automation and Zapier MCP | "9,000+ apps" *(vendor claim)*; `@zapier/zapier-sdk` 256,867/wk | The companion ingest recipe ([`api/companion/ingest.js`](../../api/companion/ingest.js)) | Free Forge triggers and actions as a public integration (partner program enrollment is automatic) | docs.zapier.com/platform/publish/public-integration; review in a week or less, then a 90-day beta. Keep payments out: "financial transactions" is a prohibited category | 3·5·4 | **12** |
| **n8n** | Workflow automation | 206,818 stars; "10k+" templates *(vendor claim)* | Named in [`api/companion/ingest.js`](../../api/companion/ingest.js) | A verified community node and creator templates | Creator Portal. A verified node must be published from a GitHub Actions workflow with provenance, which our no-Actions rule forbids, so it needs an owner exception | 4·5·2 | **11** |
| **Langflow** | Visual agent builder | 155,432 stars | None | A 3D component bundle and a starter template | Pull request: a bundle under `src/lfx/src/lfx/components/` plus a starter project | 3·4·4 | **11** |
| **Microsoft Agent Framework** | Successor to AutoGen and Semantic Kernel | 14,034 stars | None | A sample agent driving our MCP server | Pull request to `python/samples/community-projects.md` (two entries today) | 3·3·5 | **11** |
| **Notion** | Workspace | Embeds "from over 1,900 domains via the Iframely service" *(vendor claim)* | oEmbed in [`api/agent-oembed.js`](../../api/agent-oembed.js) | Live 3D embeds in Notion pages through Iframely; a Marketplace connection later | iframely.com/qa/request; Marketplace review 5 to 10 business days | 4·4·4 | **12** |
| **OpenRouter** | LLM router | "10M+ global users" *(vendor claim)* | Heavy use in [`api/_lib/llm.js`](../../api/_lib/llm.js); a pipeline row exists | Our app page and Top Apps ranking, by sending attribution headers (`X-OpenRouter-Title` replaces `X-Title`) | Headers are self-serve; the awesome-openrouter pull request needs traction evidence | 4·5·4 | **13** |
| **Mistral AI** | Models and Le Chat | `@mistralai/mistralai` 8.34M/wk | A rung in the LLM chain | Integration tier of their partner program; our remote MCP already does OAuth 2.1 with dynamic client registration | Partner form; the Le Chat connector directory has no submission route | 4·4·3 | **11** |
| **Raycast** | Mac launcher with AI | `@raycast/api` 65,947/wk | None | A "forge a model" store extension | `npm run publish` in the extension opens a pull request to raycast/extensions | 3·3·4 | **10** |
| **Figma** (agent and Make) | Design tool | 21 verified partner connectors | None | A verified MCP connector, alongside the plugin in [site builders](#site-builders-design-tools-and-commerce) | The form linked from Figma's verified-connectors help article | 4·5·3 | **12** |
| **JetBrains** | IDEs | Not verified | None | A Marketplace plugin, with the startup discount (50% off for private companies under five years old) | Manual upload and review; `marketplace@jetbrains.com` | 3·4·3 | **10** |
| **Cline** | Coding agent | 70,072 stars; "11M+ developers" *(vendor claim)* | None | A marketplace entry | Pull request to cline/marketplace. Every one of the 8 merged so far came from Cline staff, with 181 open | 4·5·2 | **11** |
| **Zed** | Code editor | 91,497 stars | The pipeline lists a context-server extension row | A context-server extension | Pull request to zed-industries/extensions. Zed plans to read MCP servers from the official registry (their issue #59351), where we are already listed, so the extension may be short-lived | 3·4·4 | **11** |
| **CrewAI** | Multi-agent framework | 59,505 stars; "450M+ agentic workflows per month" *(vendor claim)* | None | A listing in its MCP catalog; our remote server already works through `mcps=[...]` | No documented catalog route; community.crewai.com | 4·4·2 | **10** |

Already covered elsewhere: Hugging Face is in the [generation table](#3d-generation-engines-and-inference-hosts),
Figma's plugin and Slack sit with the design tools, and OpenAI and Alibaba are live partners on
the [partner cards](../partners.md).

Lower priority: Replit (curated directory with no submission route; an "Add to Replit" badge works
today), Lovable (its partner program is for service firms), Slack (an MCP-only app is "unsuitable"
and review runs up to 10 weeks, so build a real Slack agent first), Perplexity (connector requests
by email to `api@perplexity.ai`), xAI (we have a working Grok MCP, but its connector catalog takes
no outside servers), LlamaIndex (monorepo closed to new integrations), Make (partner status comes
after a reviewed app), Linear (a weak fit).

---

## Screened out

Recorded so nobody re-researches them.

| Prospect | Why not |
|---|---|
| Ready Player Me | Shut down 2026-01-31, so there is no company to partner with. Its users are the opportunity ([time-sensitive](#time-sensitive)) |
| Meshcapade, RADiCAL | Platforms closed in 2026; their users are the opportunity |
| Hume voice and TTS, PlayAI | Hume retires TTS and EVI on 2026-11-13; play.ht no longer resolves |
| Rec Room | Servers closed 2026-06-01 |
| Continue, Roo Code | Continue joined Cursor and its repo is read-only; Roo Code shut down |
| Flowise, Activepieces | Flowise reached end of life on 2026-08-31; Activepieces paused outside pull requests on 2026-07-16 |
| Windsurf, Warp, Bolt.new | Windsurf now redirects to a product with no vendor intake; Warp's integration and partner pages return 404; Bolt.new has no partner route and its repo has been idle since 2024-12 |
| Groq | Still three rungs of our LLM chain, but its startup and partner pages now redirect to the homepage, so there is nothing to apply to |
| TurboSquid | Bans AI-generated content outright |
| Thingiverse | Now owned by MyMiniFactory, which says it intends to cut and eventually remove AI uploads |
| 8th Wall | Hosting retired 2026-02-28; the code is now MIT open source, with nobody to partner with |
| VTube Studio | Loads Live2D models only, so our 3D bodies do not carry over |
| VNyan | States it is "developed without generative AI" |
| Squarespace | No public extension intake |
| Union Avatars, Masterpiece X, Sudo AI, Shap-E, Plask | Offline, moved to legacy, pivoted away from 3D, or dormant |
| Direct competitors | 14 real-time 2D video-avatar vendors, 4 3D character and companion platforms, and 3 design or marketplace tools that run their own 3D generators. They sell what three.ws sells, so they are not named here. The two notes worth keeping: all 16 avatar providers on LiveKit's avatar page are 2D video faces, which is the opening for our 3D body, and one of them has a LiveKit plugin with about 41,700 downloads a week, which shows how big that slot is |

---

## Keeping this list honest

- **Re-verify before outreach.** Scale numbers and intake routes rot fastest. Before a first
  message, re-read the intake page and update the row with the date.
- **Move, do not copy.** When a prospect gets a first action, add a row to
  [`marketing/growth/opportunities.csv`](../../marketing/growth/opportunities.csv) and a line in
  the [pipeline](./opportunities.md), then link to it from here.
- **A closed door goes to Screened out**, with the reason and the date, so the next sweep skips it.
- **Never invent a contact.** An address goes on this page only if it was printed on the
  company's own page.

## Related

- [Tripo partnership brief](./tripo.md): the first prospect, worked in full.
- [Partnership outreach plan](./outreach-plan.md): waves, cadence, messages and the work orders.
- [Partnership and listing pipeline](./opportunities.md): what is in flight and on whom.
- [Partner ecosystem](../partners.md): the eight live partner cards and the framing rules.
- [30-day proof brief](./proof-brief-2026-10.md): the numbers every pitch quotes.
- [3D landscape, October 2026](../research/3d-landscape-2026-10.md): the open-source and
  commercial 3D sweep behind the best3d engineering campaign.
