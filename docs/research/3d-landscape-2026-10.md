# The 3D landscape, October 2026: who beats three.ws, and what to take

Research date: 2026-10-09. Four parallel sweeps (open-source AI generation, web engines and viewers, avatar and companion stacks, commercial platforms), every star count, push date and license read from the GitHub API or the LICENSE file itself on the research date, then checked against this repository to see what three.ws already ships. Commercial vendors are placeholders (Vendor A, B, ...) by the owner's standing directive; open-source projects are named because we depend on them and credit them.

Companions: [oss-adoption-2026-09.md](../oss-adoption-2026-09.md) (the September sweep; two of its Tier 1 items are still open and reappear here), [popular-3d-github-repos.md](../popular-3d-github-repos.md) (the raw star table), [avatar-engines.md](../avatar-engines.md) (the avatar engine atlas).

**Status (2026-10-09):** every item below is a work order in `prompts/finish/` (067 to 083 runnable, 932 to 935 owner-gated). Start from [the campaign context](../../prompts/finish/_context/best3d-00-CONTEXT.md).

## Bottom line

1. **Nobody beats three.ws on breadth.** No repo or vendor combines generation, rigging, a shared animation library, an LLM brain, voice, a wallet and a one-tag embed. The two web-avatar incumbents were absorbed within sixty days of each other (one shut down on 2026-01-31, the other was bought by a game-engine company in February); the biggest open companion project (50k stars) is desktop-first and wallet-less; the biggest agent framework has no body. The lane is open.
2. **Several repos beat us on depth, one lane at a time.** The MIT TRELLIS.2 family beats our geometry and PBR lane. VAST's MIT rigging stack rigs anything, ours rigs humanoids. three-vrm renders VRM properly, our loader does not. NVIDIA's Audio2Face-3D produces a facial performance, we estimate visemes from audio energy. Spark 2.3 and the splat tooling around it do more than our splat viewer. Every one of these is permissively licensed and is a lane swap, not a rebuild.
3. **One compliance fix is urgent.** The production image-to-3D default, Hunyuan3D 2.1, ships under a license that excludes the European Union, the United Kingdom and South Korea, for the model and for its output (`Territory` clause, Section 5.c). three.ws serves users there. TRELLIS.2 (MIT, higher resolution, PBR with transparency) is both the upgrade and the fix. Order 067.
4. **Commercial vendors win on packaging.** Multi-image input, a polycount slider, quad topology at generation time, engine bridges for Unity, Unreal and Godot, batch generation and team workspaces are table stakes everywhere else and missing or partial here. None of that is research; it is product work on lanes we already run.
5. **Five things nobody does well** are ours to take: prompt-to-clip animation on arbitrary rigs with a retarget preview, true LOD chains with engine-ready QA, edits that keep topology, UVs and rig across versions, portable ownership with signed provenance, and readable pricing. Four of the five are extensions of things we already have (Animation Studio, Simulation readiness, the remix lineage, content credentials).

## What three.ws already has (do not rebuild)

Measured in this repository on 2026-10-09.

| Capability | Where | Model or library |
|---|---|---|
| Image to 3D | `workers/model-hunyuan3d`, `workers/model-trellis`, `workers/model-triposg`, `workers/model-triposr` | Hunyuan3D 2.0 and 2.1, TRELLIS (v1), TripoSG, TripoSR |
| Rigging | `workers/rig` | Make-It-Animatable plus UniRig, humanoid only, ARKit-52 blendshapes |
| PBR texturing and region retexture | `workers/texture` | SDXL inpainting in UV space |
| Quad remesh, decimation, format conversion | `workers/remesh` | QuadriFlow |
| Part segmentation | `workers/segment` | SAM-based, CPU |
| Text to motion | `workers/model-text2motion` | MDM (MIT) |
| Video to motion, selfie to avatar, video to scene, garments, CAD | `workers/model-video2motion`, `workers/avatar-reconstruction`, `workers/model-video2scene`, `workers/garment-forge`, `workers/cad-forge` | |
| Universal retargeting (no rig allowlist) | `src/glb-canonicalize.js`, `src/animation-retarget.js` | |
| Splat viewer | `src/splat-stage.js` | Spark 2.2 |
| Scene Studio | `src/scene-studio/` | vendored three.js editor |
| Webcam face capture | `src/face-mocap.js`, `src/avatar-face-capture.js` | MediaPipe Face Landmarker |
| In-browser TTS and STT, barge-in | `src/runtime/neural-tts.js` (Kokoro), `src/runtime/whisper-stt.js`, `src/voice/` | |
| USDZ export | `src/usdz-pipeline.js`, `src/usdz-animated.js` | |
| glTF tooling | `packages/glb-diff`, `packages/glb-tools`, Rig Doctor, Model Diff | gltf-transform 4.5 |
| Physics, BVH | `src/physics/physics-world.js` | Rapier 0.19, three-mesh-bvh 0.9 |
| MCP servers, Blender MCP, remix lineage, content credentials, Simulation readiness | `packages/*-mcp`, `packages/blender-mcp`, `specs/SIM_READINESS.md` | |

Gaps confirmed by grep on the same day: no WebGPU or TSL in product code (only inside the vendored editor), no `KHR_materials_variants` handling, no annotation hotspots on `<agent-3d>`, no AR attributes on `<agent-3d>` (the `/ar` page loads a third-party viewer from a CDN instead), no LOD generation, no Unity, Unreal or Godot bridge, no user-facing batch generation, no spring bones, MToon, expression presets or `.vrma` support in the VRM path, no `.vrma` anywhere, no Audio2Face lane.

## Sweep 1: open-source AI 3D generation

| Repo | Stars | Pushed | License | Why it matters |
|---|---|---|---|---|
| [microsoft/TRELLIS.2](https://github.com/microsoft/TRELLIS.2) | 11.5k | 2026-07 | MIT | Current open state of the art: 4B flow transformer on sparse "O-Voxels", arbitrary topology, PBR GLB including transparency, up to 1536 cubed. 24 GB VRAM; about 3 s at 512 cubed and 17 s at 1024 cubed on an H100. Weights MIT on Hugging Face. Supersedes TRELLIS v1, which we run. |
| [TencentARC/Pixal3D](https://github.com/TencentARC/Pixal3D) | 2.4k | 2026-09 | MIT | TRELLIS.2 backbone that back-projects pixel features: near-reconstruction fidelity to the input photo, single or multi-view, PBR GLB. The "looks exactly like my picture" lane. |
| [Tencent-Hunyuan/Hunyuan3D-2.1](https://github.com/Tencent-Hunyuan/Hunyuan3D-2.1) | 4.1k | 2025-10 | Tencent Hunyuan 3D 2.1 Community License | Our production default. License excludes EU, UK and South Korea for the works **and the output**, caps at 1M MAU, requires a Notice file. 2.5, 3.0 and PolyGen have no public weights. **Usable only with territory enforcement.** |
| [Tencent-Hunyuan/Hunyuan3D-Omni](https://github.com/Tencent-Hunyuan/Hunyuan3D-Omni), [Hunyuan3D-Part](https://github.com/Tencent-Hunyuan/Hunyuan3D-Part), [HunyuanWorld-1.0](https://github.com/Tencent-Hunyuan/HunyuanWorld-1.0) | 0.6k to 2.9k | 2025-10 to 2026-04 | same family | Pose, bbox and point-cloud conditioning; native part segmentation; text to explorable 360 world. Same territory problem. Reference only. |
| [DreamTechAI/Direct3D-S2](https://github.com/DreamTechAI/Direct3D-S2) | 1.3k | 2025-09 | MIT | 1024 cubed geometry, geometry only. |
| [stepfun-ai/Step1X-3D](https://github.com/stepfun-ai/Step1X-3D) | 0.9k | 2025-09 | Apache-2.0 | Shape plus texture, controllable (symmetry LoRA), training code. |
| [VAST-AI-Research/TripoSG](https://github.com/VAST-AI-Research/TripoSG), TripoSF, TripoSR, [TripoSplat](https://github.com/VAST-AI-Research/TripoSplat) | 0.8k to 7.0k | 2025-04 to 2026-08 | MIT | We run TripoSG and TripoSR. TripoSplat (image to Gaussian splats) is new and fits the splat viewer. |
| [facebookresearch/sam-3d-objects](https://github.com/facebookresearch/sam-3d-objects) | 7.5k | 2026-06 | SAM License (commercial allowed, gated weights, sanctions clause) | Every object in a cluttered real photo, with layout. The "photo of my room to placeable objects" feature. Needs a license acceptance. |
| [wgsxm/PartCrafter](https://github.com/wgsxm/PartCrafter), [HoloPart](https://github.com/VAST-AI-Research/HoloPart), [MIDI-3D](https://github.com/VAST-AI-Research/MIDI-3D) | 0.7k to 2.5k | 2026-04 | MIT, MIT, Apache-2.0 | One image to individually editable parts; amodal completion of hidden parts; one image to a multi-object scene. |
| [VAST-AI-Research/UniRig](https://github.com/VAST-AI-Research/UniRig), [SkinTokens](https://github.com/VAST-AI-Research/SkinTokens), [AniGen](https://github.com/VAST-AI-Research/AniGen) | 0.5k to 1.8k | 2026-05 to 2026-07 | MIT (all three LICENSE files read) | Skeleton plus skin weights for arbitrary rigs (animals, props); SkinTokens claims roughly double the skinning accuracy; AniGen is image to rigged asset in one pass. |
| [jasongzy/Make-It-Animatable](https://github.com/jasongzy/Make-It-Animatable) | 0.5k | 2026-09 | MIT | Already in our rig lane. Also rigs Gaussian splats. |
| [Seed3D/Puppeteer](https://github.com/Seed3D/Puppeteer), [MagicArticulate](https://github.com/Seed3D/MagicArticulate) | 0.4k | 2025-09 | Apache-2.0 | Rig then animate from a video prompt, FBX export. |
| [3DTopia/MaterialAnything](https://github.com/3DTopia/MaterialAnything) | 0.4k | 2025-12 | MIT | PBR materials (albedo, roughness, metallic, bump) for any mesh, including untextured scans. Needs Blender in the loop. |
| [huanngzh/MV-Adapter](https://github.com/huanngzh/MV-Adapter) | 1.3k | 2025 | Apache-2.0 | Multi-view consistent image generation for texturing and multi-view conditioning. |
| MeshAnything V2, Roblox Cube, Sparc3D, SF3D and SPAR3D | | | non-commercial, research-only, no license, revenue-capped | Reference only. There is still no open quad retopology competitive with the closed vendors; QuadriFlow remains the best we can ship. |

## Sweep 2: web engines, viewers and tooling

| Project | Stars | License | What to take |
|---|---|---|---|
| [three.js](https://github.com/mrdoob/three.js) r186 | 116k | MIT | `WebGPURenderer` with TSL node materials is now the primary path; native `GaussianSplat` object with splat raycasting (r186, WebGPU); `BatchedMesh` for crowds. We are on r184 with the WebGL renderer everywhere. |
| [Babylon.js](https://github.com/BabylonJS/Babylon.js) 9.30 | 26k | Apache-2.0 | Inspector v2 (extensible panes, splat stream diagnostics), Node Material Editor, Flow Graph editor exporting `KHR_interactivity`. Engine mismatch, so reference for UI, rebuilt on TSL. |
| [PlayCanvas engine](https://github.com/playcanvas/engine), [SuperSplat](https://github.com/playcanvas/supersplat), [supersplat-viewer](https://github.com/playcanvas/supersplat-viewer) | 17k, 10k | MIT | The editor frontend is MIT but talks to a closed backend. SuperSplat Studio: up to 25 annotation hotspots with saved camera views, camera timeline, video export, SOG compressed format. |
| [google/model-viewer](https://github.com/google/model-viewer) 4.3 | 8.3k | Apache-2.0 | The AR export contract: `ar-modes="webxr scene-viewer quick-look"`, on-device USDZ, `ar-placement` floor or wall, `variant-name`, hotspot slots, poster and skeleton loading. Our `/ar` page loads it from a CDN; `<agent-3d>` has none of it. |
| [gltf-transform](https://github.com/donmccurdy/glTF-Transform) 4.5.1 | 2.0k | MIT | Already a dependency. `inspect()`, `simplify`, `palette`, `instance`, the variants API and `@gltf-transform/view` are unused. |
| [Spark](https://github.com/sparkjsdev/spark) 2.3.1 | 3.7k | MIT | We run 2.2. LoD Splat Tree, streamable format, memory paging for 100M+ splats, Rust decoders, dyno shader graph for GPU-side splat editing, skeletal-animated splats. |
| [pixiv/three-vrm](https://github.com/pixiv/three-vrm) 3.5 | 2.2k | MIT | VRM 0.x and 1.0, MToon, spring bones, constraints, look-at, 18 expression presets, `.vrma` animation loader, WebGPU. Our `src/game/vrm-loader.js` documents that it does none of this. |
| [three-mesh-bvh](https://github.com/gkjohnson/three-mesh-bvh) 0.9.16 | 3.5k | MIT | Already a dependency; `three-mesh-bvh/webgpu` compute queries are new. |
| [8thwall/8thwall](https://github.com/8thwall/8thwall) | 0.5k | MIT since 2026-03 | Face effects, image targets, coaching overlay, unsupported-device landing page. SLAM is binary-only; hosted services ended 2026-02-28. |
| [Theatre.js](https://github.com/theatre-js/theatre) | 12.7k | Apache-2.0, unmaintained since 2024 | The keyframe timeline UX reference for Animation Studio. UI patterns only; never a dependency. |
| react-three-fiber, drei, uikit, pmndrs/xr, Threlte, A-Frame 1.8 | 3k to 33k | MIT | A-Frame's keyboard-toggled in-page inspector is the pattern for a debug overlay on any embed. |
| Needle Engine, Spline V2, Wonderland | | closed or source-available with EULA | Reference only. Spline V2's in-editor agent tab plus MCP server (an agent reads the scene, calls tools, screenshots to verify, per-prompt version history) is where browser editors are heading; we already have `packages/scene-mcp` to build it on. |

## Sweep 3: avatars, virtual humans, companions

Market facts: the largest cross-game avatar SDK (Vendor R) was acquired on 2025-12-19 and its hosted creator and every public endpoint went offline on 2026-01-31; exported GLBs still load, and every embed that depended on it is orphaned. The leading parametric body-model company was acquired by a game-engine company in February 2026. A long-running free animation library is online and unmaintained. The dominant mobile viseme SDK reached end of life in April 2026.

| Project | Stars | License | What to take |
|---|---|---|---|
| [met4citizen/TalkingHead](https://github.com/met4citizen/TalkingHead), [HeadTTS](https://github.com/met4citizen/HeadTTS), [HeadAudio](https://github.com/met4citizen/HeadAudio) | 1.6k | MIT | Rule-based viseme timing from TTS word timestamps in six languages plus Azure viseme passthrough, mood system, emoji to expression, gestures, gaze. HeadTTS runs Kokoro in-browser with visemes. HeadAudio is an audio-worklet viseme detector for audio with no transcript. |
| [moeru-ai/airi](https://github.com/moeru-ai/airi) | 50k | MIT | The scale leader in companions: VRM and Live2D bodies, auto-blink and idle eyes, Discord and Telegram bodies, WebGPU local inference. Desktop-first, no wallet. |
| [semperai/amica](https://github.com/semperai/amica) | 1.6k | MIT | Closest architectural cousin to our embed: three-vrm, emotion engine, vision, in-browser Whisper plus Silero VAD, many TTS backends. |
| [NVIDIA/Audio2Face-3D](https://github.com/NVIDIA/Audio2Face-3D) and SDK | 0.5k | NVIDIA Open Model License (weights), MIT (SDK) | Audio to 52 ARKit blendshapes plus emotion. Exactly the rig our avatars already carry. Was Tier 1 in the September sweep and is still unbuilt. |
| [google-ai-edge/mediapipe](https://github.com/google-ai-edge/mediapipe) Face Landmarker | 37k | Apache-2.0 | Already in `src/face-mocap.js`. |
| Open-LLM-VTuber (14k), Utsuwa, avtr-1 | | custom frontend license, AGPL, custom | Reference only: barge-in turn-taking, relationship and mood memory, "active listening" idle reactions while the user speaks. Reimplement, never vendor. |
| [elizaOS/eliza](https://github.com/elizaOS/eliza) | 20k | MIT | No first-party 3D or VRM plugin exists; the only 3D starter is a dead fork on a GPL world engine. The agent-with-wallet ecosystem has no body. |
| Text to motion: [MoMask](https://github.com/EricGuo5513/momask-codes), [MotionGPT](https://github.com/OpenMotionLab/MotionGPT), [MDM](https://github.com/GuyTevet/motion-diffusion-model) | 1.3k to 4.1k | MIT | We run MDM. MoMask is the stronger MIT baseline. HY-Motion 1.0 (Tencent, 2.6k) is the quality leader but carries the same EU, UK and Korea exclusion as Hunyuan3D, so it stays reference-only. MotionLCM is non-commercial. |
| Video to motion: 4D-Humans, WHAM, TRAM | 0.6k to 1.7k | MIT | All emit SMPL parameters, whose body model is non-commercial; commercial output inherits that problem. Our video2motion lane already avoids it. |
| makehumancommunity/mpfb2 | 0.6k | GPL code, CC0 assets | The CC0 base meshes and targets are a legal parametric body library. |
| Vendor S (selfie to avatar SaaS), Vendor T (streamed-blendshape conversational character SaaS) | | closed | Reference: iframe avatar SDK with outfit catalog; server-streamed 52 blendshapes at 60 fps. |

## Sweep 4: commercial platforms (reference only)

Twenty-six vendors were surveyed. Pricing from the vendor pages where fetchable, otherwise from aggregators, which disagree with each other on nearly every vendor.

| Vendor | Shape | What users get that we do not |
|---|---|---|
| Vendor A, the market leader (reported 15M users, 100M models, roughly $100M ARR) | credits, free tier with CC-BY output | Multi-image input (1 to 4), batch image-to-3D, a chat-driven 3D agent, texture edit, "smart" vs standard topology, auto split to parts, humanoid and quadruped rig with 500+ presets, scene compose, Blender, Unity, Unreal and Godot bridges, an official MCP server with 24 tools. |
| Vendor B, 20B-parameter generator (reported 6.5M creators) | credits | Quad retopology in about 2 s, part segmentation, rig and retarget and a mocap library over the API, plugins for five engines plus ComfyUI, MCP in alpha. |
| Vendor C, quad-native generator | free to generate, pay on download | Face-count slider 500 to 1M, bbox constraint, T or A pose, baked normals from high-poly, geometry and material redos, 8K HDRI remix. |
| Vendor D, parametric plus AI | the only unlimited tier | LOD, UVs, custom art styles, skybox generation, print-slicer plugins, runtime generation inside a game engine. |
| Vendor E, parts generator | credits | Image segmentation to parts with auto-assembly, adaptive polycount. |
| Vendor F, browser design tool | credits | Agent tab plus MCP server driving the editor, per-prompt version history, web and app export. |
| Vendor G, print-first modeler | credits | Node canvas, SDF editor, integrated full-color 3D print ordering. |
| Vendor H, model-agnostic hub | credits | 65+ models behind one API, custom LoRA training, team workspaces. |
| Vendor I, world generator | tiers | Text, image or panorama to an explorable world with splat, collider and mesh export. |
| Closed Studio tier of the Hunyuan3D family | per generation | 4 or 8 views, 1536 cubed, 4K PBR, quad or tri, low-poly, part mode, rig, UV, baking. |

**The fifteen features every serious vendor has:** multi-image input; quad or smart topology at generation time; polycount slider with bbox and pose controls; UV-preserving PBR retexture of any upload; auto-rig for humanoids and quadrupeds with a large retargeted library; split to parts with auto-assembly; free-to-generate pricing or an unlimited tier; an official MCP server and `llms.txt`; first-party Blender, Unity, Unreal and Godot bridges; batch generation with concurrency tiers; a community gallery with remix lineage; a chat-driven agent or node canvas; scene or world generation with real export; a print-ready pipeline; team workspaces with SSO and audit. We have eight of the fifteen in full or in part (retexture, humanoid rig, parts, MCP, Blender, remix lineage, chat agent, Diorama).

**White space (nobody does this well):** prompt-to-clip animation on arbitrary rigs with a retarget preview; true LOD chains with draw-call, texel-density and collider QA; edits that keep topology, UVs, rig and animations across versions; portable ownership (signed exports, on-chain provenance, CC licensing by default); readable per-task pricing with a cost preview before you spend.

## Take: ranked by leverage over effort

Status is the grep above. "Build" is the smallest change that closes the gap. Licenses: **use** means the project becomes a dependency or a lane as-is; **vendor** means we copy the pattern or a module under its license; **reference** means the license or the closed source forbids reuse and we build a better version from scratch.

### Tier 1: lane swaps on permissive licenses, each a visible quality jump

| # | What | From | License | Order |
|---|---|---|---|---|
| 1 | TRELLIS.2 becomes the default image-to-3D lane: PBR with transparency, 1536 cubed. Hunyuan3D 2.1 drops to a territory-gated fallback or retires. | TRELLIS.2 | MIT, use | 067 |
| 2 | Pixal3D "match my photo" fidelity lane, multi-view input (1 to 4 images) in Forge | Pixal3D, MV-Adapter | MIT, Apache-2.0, use | 068 |
| 3 | Rig anything: SkinTokens plus UniRig for quadrupeds, creatures and props; AniGen image-to-rigged in one pass | SkinTokens, UniRig, AniGen | MIT, use | 069 |
| 4 | Editable parts: PartCrafter and HoloPart behind the segment lane; recolor, swap and regenerate one part in Restyle Studio | PartCrafter, HoloPart | MIT, use | 070 |
| 5 | Real VRM: three-vrm for spring bones, MToon, expression presets, look-at, `.vrma`; an import landing for orphaned avatars from the shut-down SDK | three-vrm | MIT, use | 075 |
| 6 | Facial performance: Audio2Face-3D worker emitting ARKit-52 tracks, with the current viseme path as the fallback rung | Audio2Face-3D | NVIDIA Open Model License (weights), MIT (SDK), use | 076 |
| 7 | Splat viewer parity: Spark 2.3 LoD tree and paging, annotation hotspots with saved cameras, camera timeline, video export, skeletal splats, TripoSplat image-to-splat | Spark, SuperSplat (patterns), TripoSplat | MIT, use and vendor | 081 |

### Tier 2: packaging the vendors have and we lack

| # | What | Reference | Order |
|---|---|---|---|
| 8 | `<agent-3d>` AR and viewer contract: `ar-modes`, on-device USDZ, `ar-placement`, `variant-name` with `KHR_materials_variants`, hotspot slots, poster skeleton; retire the CDN viewer on `/ar` | model-viewer (Apache-2.0, vendor the attribute API and USDZ path) | 073 |
| 9 | WebGPU path: opt-in `WebGPURenderer` with WebGL2 fallback across the viewer and Scene Studio, TSL materials behind Restyle, native `GaussianSplat` on r186, `three-mesh-bvh/webgpu` | three.js r186 (MIT, use) | 074 |
| 10 | LOD chains plus engine-ready QA: gltf-transform `simplify` and `palette` chain, `MSFT_lod`, texel density, draw-call and collider report inside Simulation readiness and Rig Doctor; watertight STL for print | gltf-transform (MIT, use); Vendors D and G (reference) | 071 |
| 11 | Engine bridges: Unity package, Unreal plugin, Godot addon that browse the catalog and pull generations through the public API, sharing one contract with the Blender MCP | Vendors A, B, C (reference) | 072 |
| 12 | Generation controls: polycount slider, bbox constraint, T or A pose on every generation lane; batch generation with concurrency tiers in Forge and the API | Vendors A, C (reference) | 083 |
| 13 | Scene Studio: inspector pane, TSL material graph, agent tab driven by `packages/scene-mcp` with screenshot verification and per-prompt version history | Babylon Inspector v2 and NME (Apache-2.0, reference), Vendor F (reference) | 080 |

### Tier 3: the white space

| # | What | Order |
|---|---|---|
| 14 | Prompt-to-clip on any rig with a retarget preview: MoMask rung beside MDM, Puppeteer video prompts, Theatre.js-grade timeline in Animation Studio | 077 |
| 15 | Keep the rig: retexture, part edits and regenerations that preserve topology, UVs, skeleton and animations across versions, with lineage in Model Diff | 078 |
| 16 | Companion presence: mood system, emoji to expression, LLM-composable gestures, active-listening idle, multi-language viseme timing, energy-based fallback | 082 |
| 17 | Portable ownership: signed GLB exports with content credentials and the provenance record on every download, by default | 079 |

### Owner-gated (band 900)

| # | What | Gate | Order |
|---|---|---|---|
| 18 | Pricing: public per-task cost preview before any spend; free-to-generate, pay-to-keep on Forge | pricing is the owner's | 932 |
| 19 | SAM 3D Objects lane: a photo of a room to placeable objects in AR Studio | license acceptance (gated weights, sanctions clause) | 933 |
| 20 | "Bring your orphaned avatar" campaign for users of the shut-down SDK | names another company; external posting | 934 |
| 21 | Publish the engine bridges to the Unity Asset Store, Unreal Marketplace, Godot Asset Library and Blender Extensions | external publishing | 935 |

## License traps found in this sweep

- **Tencent community licenses** (Hunyuan3D 2.x, Omni, Part, HunyuanWorld, HY-Motion): worldwide **excluding** the EU, UK and South Korea, for the works and their output; 1M MAU cap (100M for HY-Motion); Notice file. We serve those regions, so every Tencent lane needs territory enforcement or retirement. Order 067 decides.
- **NVIDIA Open Model License** (Audio2Face-3D weights): commercial use allowed, not redistributable as open source, usage restrictions apply. Fine for a worker; never bundle the weights in a package.
- **SAM License** (SAM 3D Objects): commercial use allowed, gated download form, sanctions clause. An owner accepts it once.
- **Stability Community License** (SF3D, SPAR3D): free under $1M revenue with registration. Both projects are dead; not worth it.
- **Non-commercial or copyleft**: MeshAnything V2, SMPL-X and everything that emits SMPL parameters, MotionLCM, Roblox Cube, GVHMR, SMPLer-X, Hyperfy (GPL), Utsuwa (AGPL), the Open-LLM-VTuber frontend. Reference only.
- **Make-It-Animatable** is MIT in the repository; the Hugging Face Space says CC-BY-NC. The repository governs, and we already use it.

## Re-running this sweep

    # Verify a repo's license, stars and activity from the source, not a blog.
    gh api repos/<owner>/<name> --jq '[.full_name,.stargazers_count,.pushed_at[:10],.license.spdx_id]|@tsv'
    # NOASSERTION means GitHub could not classify it; read the file.
    gh api repos/<owner>/<name>/contents/LICENSE --jq .content | base64 -d | head -30
    # Does three.ws already use it anywhere that matters?
    grep -rli '<name>' src api workers packages services --include=*.js --include=*.py --include=*.md | grep -v node_modules
