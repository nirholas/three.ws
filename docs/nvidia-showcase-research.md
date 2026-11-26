# NVIDIA showcases and co-marketing: what gets featured, how others use NVIDIA, and what we can build

Researched 2026-11-26. Every claim below was read on an NVIDIA page or repository that day unless it is marked secondhand. Where a page did not state something (a license, a format, a deadline), this document says so instead of guessing.

This is the companion to [nvidia-visibility-map.md](nvidia-visibility-map.md). That file lists every recognition surface and its gate. This one answers a different question: what are other companies actually doing with NVIDIA technology that NVIDIA chooses to show, and which of those things could three.ws build without touching what already works.

The builds at the end are filed as independent work orders `871` to `879` in [prompts/finish/](../prompts/finish/).

---

## 1. The short version

1. **NVIDIA features a startup when the startup's story is a NVIDIA product story.** The spotlight format is "startup does X, N times faster, with NVIDIA product Y". No named product and no number means no feature.
2. **NVIDIA's 2026 attention is on agents and physical AI, not on generative 3D.** Almost every new blueprint is an agent blueprint. No 2026 NVIDIA post featuring a generative-3D startup was found. Our 3D work gets attention when it is framed as "what an agent can do" or "simulation-ready assets", which are the two things NVIDIA is promoting.
3. **Two NVIDIA technologies we depend on or compete with are now open and commercially usable:** the Audio2Face-3D SDK (MIT, with open weights) and the Kimodo text-to-motion model (Apache-2.0 code, commercial weights for one variant). Both fix or strengthen something we already ship.
4. **We already run the hosted version of NVIDIA's 3D Object Generation Blueprint.** NVIDIA's version needs an RTX PC with 16 GB of VRAM and 48 GB of RAM. Ours runs in a browser tab. That contrast is a story NVIDIA's own material sets up.
5. **The spotlight blog is slow.** One Inception-tagged developer blog post was found since September 2025. The realistic amplification routes are community repositories, contests, forum posts and day-0 adoption posts, in that order of how much is in our control.

---

## 2. How NVIDIA tells startup stories

### Inception Startup Showcase

[nvidia.com/en-us/startups/showcase](https://www.nvidia.com/en-us/startups/showcase/) featured five startups on 2026-11-26: Buzz Solutions and Roboflow as podcast episodes, Fernride, Qure and Seurat as short videos. The page names no NVIDIA product beside them and states no selection process. It is a curated page, not something to apply to.

### Developer blog spotlights

The [nvidia-inception tag](https://developer.nvidia.com/blog/tag/nvidia-inception) on the developer blog shows the pattern that repeats:

| Post | Date | The NVIDIA product in the title |
|---|---|---|
| Spotlight: Personal AI Brings AI Receptionists to Small Business Owners with NVIDIA Riva | April 2025 | Riva |
| Spotlight: clicOH Accelerates Last-Mile Delivery 20x with NVIDIA cuOpt | 2025 | cuOpt |
| GliaCloud with Omniverse Libraries | July 2025 | Omniverse |
| Outerbounds with DGX Cloud Lepton | September 2025 | DGX Cloud Lepton |
| Sarvam AI | February 18, 2026 | (model training and inference stack) |

What the titles have in common: one startup, one named NVIDIA product, one outcome a reader can repeat ("20x", "to small business owners"). The cadence is low. Planning around being picked for one is not a plan.

### GTC

- **GTC 2026 (San Jose, March):** an Inception Pavilion with more than 55 startups, a session called "Think You Know AI? Hear From 25 Startups", and "Startup and VC Pitches, Presented by NVIDIA Inception" ([nvidia.com/gtc/startups](https://www.nvidia.com/gtc/startups)).
- **GTC Washington, D.C.: December 1 to 3, 2026, workshops November 30.** It has a Startup Pitch Session presented by Inception, a "Where Innovation Meets Investment" program and an Inception Startup Pavilion with an information desk ([nvidia.com/gtc/dc/startups](https://www.nvidia.com/gtc/dc/startups/)). The page lists no application deadline. Registration is at [register.nvidia.com](https://register.nvidia.com/flow/nvidia/gtcdc26/reg/). This is days away: attending is an owner decision, and the information desk is the one place to ask an Inception person face to face what gets a startup into the March pavilion.
- **GTC 2027:** March 15 to 18. The poster and pavilion routes are covered in the visibility map.

### Contests

Contests are the one surface where NVIDIA commits in advance to feature whoever wins.

- **NVIDIA Cosmos Cookoff** (January 29 to early March 2026): more than 1,600 participants. The winners (a palletizing team, a rescue drone project, and a voice-controlled video intelligence build from LiveKit) got a livestream in mid-April and a LinkedIn article ([forum announcement](https://forums.developer.nvidia.com/t/the-results-are-in-meet-the-nvidia-cosmos-cookoff-winners-see-them-live-on-april-16/366130)). Sponsors were Nebius and Milestone Systems.
- **G-Assist Plug-in Hackathon** (2025): the top three were featured on NVIDIA's social accounts ([announcement](https://blogs.nvidia.com/blog/rtx-ai-garage-g-assist-hackathon-plug-in/)). NVIDIA's plug-in builder turns an MCP server into a G-Assist plug-in ([post](https://blogs.nvidia.com/blog/rtx-ai-garage-g-assist-plugin-builder)), and plug-ins are contributed to [github.com/NVIDIA/g-assist](https://github.com/NVIDIA/g-assist).

No 2026 or 2027 contest was open on the pages read on 2026-11-26. The pattern says one will come, and contests are announced on the forums and the blog first. Order 877 builds the watch so we hear about it the day it opens.

---

## 3. How others are using NVIDIA technology in 2026

### Agents are the center of gravity

NVIDIA announced its **Agent Toolkit** at GTC on March 16, 2026 ([press release](https://nvidianews.nvidia.com/news/ai-agents), [product page](https://www.nvidia.com/en-us/ai/nemoclaw/)):

- **NemoClaw**: described as the full agent deployment package (models, harness, tools and runtime). Source at [github.com/NVIDIA/NemoClaw](https://github.com/NVIDIA/NemoClaw).
- **OpenShell**: an open-source runtime that enforces policy on what an agent may do with files, networks, credentials and tools. Source at [github.com/NVIDIA/OpenShell](https://github.com/NVIDIA/OpenShell); reference architecture in [this developer blog post](https://developer.nvidia.com/blog/how-nvidia-openshell-reference-architecture-secures-and-governs-ai-agent-workloads-at-scale/).
- **AI-Q** deep research blueprint and the **Nemotron** model family.
- **Community use cases** live at [github.com/NVIDIA/nemoclaw-community](https://github.com/NVIDIA/nemoclaw-community). This is the only third-party contribution channel the announcement names.

The partners NVIDIA named are large enterprises (Adobe, Atlassian, Box, Salesforce, SAP, ServiceNow, LangChain and others). The pages read did not mention MCP or a skills registry and did not state licenses; those have to be read from the repositories.

The [blueprint catalog](https://build.nvidia.com/blueprints) (about 40 items; source in the [NVIDIA-AI-Blueprints](https://github.com/NVIDIA-AI-Blueprints) GitHub organization, 38 repositories, mostly Apache-2.0) is dominated by agents:

| Blueprint | What it is |
|---|---|
| NemoClaw for OpenClaw, for Hermes Agent, for LangChain Deep Agents | Agent harnesses running inside the NVIDIA runtime; the Hermes one is described as creating reusable skills |
| NVIDIA Deep Researcher Agent | Built on LangChain Deep Agents and the NeMo Agent Toolkit, running Nemotron models |
| Nemotron Voice Agent | Real-time voice agents |
| Retail Agentic Commerce | Agent checkout over the ACP and UCP protocols |
| Nsight Copilot | A self-hosted MCP server over CUDA documentation |
| Video Search and Summarization | Video agents |
| Content Localization | Lip sync to translated audio |

On 2026-11-26 the list held no digital-human, avatar, 3D-generation or world-generation blueprint.

### Physical AI and simulation-ready assets

At SIGGRAPH on July 20, 2026, NVIDIA released **Omniverse libraries for agents** (secondhand, from reprints of the release: [Edge AI and Vision Alliance](https://www.edge-ai-vision.com/2026/07/nvidia-agent-toolkit-expands-with-new-omniverse-libraries-putting-ai-agents-to-work-building-simulation-ready-worlds/), [GamesBeat](https://gamesbeat.com/nvidia-launches-omniverse-libraries-so-ai-agents-can-build-simulation-ready-worlds/); see also NVIDIA's [SIGGRAPH roundup](https://blogs.nvidia.com/blog/siggraph-news-2026/)):

- **ovrtx** (RTX sensor simulation) and **ovphysx** (GPU physics), plus CAD-to-SimReady skills, described as openly available under [github.com/NVIDIA-Omniverse](https://github.com/NVIDIA-Omniverse/). A Blender example sits at [omniverse-labs/projects/ov-blender-example](https://github.com/NVIDIA-Omniverse/omniverse-labs/tree/main/projects/ov-blender-example).
- **Startups named as users:** Lightwheel (SimReadyGen: simulation-ready assets from text prompts), Palatial (CAD to SimReady at scale), ForgeCAD and Moonlake AI, alongside SideFX and PTC. The release says startups "including those part of the NVIDIA Inception program" are using the libraries.
- License and the skill format were not stated on the pages read.

Lightwheel's story is the closest thing to ours that NVIDIA chose to tell this year: text in, a simulation-ready asset out. We already export Forge models to OpenUSD with convex physics ([workers/usd-export](../workers/usd-export/README.md)) and ingest NVIDIA's own SimReady library ([simready-assets.md](simready-assets.md)).

Other 2026 physical AI releases: Cosmos 3 and Cosmos 3 Edge, Isaac GR00T N1.7 and a Physical AI Data Factory blueprint ([GTC 2026 roundup](https://blogs.nvidia.com/blog/gtc-2026-news/), [virtual worlds post](https://blogs.nvidia.com/blog/gtc-2026-virtual-worlds-physical-ai/)).

### Generative 3D: the 3D Object Generation Blueprint

Published September 3, 2025 in the RTX AI Garage series ([post](https://blogs.nvidia.com/blog/rtx-ai-garage-blueprint-3d-object-nim-microsoft-trellis/), [blueprint](https://build.nvidia.com/nvidia/object-generation-3d), [source](https://github.com/NVIDIA-AI-Blueprints/3d-object-generation)):

- A Llama 3.1 8B NIM brainstorms up to 20 objects from one scene idea, NVIDIA SANA-Sprint draws previews, the Microsoft TRELLIS NIM turns each into 3D, and the result exports to Blender.
- Requirements: an RTX GPU with 16 GB or more of VRAM, 48 GB of RAM, WSL, TensorRT and ComfyUI.
- The numbers NVIDIA quotes: the TRELLIS NIM is "20% faster", about 6 seconds saved per object on an RTX 5090.
- SANA is under NVIDIA's NSCL v2-custom license. Whether that permits commercial hosting was not verified. Order [870](../prompts/finish/870-nvidia-20-self-hosted-image-engine.md) must read it before choosing SANA.

Forge is this same pipeline (prompt, reference image, TRELLIS) served from our own NVIDIA GPUs to a browser. The piece we do not have is the first step: one scene idea becoming a matched set of objects.

### Digital humans

- **Audio2Face is open source** since September 24, 2025 ([announcement](https://developer.nvidia.com/blog/nvidia-open-sources-audio2face-animation-model/), [forum thread](https://forums.developer.nvidia.com/t/nvidia-audio2face-is-now-open-source/345978)). The SDK at [github.com/NVIDIA/Audio2Face-3D-SDK](https://github.com/NVIDIA/Audio2Face-3D-SDK) is MIT licensed. The weights ([Audio2Face-3D-v3.0](https://huggingface.co/nvidia/Audio2Face-3D-v3.0) and the v2 regression models, plus Audio2Emotion) are under the [NVIDIA Open Model License](https://www.nvidia.com/en-us/agreements/enterprise-software/nvidia-open-model-license), and the model card says the model "is ready for commercial/non-commercial use". Requirements: Linux or Windows, CUDA 12.8 or newer below 13, TensorRT 10.13 or newer below 11, Python 3.8 to 3.10, 4 GB or more of GPU memory. Named users: Convai, Inworld AI, Reallusion, UneeQ, NetEase, Codemasters, Streamlabs.
- **The reference pipeline** ([developer blog, November 2024](https://developer.nvidia.com/blog/expanding-ai-agent-interface-options-with-2d-and-3d-digital-human-avatars/)): Riva speech recognition, retrieval, an LLM NIM, Riva speech, Audio2Face-3D, an animation service and an Omniverse or Unreal renderer. Every named partner renders in a game engine or on a GPU server. A digital human that renders in the visitor's own browser tab is the part nobody on NVIDIA's partner list does.

This matters to us for a practical reason: our hosted Audio2Face lane answered 7 of 55 health probes in the 7 days to 2026-11-26. We can now run the same model ourselves.

### Motion: Kimodo

NVIDIA released Kimodo, a text-to-motion diffusion model trained on 700 hours of motion capture, on March 16, 2026 ([project page](https://research.nvidia.com/labs/sil/projects/kimodo/), [code, Apache-2.0](https://github.com/nv-tlabs/kimodo)).

- [Kimodo-SOMA-SEED-v1.1](https://huggingface.co/nvidia/Kimodo-SOMA-SEED-v1.1) (April 10, 2026) is the variant marked ready for commercial use under the NVIDIA Open Model License: a 30-joint SOMA skeleton, root translation plus joint rotations, 30 frames per second, 10 seconds maximum, 282 million parameters.
- The SMPL-X and G1 variants are research-only. Do not use them.
- The repository's readme puts memory at about 17 GB of VRAM, most of it the text encoder.
- There is no BVH, FBX or glTF export. NVIDIA publishes a retargeter at [github.com/NVIDIA/soma-retargeter](https://github.com/NVIDIA/soma-retargeter).

We already serve text to motion from [workers/model-text2motion](../workers/model-text2motion/README.md) (MDM and MoMask), retargeted to any rig by `src/animation-retarget.js`. Kimodo would be a second engine beside it, and a NVIDIA-published model in a lane that has none today.

---

## 4. What we can build

Ranked by how much each one improves the product for users first, and how reshareable it is second. Every one is an addition. None changes a protected Forge lane ([ops/forge-protected-lanes.md](ops/forge-protected-lanes.md)), and none raises a Cloud Run floor.

| # | Build | Why it is worth doing | NVIDIA technology | Order |
|---|---|---|---|---|
| 1 | Our own Audio2Face-3D service from the open SDK | The hosted lane fails most probes, so talking avatars mostly fall back today. Fixes a broken feature. | Audio2Face-3D SDK, TensorRT, an NVIDIA GPU | [871](../prompts/finish/871-nvidia-21-self-hosted-audio2face-worker.md) |
| 2 | A Kimodo motion engine beside the current one | A second, newer motion engine with a measured comparison; the owner decides which serves. | Kimodo | [872](../prompts/finish/872-nvidia-22-kimodo-motion-engine.md) |
| 3 | One scene idea to a matched kit of props | The one step of NVIDIA's own 3D blueprint we lack, with no RTX PC needed. Raises what a single visit produces. | Nemotron on NIM, TRELLIS on our GPUs, OpenUSD | [873](../prompts/finish/873-nvidia-23-scene-kit-from-one-prompt.md) |
| 4 | three.ws tools for NemoClaw agents under an OpenShell policy | Puts us inside the thing NVIDIA is promoting hardest, through the one community channel it named. | NemoClaw, OpenShell | [874](../prompts/finish/874-nvidia-24-nemoclaw-openshell-integration.md) |
| 5 | Physics-checked simulation-ready assets from text | The Lightwheel story, on a pipeline we already have. | ovphysx, ovrtx, OpenUSD | [875](../prompts/finish/875-nvidia-25-physics-validated-simready.md) |
| 6 | A 3D face for the Nemotron Voice Agent blueprint | NVIDIA's voice agent has no face, and no avatar blueprint exists. We already ship Pipecat and LiveKit plugins. | Nemotron Voice Agent blueprint, Riva | [876](../prompts/finish/876-nvidia-26-voice-agent-blueprint-face.md) |
| 7 | A watch for NVIDIA contests and calls for submissions | Contests are the only surface with a guaranteed feature for winners, and we have missed two. | (none; an alert) | [877](../prompts/finish/877-nvidia-27-nvidia-contest-and-event-watch.md) |
| 8 | An avatar that says one line in every supported language | NVIDIA's Content Localization blueprint fixes lip sync on translated video after the fact. A 3D face animated from the audio gets it right by construction. | Magpie multilingual speech, Audio2Face-3D | [878](../prompts/finish/878-nvidia-28-multilingual-talking-avatar.md) |
| 9 | An open pack of simulation-ready props made by Forge | NVIDIA publishes its own SimReady library as an open dataset; robotics teams never have enough varied objects. | OpenUSD, TRELLIS on our GPUs | [879](../prompts/finish/879-nvidia-29-open-simready-prop-dataset.md) |

The plan for these nine (what to run first, what collides, what waits on the owner, what each lets us say) and a design doc per build are in [nvidia/builds/](nvidia/builds/README.md).

Considered and not filed:

- **A G-Assist plug-in from our MCP server.** NVIDIA's builder converts MCP servers, so the work is small, but it can only be tested on a Windows RTX PC, which we do not have. Worth doing by whoever has that machine.
- **The Retail Agentic Commerce blueprint.** Our agents already transact, but NVIDIA-facing material must stay free of payment and token vocabulary, so this is a poor fit for co-marketing.
- **Tokkio or an Omniverse renderer for avatars.** It would replace the browser rendering that makes us different.
- **DGX Cloud Lepton, a paid NIM license.** New paid services need owner approval and nothing here requires them.

---

## 5. What stays true while building

- **The claim rule.** A NVIDIA technology is "used" only once it runs in production for real traffic. Until then it is "under evaluation" in [nvidia-apps-catalog-listing.md](nvidia-apps-catalog-listing.md).
- **Licenses are read, not assumed.** Each order quotes the license clause it relies on. Two are known to need care: SANA (NSCL v2-custom) and the research-only Kimodo variants.
- **Community contributions are owner actions.** A pull request to an NVIDIA repository, a forum post and a contest entry are prepared in the repo and sent by the owner.

## 6. Not verified

- Whether NemoClaw registers tools through MCP, a skill format, or something else. The product pages did not say.
- The license of ovrtx, ovphysx and the NemoClaw and OpenShell repositories.
- Whether the Audio2Face-3D SDK emits the same ARKit blendshape weights as the hosted service our player consumes.
- Whether GTC Washington, D.C. still accepts startup pitch or pavilion entries.
- The Showcase page and the digital-humans use-case page were long enough that part of each was read through a summary.

## Related

- [nvidia-visibility-map.md](nvidia-visibility-map.md): every recognition surface, its gate and its status.
- [nvidia-inception.md](nvidia-inception.md): the membership record and approved wording.
- [nvidia-models.md](nvidia-models.md): which NVIDIA model serves which lane.
- [prompts/finish/_context/nvidia-00-CONTEXT.md](../prompts/finish/_context/nvidia-00-CONTEXT.md): shared context for the work orders.
