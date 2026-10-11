# best3d: shared context for every `best3d-` work order

Not a work order. Never run this file; read it when an order names it.

## What the campaign is

On 2026-10-09 we swept the open-source and commercial 3D landscape to find what beats three.ws and what to take. The findings, license verdicts and ranking are in [docs/research/3d-landscape-2026-10.md](../../../docs/research/3d-landscape-2026-10.md). The rule the owner set: take a feature where the license allows, and where it does not, build a better original feature using the project only as reference.

## License rules (apply to every order)

| Verdict | Meaning | Examples |
|---|---|---|
| use | Becomes a dependency or a worker lane as-is. MIT, Apache-2.0, BSD. Keep the notice. | TRELLIS.2, Pixal3D, UniRig, SkinTokens, AniGen, PartCrafter, HoloPart, three-vrm, Spark, gltf-transform, MoMask |
| vendor | Copy a module or pattern under its license, with attribution. | TalkingHead, model-viewer attribute API |
| reference | License or closed source forbids reuse. Build our own; copy no code or assets. | all commercial vendors, Theatre.js (UI only), Babylon editors (UI only), Open-LLM-VTuber, HY-Motion, MotionLCM, SMPL-based models |
| gated | Usable only after an owner action or with enforcement. | Hunyuan3D family (EU, UK, South Korea excluded, 1M MAU cap, Notice file), NVIDIA Open Model License weights (never bundle in a package), SAM License (gated download, sanctions clause) |

Always re-read the upstream LICENSE file on the day you adopt: `gh api repos/<owner>/<name>/contents/LICENSE --jq .content | base64 -d | head -30`. `NOASSERTION` from the API means read the file.

## Facts every order relies on

- Commercial vendors are written "Vendor A, B..." in committed files (owner directive). Open-source projects are named.
- Solana first (CLAUDE.md). Generation lanes are chain-agnostic, but any payment, ownership or provenance step is built on Solana first.
- GPU workers deploy from their own `workers/<name>/cloudbuild.yaml` pinned to the `three-ws-build@` service account. Each worker needs a README. Shared worker code is vendored and checked by `npm run check:vendored`.
- Caller-supplied glTF is meshopt-decoded before it is read (`gltf_meshopt.decode_if_meshopt`).
- Avatar animation stays universal: no rig allowlist (CLAUDE.md stack notes).
- Weights live in `gs://three-ws-model-weights`.
- Existing capability map: the "What three.ws already has" table in the research doc. Do not rebuild it.

## Order map

| Order | Item |
|---|---|
| 067 | TRELLIS.2 default lane, Hunyuan territory enforcement (compliance fix, run first) |
| 068 | Pixal3D and multi-view input |
| 069 | Rig non-humanoids |
| 070 | Editable parts |
| 071 | LOD chains and engine QA |
| 072 | Unity, Unreal, Godot bridges |
| 073 | `<agent-3d>` AR and viewer contract |
| 074 | WebGPU and TSL path |
| 075 | three-vrm and orphaned-avatar import |
| 076 | Audio2Face-3D worker |
| 077 | Prompt-to-clip and timeline |
| 078 | Keep the rig |
| 079 | Signed exports and provenance |
| 080 | Scene Studio agent tab |
| 081 | Splat viewer parity |
| 082 | Companion presence |
| 083 | Generation controls and batch |
| 932 to 935 | Owner-gated: pricing preview, SAM 3D Objects, orphaned-avatar campaign, engine-store publishing |

Run 067 first. 068 and 069 build on 067's worker. 070 before 078. 074 before the TSL part of 080.
