# Forge 3D quality: what to adopt next (2026-10-30)

Follow-up to [3d-landscape-2026-10.md](3d-landscape-2026-10.md). Licenses were read from the LICENSE files and Hugging Face cards on 2026-10-30, not from blog posts.

## Finding 1: the biggest quality gap is a deploy, not a new model

The repo already contains workers for TRELLIS.2, Pixal3D, PartCrafter, HoloPart, AniGen and SAM 3D Objects. In production only TRELLIS v1 serves image-to-3D: `/api/forge-quote` reports `trellis_selfhost`, and `gcloud run services list` shows no `model-trellis2` or `model-pixal3d`. `api/_lib/forge-tiers.js` routes every tier to `trellis2` first and skips it while `MODEL_TRELLIS2_URL` is unset, so every job silently falls back to v1.

Status on 2026-10-30:
- `model-trellis2`: Artifact Registry repo created, weights already staged at `gs://three-ws-model-weights/trellis2-4b/`, Cloud Build submitted (build `68a20930-157f-43ca-a298-aad01f4aa35f`, `three-ws-build@`, scale-to-zero). After it succeeds: smoke-test the service directly, then set `MODEL_TRELLIS2_URL` with `--update-env-vars`.
- `model-pixal3d`: no staged weights yet (not under `gs://three-ws-model-weights/`). Stage after TRELLIS.2 is verified.

## Finding 2: candidates that are new since the October 9 sweep

| Project | License (verified) | Fit | Verdict |
|---|---|---|---|
| [LoHhhha/LATO.2](https://github.com/LoHhhha/LATO.2) (Meshy, Jul 2026) | MIT code, MIT weights | Mesh in, artist-style low-poly mesh out. 200 to 5000 vertices, about 8 GB VRAM, about 5 s on an H800. Upstream warns outputs can contain holes. | **Adopt** as an "Artist mesh" retopology lane beside QuadriFlow, gated by a watertight check with QuadriFlow as the fallback. This is the first permissive open model that closes the retopology gap named in the October sweep. |
| [yiboz2001/UltraTex](https://github.com/yiboz2001/UltraTex) (SIGGRAPH Asia 2026) | MIT code; weights on ModelScope, license to be read before use | 2048 px multi-view diffusion texturing. Our `workers/texture` is SDXL plus ControlNet-Depth back-projection. | **Adopt** as the texture lane successor after reading the weights license. Triton kernels, Python 3.12, PyTorch 2.5.1. |
| [Stability-AI/arbor](https://github.com/Stability-AI/arbor) | MIT code; HF weights card says "other" | Text to 3D under hull, avoidance and touch constraint meshes, TRELLIS decoder. | **Evaluate** after TRELLIS.2 is live. Read the weights license first. Fits "fit inside this volume" and print-bbox use cases. |
| [PKU-YuanGroup/UltraShape-1.0](https://github.com/PKU-YuanGroup/UltraShape-1.0) | Repo LICENSE is the Tencent Hunyuan 3D 2.1 license (excludes EU, UK, South Korea); weights card says Apache-2.0 | Geometry refinement on a coarse mesh. | **Reject for now.** The code license carries the territory exclusion we already gate around. |
| [DerKleineLi/triflow](https://github.com/DerKleineLi/triflow) | Automotive Development Public Non-Commercial License | Artist-like topology. | **Reject.** Non-commercial. |
| [Xrvitd/MeshMosaic](https://github.com/Xrvitd/MeshMosaic), [Xrvitd/SATO](https://github.com/Xrvitd/SATO) | AGPL-3.0, GPL-3.0 | Artist-style meshes. | **Reject.** Copyleft in a hosted service. |
| [Roblox/cube](https://github.com/Roblox/cube) (CubePart) | NOASSERTION | Part-controllable generation. | **Reference only** until the LICENSE is read. |

## Finding 3: what to do with each

1. Finish the TRELLIS.2 deploy and flip the lane (in progress). Then Pixal3D on about 50 real inputs, promote the winner (the plan from `docs/ops/image-selfie-3d-review-2026-10-09.md`).
2. Build `workers/model-lato2`: FastAPI `/infer` taking a mesh URL and a vertex budget, validating the output is watertight, returning a GLB. Wire it as the `retopo` mode in `api/forge-gameready.js` and the pipeline remesh stage with QuadriFlow as the failover rung.
3. Build the UltraTex texture rung in `workers/texture` once the weights license is confirmed.
4. Open question that decides the roadmap: nvdiffrast (NVIDIA Source Code License) sits under both TRELLIS lanes. Replacing the bake rasteriser removes the only commercial-use risk in the default lane.
