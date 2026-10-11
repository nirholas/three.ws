# Open-source 3D generation, auto-rigging, motion, and world generation vs three.ws Forge (as of October 2026)

Scope note: all GitHub star counts below were read from the GitHub API on 2026-10-09 (`gh api repos/{owner}/{repo}`). License claims cite the license text in the repo (`gh api repos/{owner}/{repo}/license`) or the Hugging Face model card. "three.ws today" facts come from the worker READMEs in `/home/user/projects/three.ws/workers/*/README.md` (Hunyuan3D 2.0 and 2.1, TRELLIS-image-large, TripoSG, TripoSR for shape; Make-It-Animatable for rigging; MDM for text-to-motion; three Apache-2.0 video-to-motion models on the Wolf3D skeleton; LingBot-Map for video-to-scene; SDXL+ControlNet texturing; QuadriFlow/xatlas/Manifold remeshing; build123d CAD Forge; garment-forge on gemini-2.5-flash-image + Hunyuan3D 2.1).

Legal shorthand used throughout:
- **Tencent community license** (every Tencent-Hunyuan repo): "THIS LICENSE AGREEMENT DOES NOT APPLY IN THE EUROPEAN UNION, UNITED KINGDOM AND SOUTH KOREA AND IS EXPRESSLY LIMITED TO THE TERRITORY"; Territory = "the worldwide territory, excluding the territory of the European Union, United Kingdom and South Korea"; if "on the ... release date, the monthly active users of all products or services made available by or for Licensee is greater than 1 million monthly active users in the preceding calendar month, You must request a license from Tencent, which Tencent may grant to You in its sole discretion"; you may not use outputs "to improve any other AI model"; and you "must not use, reproduce, modify, distribute, or display the ... Works, Output or results ... outside the Territory". Verified verbatim in Hunyuan3D 2.0 [Source](https://github.com/Tencent-Hunyuan/Hunyuan3D-2/blob/HEAD/LICENSE), Hunyuan3D 2.1 [Source](https://huggingface.co/tencent/Hunyuan3D-2.1/raw/main/LICENSE), Hunyuan3D-Omni [Source](https://github.com/Tencent-Hunyuan/Hunyuan3D-Omni/blob/HEAD/License.txt), HY-Motion 1.0 [Source](https://github.com/Tencent-Hunyuan/HY-Motion-1.0/blob/HEAD/License.txt), and the same template in Hunyuan3D-Part, HunyuanWorld-1.0, and HY-World 2.0 (links in their sections). Consequence for an Apache-2.0 platform serving users worldwide: self-hosting is allowed only if EU/UK/South Korea users are geo-blocked from the feature AND its outputs, and the 1M-MAU test is measured once, on each model's release date.
- **Meta SAM License** (SAM 3D Objects, SAM 3D Body), "Last Updated: November 19, 2025": worldwide, no MAU threshold, commercial use allowed; requires Trade Control Law compliance, publication acknowledgement, and carrying the Agreement on redistribution. [Source](https://github.com/facebookresearch/sam-3d-objects/blob/HEAD/LICENSE)
- **Stability AI Community License** (SF3D, SPAR3D), "Last Updated: July 5, 2024": free "Research & Non-Commercial or Commercial" use only for "people or organizations generating annual revenue of less than US $1,000,000"; above that an enterprise license is required. [Source](https://github.com/Stability-AI/stable-fast-3d/blob/HEAD/LICENSE.md)
- **NVIDIA OneWay Noncommercial** (GENMO/GEM): "non-commercially means for research or evaluation purposes only". [Source](https://github.com/NVlabs/GENMO/blob/HEAD/LICENSE)

## Q1. Which models top 2026 benchmarks for text-to-3D and image-to-3D, and what do they output?

### Takeaway
There is no neutral, independent 2026 leaderboard that ranks every open model; the closest things are Meta's SA-3DAO artist-object benchmark (June 2026), vendor self-reports, and third-party blog tests. On those, the open frontier for image-to-3D is TRELLIS.2 (MIT, PBR, up to 1536^3 voxels), SAM 3D Objects (SAM License, strongest on real-world photos, splat export), Hunyuan3D 2.1 (PBR, territorial license), and newer MIT entrants Pixal3D (SIGGRAPH 2026) and PartCrafter (part-level meshes). three.ws already runs Hunyuan3D 2.1 and TRELLIS 1 but not TRELLIS.2, SAM 3D Objects, Pixal3D, or any part-level generator.

### Cited Findings

**Tencent Hunyuan3D family (three.ws runs 2.0 and 2.1 today)**
- Hunyuan3D-2: 15,037 stars (2026-10-09), last push 2025-10-28, license "TENCENT HUNYUAN 3D 2.0 COMMUNITY LICENSE AGREEMENT", release date January 21, 2025, EU/UK/South Korea excluded, 1M MAU gate. [Source](https://github.com/Tencent-Hunyuan/Hunyuan3D-2/blob/HEAD/LICENSE)
- Hunyuan3D-2.1: 4,147 stars (2026-10-09); "Tencent Hunyuan 3D 2.1 Community License Agreement", release date June 13, 2025, same Territory and MAU terms, Notice file required for non-hosted distribution, outputs may not be used to improve other models. [Source](https://huggingface.co/tencent/Hunyuan3D-2.1/raw/main/LICENSE)
- Hunyuan3D-2.1 outputs PBR (base color, metallic-roughness, normal) and the README states VRAM of 10 GB shape-only, 21 GB texture-only, 29 GB for both; self-reported Hunyuan3D-Paint-2.1 CLIP-FID 24.78 vs TEXGen 28.24. [Source](https://github.com/Tencent-Hunyuan/Hunyuan3D-2.1)
- Conflict to flag: source headers under `hy3dpaint/` state the module is for non-commercial use while the repository LICENSE is the community license permitting commercial use inside the Territory. [Source](https://github.com/Tencent-Hunyuan/Hunyuan3D-2.1/tree/main/hy3dpaint); contradicted by [Source](https://huggingface.co/tencent/Hunyuan3D-2.1/raw/main/LICENSE)
- Hunyuan3D-Part: 546 stars (2026-10-09), "Tencent Hunyuan 3D-Part Community License", release date September 23, 2025, same Territory exclusion; contains P3-SAM (part segmentation) and X-Part (part generation, light version released). [Source](https://github.com/Tencent-Hunyuan/Hunyuan3D-Part)
- Hunyuan3D-Omni: 639 stars (2026-10-09), "TENCENT HUNYUAN 3D Omni COMMUNITY LICENSE AGREEMENT", release date September 26, 2025, EU/UK/South Korea excluded, 1M MAU gate; adds controllable generation (point cloud, voxel, bounding box, pose conditions). [Source](https://github.com/Tencent-Hunyuan/Hunyuan3D-Omni/blob/HEAD/License.txt)
- Hunyuan3D 2.5, 3.0 and 3.1 exist only as hosted services (3d.hunyuan.tencent.com); no official open repo was found for them. [Source](https://3d.hunyuan.tencent.com/)

**Microsoft TRELLIS and TRELLIS.2 (three.ws runs TRELLIS-image-large today)**
- microsoft/TRELLIS: 13,778 stars (2026-10-09), MIT. [Source](https://github.com/microsoft/TRELLIS/blob/HEAD/LICENSE)
- microsoft/TRELLIS.2: 11,509 stars (2026-10-09), MIT code; weights `microsoft/TRELLIS.2-4B` are MIT on Hugging Face. [Source](https://github.com/microsoft/TRELLIS.2/blob/HEAD/LICENSE); [Source](https://huggingface.co/microsoft/TRELLIS.2-4B)
- TRELLIS.2 is a 4B-parameter image-to-3D model using the O-Voxel representation, outputs PBR Base Color / Roughness / Metallic / Opacity, supports 512^3, 1024^3 and 1536^3 resolutions with H100 timings of about 3 s / 17 s / 60 s, and needs a minimum 24 GB VRAM GPU; it is image-to-3D only (no text conditioning). [Source](https://github.com/microsoft/TRELLIS.2); paper [Source](https://arxiv.org/abs/2512.14692)
- A third-party test on AMD hardware measured TRELLIS.2 peak VRAM at 8.65 GiB versus Hunyuan3D-2.1 at 28.8 GiB when generating a 40k-face mesh. [Source](https://hawkymisc.github.io/)
- Meta's AssetGen paper notes TRELLIS.2 is "less robust on complex inputs" than their system (vendor comparison, not independent). [Source](https://ai.meta.com/research/)

**Meta SAM 3D Objects and SAM 3D Body**
- facebookresearch/sam-3d-objects: 7,496 stars (2026-10-09), SAM License (worldwide commercial, no MAU gate; Trade Control and attribution clauses). [Source](https://github.com/facebookresearch/sam-3d-objects/blob/HEAD/LICENSE)
- SAM 3D Objects reconstructs shape, texture and scene layout from a single real-world photo and exports Gaussian splats; Meta reports a 5:1 human-preference win rate over prior methods; the SA-3DAO benchmark of 1,000 artist-made objects and a Hugging Face leaderboard were published June 2, 2026, and the encoder weights on June 1, 2026. [Source](https://github.com/facebookresearch/sam-3d-objects); [Source](https://huggingface.co/facebook/sam-3d-objects)
- facebookresearch/sam-3d-body: 3,602 stars (2026-10-09), SAM License; outputs the Meta Human Rig (MHR) parametric body from a single image; CVPR 2026. [Source](https://github.com/facebookresearch/sam-3d-body)

**Other MIT / Apache image-to-3D models**
- VAST-AI-Research/TripoSG: 1,822 stars (2026-10-09), MIT (already used by three.ws). [Source](https://github.com/VAST-AI-Research/TripoSG/blob/HEAD/LICENSE)
- VAST-AI-Research/TripoSR: 7,032 stars (2026-10-09), MIT (already used). [Source](https://github.com/VAST-AI-Research/TripoSR/blob/HEAD/LICENSE)
- stepfun-ai/Step1X-3D: 896 stars (2026-10-09), Apache-2.0; two-stage geometry + texture, README lists 27 to 29 GB VRAM across both stages. [Source](https://github.com/stepfun-ai/Step1X-3D/blob/HEAD/LICENSE); [Source](https://github.com/stepfun-ai/Step1X-3D)
- Stable-X/Stable3DGen (Hi3DGen, repo moved from Stable-X/Hi3DGen): 1,279 stars (2026-10-09), MIT (copyright Bytedance Inc.); normal-bridged image-to-3D fine-tuned from TRELLIS with the StableNormal estimator. [Source](https://github.com/Stable-X/Stable3DGen/blob/HEAD/LICENSE); [Source](https://github.com/Stable-X/Stable3DGen)
- DreamTechAI/Direct3D-S2: 1,285 stars (2026-10-09), MIT (copyright DreamTechAI); NeurIPS 2025; README lists 10 GB VRAM at 512 resolution and 24 GB at 1024. [Source](https://github.com/DreamTechAI/Direct3D-S2/blob/HEAD/LICENSE.txt); [Source](https://github.com/DreamTechAI/Direct3D-S2)
- wgsxm/PartCrafter: 2,488 stars (2026-10-09), MIT, last push 2026-04-16; single image to multiple semantically separate part meshes (structured, decomposable output). [Source](https://github.com/wgsxm/PartCrafter/blob/HEAD/LICENSE); [Source](https://github.com/wgsxm/PartCrafter)
- TencentARC/Pixal3D: 2,435 stars (2026-10-09), MIT (copyright 2026 Tencent), last push 2026-09-01, SIGGRAPH 2026; pixel-aligned image-to-3D with textured GLB/OBJ output. [Source](https://github.com/TencentARC/Pixal3D/blob/HEAD/LICENSE); [Source](https://github.com/TencentARC/Pixal3D)
- PKU-YuanGroup/UltraShape-1.0: 859 stars (2026-10-09), GitHub reports NOASSERTION; a refinement DiT initialized from Hunyuan3D-2.1 (so it inherits Tencent terms through the base weights); weights at `infinith/UltraShape`. [Source](https://github.com/PKU-YuanGroup/UltraShape-1.0); [Source](https://huggingface.co/infinith/UltraShape)
- lizhihao6/Sparc3D: 1,358 stars (2026-10-09), no license file, no weights in the README; the commercial successor (Hitem3D, 2048^3) is closed. [Source](https://github.com/lizhihao6/Sparc3D)
- Stability-AI/stable-fast-3d: 1,843 stars (2026-10-09) and Stability-AI/stable-point-aware-3d: 1,078 stars (2026-10-09), both under the Stability AI Community License (free commercial use only under US $1M annual revenue). [Source](https://github.com/Stability-AI/stable-fast-3d/blob/HEAD/LICENSE.md); [Source](https://github.com/Stability-AI/stable-point-aware-3d/blob/HEAD/LICENSE.md)

**Texturing**
- huanngzh/MV-Adapter: 1,295 stars (2026-10-09), Apache-2.0; multi-view consistent image generation for texturing existing meshes. [Source](https://github.com/huanngzh/MV-Adapter/blob/HEAD/LICENSE)
- CVMI-Lab/TEXGen: 340 stars (2026-10-09), no license file in the repository. [Source](https://github.com/CVMI-Lab/TEXGen)

### Inferences
- For an image-to-3D upgrade with zero legal friction, TRELLIS.2 (MIT, PBR, 24 GB class GPU, 3 to 60 s on H100) is the obvious add: it beats the current TRELLIS 1 lane on resolution and PBR, and a 1024^3 run at 17 s is competitive with the current Hunyuan3D 2.1 lane while using far less VRAM in third-party tests. Verdict: adopt code and weights.
- SAM 3D Objects fills a gap three.ws does not have (photo-of-a-real-object to textured mesh plus layout plus splats) under a worldwide commercial license. Verdict: adopt code and weights; note the SAM License redistribution and Trade Control clauses in the worker README.
- Hunyuan3D 2.1 remains the best open PBR texture painter by its own numbers, but it is the lane that forces EU/UK/SK geo-blocking. Verdict: already covered, but the platform needs a documented geo-gate on that lane (see Q2).
- PartCrafter and Hunyuan3D-Part give a "parts" capability (separable, editable sub-meshes) that commercial rivals (Tripo segmentation, Rodin) sell and three.ws lacks. PartCrafter is MIT; Hunyuan3D-Part is territorial. Verdict: adopt PartCrafter code and weights first.
- Pixal3D (MIT, 2026-09 push, SIGGRAPH 2026) is the freshest MIT image-to-3D; worth a bake-off against TRELLIS.2 before adopting.
- Text-to-3D (not image-to-3D) remains a two-step problem for every open model listed: TRELLIS.2, SAM 3D, Pixal3D, PartCrafter and Direct3D-S2 are image-conditioned, so a text prompt still passes through an image generator first (three.ws already does this with gemini-2.5-flash-image in garment-forge).

### Gaps
- No independent, peer-reviewed 2026 leaderboard ranking TRELLIS.2, Hunyuan3D 2.1, SAM 3D Objects, Pixal3D and Direct3D-S2 head to head was found; SA-3DAO is Meta-run and the other numbers are vendor self-reports.
- Pixal3D VRAM (about 8 to 12 GB) and speed (30 to 60 s) and a claim that it is "academic only" came from secondary blog sources that conflict with the MIT LICENSE file; treat the license file as authoritative and the perf numbers as unverified.
- UltraShape's license: GitHub reports NOASSERTION; a wiki-style page claims Apache-2.0; not verified against a license file.
- Roblox Cube is reported as research-only and QuadGPT (arXiv 2509.21420, quad-mesh generation) has no confirmed code release; neither was verified from a license file.
- Whether the `hy3dpaint` non-commercial header in Hunyuan3D-2.1 is a stale artifact or a real carve-out needs a question to Tencent or a legal read; it was not resolvable from public text.

## Q2. Which can three.ws legally self-host commercially worldwide, and which carry territorial or MAU restrictions?

### Takeaway
Worldwide-commercial without conditions: every MIT/Apache repo (TRELLIS, TRELLIS.2, TripoSG, TripoSR, Step1X-3D, Stable3DGen, Direct3D-S2, PartCrafter, Pixal3D, MV-Adapter, UniRig, SkinTokens, Make-It-Animatable, MagicArticulate, Puppeteer, MoMask, MotionGPT, Matrix-3D, Matrix-Game, WorldGen code, gsplat, Spark, GaussianSplats3D, lingbot-map) plus Meta's SAM License models. Every Tencent model (Hunyuan3D 2.0/2.1/Part/Omni, HY-Motion 1.0, HunyuanWorld 1.0, HY-World 2.0) excludes EU, UK and South Korea and carries a 1M-MAU gate. Non-commercial and therefore unusable in production: GVHMR, GENMO/GEM, Lyra 2.0 weights, original Inria 3DGS, SceneScript, and Stability models above US $1M revenue.

### Cited Findings
- Tencent community license Territory clause and 1M MAU clause (verbatim quotes in the legal shorthand above). [Source](https://github.com/Tencent-Hunyuan/Hunyuan3D-2/blob/HEAD/LICENSE); [Source](https://huggingface.co/tencent/Hunyuan3D-2.1/raw/main/LICENSE); [Source](https://github.com/Tencent-Hunyuan/Hunyuan3D-Omni/blob/HEAD/License.txt); [Source](https://github.com/Tencent-Hunyuan/HY-Motion-1.0/blob/HEAD/License.txt)
- Tencent licenses also forbid using outputs "to improve any other AI model" and forbid displaying outputs outside the Territory, which binds the platform's asset gallery and marketplace, not just the generation request. [Source](https://github.com/Tencent-Hunyuan/Hunyuan3D-2/blob/HEAD/LICENSE)
- SAM License: Meta grants a worldwide, royalty-free license; conditions include Trade Control Law compliance and research-publication acknowledgement; no MAU threshold appears in the text. [Source](https://github.com/facebookresearch/sam-3d-objects/blob/HEAD/LICENSE)
- Stability AI Community License: free commercial use only for organizations under US $1,000,000 annual revenue. [Source](https://github.com/Stability-AI/stable-fast-3d/blob/HEAD/LICENSE.md)
- NVIDIA OneWay Noncommercial (GENMO): research or evaluation only. [Source](https://github.com/NVlabs/GENMO/blob/HEAD/LICENSE)
- zju3dv/GVHMR: 2,087 stars (2026-10-09), license text restricts use to non-commercial research; commercial use requires contacting the authors. [Source](https://github.com/zju3dv/GVHMR/blob/HEAD/LICENSE)
- graphdeco-inria/gaussian-splatting: 24,145 stars (2026-10-09), Inria/MPII license for research and evaluation only. [Source](https://github.com/graphdeco-inria/gaussian-splatting/blob/HEAD/LICENSE.md)
- facebookresearch/scenescript: 385 stars (2026-10-09), CC-BY-NC-4.0. [Source](https://github.com/facebookresearch/scenescript/blob/HEAD/LICENSE)
- nv-tlabs/lyra: 2,647 stars (2026-10-09); README: "Lyra source code is released under the Apache 2.0 License. Please refer to Lyra-1 and Lyra-2 for their respective model licenses." The Lyra-2.0 model card places the weights under the NVIDIA Internal Scientific Research and Development Model License (no production or commercial use). [Source](https://github.com/nv-tlabs/lyra); [Source](https://huggingface.co/nvidia/Lyra-2.0)
- SMPL/SMPL-X body models (used by HY-Motion, GVHMR, MoMask, MotionGPT) are distributed through MPI registration and cannot be redistributed; HY-Motion's README credits SMPL/SMPL-H. [Source](https://smpl.is.tue.mpg.de/); [Source](https://github.com/Tencent-Hunyuan/HY-Motion-1.0)
- MIT license texts verified for TRELLIS.2, Direct3D-S2, Pixal3D, Stable3DGen, PartCrafter, UniRig, SkinTokens, Make-It-Animatable, Matrix-Game (README: "This project is licensed under the MIT License"), momask-codes, MotionGPT, Spark, GaussianSplats3D. [Source](https://github.com/microsoft/TRELLIS.2/blob/HEAD/LICENSE); [Source](https://github.com/DreamTechAI/Direct3D-S2/blob/HEAD/LICENSE.txt); [Source](https://github.com/TencentARC/Pixal3D/blob/HEAD/LICENSE); [Source](https://github.com/Stable-X/Stable3DGen/blob/HEAD/LICENSE); [Source](https://github.com/wgsxm/PartCrafter/blob/HEAD/LICENSE); [Source](https://github.com/VAST-AI-Research/UniRig/blob/HEAD/LICENSE); [Source](https://github.com/VAST-AI-Research/SkinTokens/blob/HEAD/LICENSE); [Source](https://github.com/jasongzy/Make-It-Animatable/blob/HEAD/LICENSE); [Source](https://github.com/SkyworkAI/Matrix-Game/blob/HEAD/LICENSE); [Source](https://github.com/EricGuo5513/momask-codes/blob/HEAD/LICENSE); [Source](https://github.com/OpenMotionLab/MotionGPT/blob/HEAD/LICENSE); [Source](https://github.com/sparkjsdev/spark/blob/HEAD/LICENSE); [Source](https://github.com/mkkellogg/GaussianSplats3D/blob/HEAD/LICENSE)
- Apache-2.0 verified for Step1X-3D, MV-Adapter, MagicArticulate, Puppeteer, WorldGen, gsplat, lingbot-map, Lyra code. [Source](https://github.com/stepfun-ai/Step1X-3D/blob/HEAD/LICENSE); [Source](https://github.com/huanngzh/MV-Adapter/blob/HEAD/LICENSE); [Source](https://github.com/Seed3D/MagicArticulate/blob/HEAD/LICENSE); [Source](https://github.com/Seed3D/Puppeteer/blob/HEAD/LICENSE); [Source](https://github.com/ZiYang-xie/WorldGen/blob/HEAD/LICENSE); [Source](https://github.com/nerfstudio-project/gsplat/blob/HEAD/LICENSE); [Source](https://github.com/Robbyant/lingbot-map/blob/HEAD/LICENSE); [Source](https://github.com/nv-tlabs/lyra/blob/HEAD/LICENSE)
- WorldGen depends on the gated FLUX.1-dev model ("You should also accept the license of the gated model (FLUX.1-dev)"), whose own license is non-commercial for the weights. [Source](https://github.com/ZiYang-xie/WorldGen); [Source](https://huggingface.co/black-forest-labs/FLUX.1-dev)

### Inferences
- three.ws's live Hunyuan3D 2.0/2.1 lanes are out of compliance for any EU, UK or South Korean user unless a geo-gate exists; the license also forbids displaying those outputs there, so galleries and marketplace listings of Hunyuan-generated assets need region handling or a lane switch to TRELLIS.2 / SAM 3D for those users. This is the single most consequential legal finding of this sheet.
- The 1M-MAU clause is measured on each model's release date (Jan 21, 2025 for 2.0; June 13, 2025 for 2.1), so a platform that was under 1M MAU then stays licensed for those versions even after it grows; each new Tencent release re-tests.
- A fully MIT/Apache/SAM stack covering shape (TRELLIS.2, SAM 3D Objects, Pixal3D, PartCrafter), rigging (SkinTokens, Make-It-Animatable), motion (MDM already, MoMask, MotionGPT), and worlds (Matrix-3D, WorldGen code with a non-FLUX panorama model, lingbot-map) is achievable today with no territorial gating.
- Any motion lane built on SMPL-family skeletons must retarget to the platform's Wolf3D/Mixamo skeleton inside the worker and never redistribute SMPL assets; three.ws's existing video2motion workers already follow this pattern.

### Gaps
- Whether three.ws currently geo-blocks EU/UK/SK on the Hunyuan lanes was not checked (workers directory read-only; routing code not inspected for this task).
- The Stability license's revenue test applies to "You" (the licensee); whether three.ws's revenue is under US $1M is a business fact not in scope.
- Hunyuan3D-Part and HunyuanWorld-1.0 license texts were confirmed to use the same community template via README and license headers, but their full texts were not read line by line; MAU wording assumed identical.

## Q3. Best open auto-rigger and best open motion generator, and what skeleton formats they emit

### Takeaway
Rigging: VAST's SkinTokens/TokenRig (MIT, Feb 2026) is the state of the art for arbitrary (including non-humanoid) meshes and is the successor to UniRig, which three.ws retired in favor of Make-It-Animatable; Puppeteer and MagicArticulate (Apache-2.0) are the ByteDance Seed alternatives. Motion: HY-Motion 1.0 (Dec 2025) is the largest open text-to-motion model (1.0B, SMPL-H skeleton) but carries Tencent's territorial license; MIT choices remain MDM (already used), MoMask and MotionGPT.

### Cited Findings

**Auto-rigging**
- VAST-AI-Research/SkinTokens: 463 stars (2026-10-09), MIT, last push 2026-05-12, arXiv 2602.04805 (Feb 2026). TokenRig "models the entire rig, i.e., skeleton and skinning weights, as a single token sequence" on a Qwen3-0.6B transformer with GRPO refinement; README claims "98%-133%" improvement in skinning accuracy over UniRig; needs "at least 14 GB" GPU memory; demo input/output is GLB (`demo.py --input examples/giraffe.glb --output results/giraffe.glb`), with `--use_skeleton` to skin an existing skeleton; trained on ArticulationXL 2.0 + VRoid Hub + ModelsResource. [Source](https://github.com/VAST-AI-Research/SkinTokens); weights [Source](https://huggingface.co/VAST-AI/SkinTokens)
- VAST-AI-Research/UniRig: 1,804 stars (2026-10-09), MIT; accepts obj/fbx/glb/vrm, outputs FBX skeleton and skinning plus merged GLB, 8 GB VRAM, Articulation-XL2.0 checkpoint. [Source](https://github.com/VAST-AI-Research/UniRig)
- Seed3D/Puppeteer: 427 stars (2026-10-09), Apache-2.0, NeurIPS 2025 spotlight; skeleton + skinning + video-guided animation; FBX export requires `bpy` 4.2.0. [Source](https://github.com/Seed3D/Puppeteer)
- Seed3D/MagicArticulate: 417 stars (2026-10-09), Apache-2.0; skeleton generation (no skinning) from meshes. [Source](https://github.com/Seed3D/MagicArticulate)
- jasongzy/Make-It-Animatable: 463 stars (2026-10-09), MIT; humanoid-focused, already three.ws's rig worker (Mixamo skeleton + ARKit-52 blendshapes via ICT-FaceKit per the worker README). [Source](https://github.com/jasongzy/Make-It-Animatable)
- The Stroke3D paper reports that UniRig and MagicArticulate are weaker on animals and plants than on humanoids. [Source](https://arxiv.org/abs/2509.00000)
- SkinTokens' README shows a qualitative comparison "TokenRig vs. Puppeteer vs. UniRig" where baselines "suffer from bleeding artifacts across disconnected mesh parts". [Source](https://github.com/VAST-AI-Research/SkinTokens)

**Motion generation**
- Tencent-Hunyuan/HY-Motion-1.0: 2,586 stars (2026-10-09); "TENCENT HY-MOTION 1.0 COMMUNITY LICENSE AGREEMENT", release date December 30, 2025, EU/UK/SK excluded, 1M MAU gate. [Source](https://github.com/Tencent-Hunyuan/HY-Motion-1.0/blob/HEAD/License.txt)
- HY-Motion 1.0 is "a series of text-to-3D human motion generation models based on Diffusion Transformer (DiT) and Flow Matching" producing "skeleton-based 3D character animations"; the README credits SMPL/SMPL-H, i.e. the output skeleton is SMPL-H; 1.0B and 0.46B-Lite variants; Jan 29, 2026 release of the SSAE evaluation code. [Source](https://github.com/Tencent-Hunyuan/HY-Motion-1.0)
- EricGuo5513/momask-codes: 1,327 stars (2026-10-09), MIT; HumanML3D 22-joint representation. [Source](https://github.com/EricGuo5513/momask-codes)
- OpenMotionLab/MotionGPT: 1,975 stars (2026-10-09), MIT. [Source](https://github.com/OpenMotionLab/MotionGPT)
- NVlabs/GENMO (renamed GEM): 522 stars (2026-10-09), NVIDIA OneWay Noncommercial. [Source](https://github.com/NVlabs/GENMO/blob/HEAD/LICENSE)
- zju3dv/GVHMR: 2,087 stars (2026-10-09), non-commercial research license. [Source](https://github.com/zju3dv/GVHMR/blob/HEAD/LICENSE)
- facebookresearch/sam-3d-body emits the MHR (Meta Human Rig) parametric body, an alternative to SMPL that Meta distributes under the SAM License rather than MPI's registration terms. [Source](https://github.com/facebookresearch/sam-3d-body)

### Inferences
- SkinTokens is the right upgrade for the "rig anything" gap (quadrupeds, creatures, props with articulation) that Meshy and Tripo advertise and three.ws's humanoid-only Make-It-Animatable lane cannot serve; MIT, GLB in/out, 14 GB VRAM fits existing L4/A10-class workers. Verdict: adopt code and weights as a second rig lane behind a "humanoid vs non-humanoid" classifier, keep Make-It-Animatable for humanoids (it gives Mixamo bones + blendshapes, which SkinTokens does not).
- HY-Motion 1.0 would be a quality jump over MDM but it brings the Tencent geo-gate plus SMPL-H retargeting; the 0.46B-Lite still needs about 24 GB VRAM per the README. Verdict: adopt design (DiT + flow matching, large pretrain) only; keep MDM/MoMask for a worldwide lane, or run HY-Motion only for non-EU/UK/SK users.
- Skeleton formats: HY-Motion, MoMask, MotionGPT and GVHMR all emit SMPL-family joint rotations; UniRig/Puppeteer emit FBX or GLB with arbitrary predicted skeletons; SkinTokens emits GLB with a predicted skeleton; Make-It-Animatable emits a Mixamo-compatible rig. Any lane added needs a retarget step to three.ws's canonical Wolf3D/Mixamo skeleton in `src/glb-canonicalize.js` terms.

### Gaps
- Independent benchmark numbers (e.g. on Articulation-XL test split) comparing SkinTokens vs Puppeteer vs Make-It-Animatable were not found outside the SkinTokens paper.
- HY-Motion's exact export format (BVH vs SMPL npz vs FBX) was not confirmed from the README grep; only the SMPL/SMPL-H credit and "skeleton-based" wording were captured.
- MotionGPT and MoMask have had no 2026 releases found; their current state may be unmaintained.

## Q4. Open world and scene generation models with usable licenses vs a text-to-3D-world feature

### Takeaway
Tencent HY-World 2.0 (April to May 2026) is the most capable open text/image-to-3D-world system, emitting meshes, 3DGS and point clouds importable into engines, but it is territorial and its full pipeline is about 100B parameters across stages. Worldwide-commercial alternatives are Skywork Matrix-3D (MIT, panorama video to scene) and WorldGen (Apache-2.0 code, but FLUX.1-dev dependency); NVIDIA Lyra 2.0 is Apache code with non-commercial weights. three.ws's Diorama (text to 3D world) and LingBot-Map (video to scene) already cover part of this.

### Cited Findings
- Tencent-Hunyuan/HY-World-2.0: 2,705 stars (2026-10-09), Tencent community license (release date April 15, 2026, same Territory and MAU terms). README news: April 16, 2026 tech report and WorldMirror 2.0 weights; May 11, 2026 HY-Pano 2.0 code and weights; May 18, 2026 World Generation inference code and WorldStereo 2.0 weights; "July, 2026: Update HY World 2.1! Try our product" (hosted only). [Source](https://github.com/Tencent-Hunyuan/HY-World-2.0); license [Source](https://github.com/Tencent-Hunyuan/HY-World-2.0/blob/HEAD/License.txt)
- HY-World 2.0 "produces 3D world representations (meshes / Gaussian Splattings)" from "text, single-view images, multi-view images, and videos"; outputs are "3DGS, meshes, and point clouds ... directly importable into Unity / Unreal Engine / Isaac"; pipeline is HY-Pano-2.0 (text/image to 360 panorama, ~80B, plus a ~425M Qwen LoRA variant) to WorldNav trajectory planning to WorldStereo 2.0 (panorama to 3DGS, ~17B) to WorldMirror 2.0 (multi-view to 3D, ~1.2B); README recommends FlashAttention-3 on Hopper and supports multi-GPU rendering. [Source](https://github.com/Tencent-Hunyuan/HY-World-2.0); weights [Source](https://huggingface.co/tencent/HY-World-2.0)
- Tencent-Hunyuan/HunyuanWorld-1.0: 2,943 stars (2026-10-09), community license, release date July 27, 2025, EU/UK/SK excluded. [Source](https://github.com/Tencent-Hunyuan/HunyuanWorld-1.0/blob/HEAD/LICENSE)
- Tencent-Hunyuan/HunyuanWorld-Voyager: 1,600 stars (2026-10-09), NOASSERTION (Tencent community). [Source](https://github.com/Tencent-Hunyuan/HunyuanWorld-Voyager)
- SkyworkAI/Matrix-3D: 844 stars (2026-10-09), MIT; text or image to panorama video to 3D scene. [Source](https://github.com/SkyworkAI/Matrix-3D/blob/HEAD/LICENSE); [Source](https://github.com/SkyworkAI/Matrix-3D)
- SkyworkAI/Matrix-Game: 2,346 stars (2026-10-09), MIT ("This project is licensed under the MIT License"), last push 2026-09-29; Matrix-Game-3.0 released March 27, 2026 as "a real-time and streaming interactive world model with long-horizon Memory" (video world model, not a mesh generator). [Source](https://github.com/SkyworkAI/Matrix-Game)
- ZiYang-xie/WorldGen: 2,154 stars (2026-10-09), Apache-2.0; text-to-scene and image-to-scene in seconds, splat or mesh output (`--return_mesh`), low-VRAM mode about 10 GB (Oct 5, 2025), ml-sharp support for better GS (Jan 10, 2026); requires accepting the gated FLUX.1-dev license. [Source](https://github.com/ZiYang-xie/WorldGen); license [Source](https://github.com/ZiYang-xie/WorldGen/blob/HEAD/LICENSE)
- nv-tlabs/lyra: 2,647 stars (2026-10-09), Apache-2.0 code; Lyra 2.0 released April 15, 2026 ("Explorable generative 3D worlds with long-horizon, 3D-consistent generation"), GUI and training code July 20, 2026, arXiv 2604.13036, ICLR 2026 and SIGGRAPH Asia 2026; weights under NVIDIA's non-production research license; outputs 3DGS .ply, built on Wan2.1-14B. [Source](https://github.com/nv-tlabs/lyra); [Source](https://huggingface.co/nvidia/Lyra-2.0)
- facebookresearch/scenescript: 385 stars (2026-10-09), CC-BY-NC-4.0 (structured scene language, not usable commercially). [Source](https://github.com/facebookresearch/scenescript/blob/HEAD/LICENSE)
- Robbyant/lingbot-map: 17,505 stars (2026-10-09), Apache-2.0 (already three.ws's video-to-scene worker). [Source](https://github.com/Robbyant/lingbot-map/blob/HEAD/LICENSE)
- World Labs Marble is proprietary; commercial rights are sold on a paid tier. [Source](https://marble.worldlabs.ai/)
- Splat and glTF tooling: nerfstudio-project/gsplat 5,762 stars (2026-10-09), Apache-2.0 [Source](https://github.com/nerfstudio-project/gsplat/blob/HEAD/LICENSE); sparkjsdev/spark 3,705 stars (2026-10-09), MIT, Spark 2.0 (April 14, 2026) renders 100M+ splats on WebGL2 and loads PLY/SPZ/SPLAT/KSPLAT/SOG [Source](https://github.com/sparkjsdev/spark); mkkellogg/GaussianSplats3D 2,905 stars (2026-10-09), MIT [Source](https://github.com/mkkellogg/GaussianSplats3D/blob/HEAD/LICENSE); donmccurdy/glTF-Transform 1,983 stars (2026-10-09), MIT [Source](https://github.com/donmccurdy/glTF-Transform/blob/HEAD/LICENSE); zeux/meshoptimizer (gltfpack) 8,524 stars (2026-10-09), MIT [Source](https://github.com/zeux/meshoptimizer/blob/HEAD/LICENSE.md); ahujasid/blender-mcp 30,273 stars (2026-10-09), MIT [Source](https://github.com/ahujasid/blender-mcp/blob/HEAD/LICENSE).

### Inferences
- HY-World 2.0 is the only open system that outputs engine-ready meshes plus 3DGS plus navmesh-planned trajectories from a single prompt; it is what a "text to explorable 3D world" feature should be benchmarked against. But the ~80B HY-Pano-2.0 stage and the ~17B WorldStereo 2.0 stage need multi-GPU Hopper hardware, and the territorial license applies to the outputs' display. Verdict: adopt design, rebuild on worldwide-licensed parts (a permissive panorama model, then Matrix-3D or WorldGen-style lifting, then lingbot-map reconstruction).
- WorldGen's Apache-2.0 code is usable but its FLUX.1-dev dependency is non-commercial; swapping the panorama generator for a GCP-hosted Imagen or an Apache-licensed diffusion model is required before production. Verdict: adopt code, replace the panorama model.
- Matrix-3D (MIT) is the cleanest fully open text/image to 3D scene path; quality claims are unverified, so run a bake-off against the Diorama lane.
- Lyra 2.0 is a reference for long-horizon 3D-consistent generation but cannot ship (weights non-commercial). Verdict: adopt design only.
- Spark 2.0 (MIT) matches or exceeds what the three.ws Splat Viewer needs (100M splats, SOG/SPZ formats); if the viewer is still on GaussianSplats3D, upgrading is a low-risk win. Verdict: adopt code.

### Gaps
- HY-World 2.0's exact per-stage VRAM and wall-clock were not in the README excerpt captured; "multi-GPU recommended" came from a secondary source.
- Matrix-3D output quality, resolution and runtime were not captured from primary text.
- Which splat library the three.ws Splat Viewer currently uses was not checked in this task.
- WorldGen's splat quality vs mesh quality and its panorama-model swap feasibility were not tested.

## Q5. Commercial-only competitors (Meshy, Tripo, Rodin/Hyper3D, Luma, Kaedim, Mixamo): features three.ws lacks

### Takeaway
The commercial leaders have converged on the same bundle: sub-15-second textured generation, quad retopology at generation time, PBR up to 8K, built-in auto-rig for humanoids AND non-humanoids with hundreds of animation presets, segmentation/decimate/remesh/UV API endpoints, multiple-image conditioning, and MCP servers plus engine plugins. three.ws has pieces (rig, remesh, PBR via Hunyuan3D 2.1) but not the non-humanoid rig, animation preset library, quad topology at generation, part segmentation, or multi-image input.

### Cited Findings
- Meshy: the Meshy-6 generation (January 2026) adds quad or triangle topology selection at generation time, A/T-pose output, auto-rigging for humanoid and quadruped characters with a library of several hundred animation presets, FBX/GLB export, Remesh/Convert/Resize/UV-unwrap API endpoints (2026), 8K base color textures (July 2026), PBR including emission, printability checks, and an MCP server. [Source](https://docs.meshy.ai/en/changelog)
- Tripo 3.1: about 10 s to a textured model; Rigging 1.0 for bipeds and Rigging 2.5 for non-bipeds (quadruped, hexapod, avian, serpentine, aquatic), retarget presets, segmentation v1/v2, Smart Mesh P1.0 quad retopology in about 2 s; API endpoints `/v3/mesh/segment`, `/v3/mesh/decimate`, `/v3/animations/rig`, rig-check and retarget; CLI (June 2026), MCP server and engine plugins. [Source](https://platform.tripo3d.ai/docs)
- Rodin Gen-2 (Hyper3D): 10B-parameter BANG model, up to 5 input images, quad output (1k to 200k faces) or raw triangle (500 to 1M), PBR or shaded textures, bounding-box control, T/A pose, GLB/FBX/OBJ/USDZ/STL export; Gen-2.5 tiers. [Source](https://hyper3d.ai/)
- Luma Genie: four quad-mesh candidates per prompt, FBX/GLTF/USDZ/Blend/STL/OBJ export. [Source](https://lumalabs.ai/genie)
- Mixamo: free, Adobe-hosted humanoid auto-rig and animation library; no feature updates found in 2026 (competitors position against it as stagnant). [Source](https://www.mixamo.com/)

### Inferences
- The highest-leverage gaps for three.ws, in order: (1) non-humanoid auto-rig plus a retarget preset library (SkinTokens + the existing clip library retargeter in `src/animation-retarget.js`), (2) part segmentation and part-level generation (PartCrafter, Hunyuan3D-Part P3-SAM), (3) quad topology at generation time (QuadriFlow exists in the remesh worker; expose it as a generation option and benchmark against Tripo's 2 s Smart Mesh), (4) multi-image conditioning (TRELLIS.2 and Hunyuan3D 2.1 support multi-view inputs; Rodin accepts 5), (5) a public mesh-ops API surface (segment, decimate, remesh, UV) that mirrors Tripo and Meshy endpoints, since three.ws already has the workers.
- Speed: Tripo's ~10 s textured and Rodin's quad output are set by proprietary models; the open path to similar latency is TRELLIS.2 at 512^3 (3 s on H100) plus the existing PBR lane, which three.ws can host on GCP credits.

### Gaps
- Kaedim: no reliable primary source describing 2026 features was found; only marketing copy for image-to-3D exists, so it is not characterized here.
- Meshy and Tripo pricing, rate limits and output license terms were not captured.
- Luma Genie's 2026 status (whether still maintained after Luma's video focus) was not confirmed.
- Rodin Gen-2.5 tier specifics were not captured from a primary page.

## Per-repo verdict table

| Repo | Stars (2026-10-09) | Code license | Weights license | Worldwide commercial? | Standout vs three.ws | Verdict |
|---|---|---|---|---|---|---|
| microsoft/TRELLIS.2 | 11,509 | MIT | MIT (HF) | Yes | 4B O-Voxel, PBR, 1536^3, 3-60 s H100 | Adopt code+weights |
| facebookresearch/sam-3d-objects | 7,496 | SAM License | SAM License | Yes (Trade Control clauses) | Real-photo shape+texture+layout, splats, SA-3DAO | Adopt code+weights |
| facebookresearch/sam-3d-body | 3,602 | SAM License | SAM License | Yes | MHR body from one image | Adopt for avatar reconstruction |
| TencentARC/Pixal3D | 2,435 | MIT | MIT | Yes | Pixel-aligned, SIGGRAPH 2026, fresh | Bake-off then adopt |
| wgsxm/PartCrafter | 2,488 | MIT | MIT | Yes | Part-level meshes from one image | Adopt code+weights |
| Tencent-Hunyuan/Hunyuan3D-2 / 2.1 | 15,037 / 4,147 | Tencent community | Tencent community | No (EU/UK/SK excluded, 1M MAU) | Best open PBR painter | Already covered; add geo-gate |
| Tencent-Hunyuan/Hunyuan3D-Part | 546 | Tencent community | Tencent community | No | P3-SAM segmentation, X-Part | Adopt design, rebuild (PartCrafter) |
| Tencent-Hunyuan/Hunyuan3D-Omni | 639 | Tencent community | Tencent community | No | Pose/bbox/voxel control | Adopt design |
| DreamTechAI/Direct3D-S2 | 1,285 | MIT | MIT | Yes | 1024^3 sparse SDF at 24 GB | Bake-off |
| Stable-X/Stable3DGen | 1,279 | MIT | MIT | Yes | Normal-bridged geometry fidelity | Bake-off |
| stepfun-ai/Step1X-3D | 896 | Apache-2.0 | Apache-2.0 | Yes | Two-stage, 27-29 GB | Already covered class |
| Stability SF3D / SPAR3D | 1,843 / 1,078 | Stability community | Stability community | Only under US $1M revenue | Fast, point-aware | Skip |
| VAST-AI-Research/SkinTokens | 463 | MIT | MIT (HF) | Yes | Unified rig for any mesh, 14 GB | Adopt code+weights (non-humanoid lane) |
| VAST-AI-Research/UniRig | 1,804 | MIT | MIT | Yes | FBX/GLB rig, 8 GB | Superseded by SkinTokens |
| Seed3D/Puppeteer | 427 | Apache-2.0 | Apache-2.0 | Yes | Rig + video-driven animation | Bake-off vs SkinTokens |
| jasongzy/Make-It-Animatable | 463 | MIT | MIT | Yes | Mixamo rig + blendshapes | Already covered |
| Tencent-Hunyuan/HY-Motion-1.0 | 2,586 | Tencent community | Tencent community | No | 1.0B DiT text-to-motion, SMPL-H | Adopt design, rebuild |
| EricGuo5513/momask-codes, OpenMotionLab/MotionGPT | 1,327 / 1,975 | MIT | MIT | Yes | Masked / LLM motion | Already covered by MDM; optional |
| NVlabs/GENMO, zju3dv/GVHMR | 522 / 2,087 | Noncommercial | Noncommercial | No | | Skip |
| Tencent-Hunyuan/HY-World-2.0 | 2,705 | Tencent community | Tencent community | No | Mesh+3DGS+pointcloud worlds, navmesh | Adopt design, rebuild |
| SkyworkAI/Matrix-3D | 844 | MIT | MIT | Yes | Text/image to 3D scene | Bake-off vs Diorama |
| SkyworkAI/Matrix-Game | 2,346 | MIT | MIT | Yes | Real-time interactive video world model | Adopt design (not a mesh lane) |
| ZiYang-xie/WorldGen | 2,154 | Apache-2.0 | FLUX.1-dev gated (non-commercial) | Code yes, panorama model no | Seconds-fast scene, 10 GB low-VRAM | Adopt code, swap panorama model |
| nv-tlabs/lyra | 2,647 | Apache-2.0 | NVIDIA research-only | No (weights) | Long-horizon 3DGS worlds | Adopt design only |
| Robbyant/lingbot-map | 17,505 | Apache-2.0 | Apache-2.0 | Yes | Video to scene | Already covered |
| sparkjsdev/spark | 3,705 | MIT | n/a | Yes | 100M+ splats, SOG/SPZ | Adopt code (viewer) |
| graphdeco-inria/gaussian-splatting | 24,145 | Inria/MPII research | n/a | No | Reference 3DGS | Use gsplat (Apache-2.0) instead |
