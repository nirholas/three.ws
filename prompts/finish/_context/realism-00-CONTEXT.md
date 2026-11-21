# realism- campaign: shared context (orders 887 to 899)

Filed 2026-11-21. The work orders come from a sweep of new open-source projects that can make three.ws avatars look and move more like real people. The sweep checked every licence before anything was recommended. Each order reads this file in its Step 0. The facts here were measured on 2026-11-21, so re-verify anything an order depends on before you build on it.

## What the campaign delivers

Two tracks, plus documentation and measurement:

1. **Render realism for every avatar we already ship** (887 to 892): true subsurface scattering for skin on WebGL2 and WebGPU, skin micro-detail, eyes with depth, and anisotropic hair. These help every GLB the viewer loads, so they are the highest-leverage orders.
2. **A commercially clean body and face model** (893 to 896): Meta's MHR parametric human (Apache-2.0) as a reconstruction template, plus a SAM 3D Body GPU worker that turns a photo into MHR shape parameters. Together they give selfie reconstruction a real head and body shape instead of a fixed template.
3. **Splat avatars** (897, 898): animated Gaussian-splat avatars on our existing Spark renderer, and a page that turns a full-body splat scan into a rigged avatar.
4. **Ship batch** (899): integration, measured before/after numbers, and the single owner message.

| Order | File | One task | Needs |
|---|---|---|---|
| 887 | `887-realism-01-licence-record-and-engine-catalog.md` | Correct the MHR licence note, record verified licences, add the new engines to `/avatar-engines` | nothing |
| 888 | `888-realism-02-skin-sss-webgl2.md` | Screen-space subsurface scattering for skin in the WebGL2 cinematic chain | nothing |
| 889 | `889-realism-03-skin-sss-webgpu.md` | The same skin SSS on the WebGPU (TSL) path, at parity with 888 | nothing (reuses 888's mask module if present) |
| 890 | `890-realism-04-skin-micro-detail.md` | Pore-level detail normal, cavity and specular occlusion on skin | nothing |
| 891 | `891-realism-05-eye-shading.md` | Iris parallax under the cornea, limbal ring, wet eye occlusion | nothing |
| 892 | `892-realism-06-hair-shading.md` | Anisotropic hair highlights and order-independent cutout transparency | nothing |
| 893 | `893-realism-07-mhr-template-glb.md` | Build an MHR avatar template GLB with our skeleton names, ARKit-52 and visemes | nothing |
| 894 | `894-realism-08-recon-template-mhr.md` | `RECON_TEMPLATE=mhr` in the avatar-reconstruction worker, staged and verified | 893 |
| 895 | `895-realism-09-sam3d-body-worker.md` | New `workers/model-sam3d-body` GPU worker: photo to MHR parameters | nothing (live weights need the owner's HF click) |
| 896 | `896-realism-10-identity-shape-fit.md` | Fit MHR head and body shape from the user's photos inside reconstruction | 894, 895 |
| 897 | `897-realism-11-skinned-splat-runtime.md` | Skinned Gaussian-splat avatars on Spark, driven by our animation clips | nothing |
| 898 | `898-realism-12-splat-scan-to-avatar.md` | A page that turns an uploaded full-body splat scan into a saved, rigged avatar | 897 |
| 899 | `899-realism-13-integrate-measure-ship.md` | Integration, perf and likeness numbers, one batched owner message | run last |

## Independence rules (read before you start)

- **Every order runs alone in a fresh chat and finishes on its own.** Nothing waits on another session.
- **Prerequisite fallback.** If an order lists a prerequisite and its Step 0 finds that prerequisite missing (no output on disk and no line in `realism-PROGRESS.md`), the same session opens the prerequisite's order file and does all of it first, including its close-out, then continues. Never run an order at the same time as its own prerequisite. Everything else is safe to run in parallel.
- **Sibling work on disk.** If you see a sibling order's output (a module, a flag, a template), reuse it where it fits and never duplicate it. Never *require* it unless the table above says so.
- **Dev ports.** Each order uses its own port: the order number plus 4000 (887 uses 4887, up to 899 on 4899). Start with `npx vite --port <port> --strictPort`.
- **Hot shared files are edited last, with the smallest hook possible, re-read right before each edit:** `src/viewer.js`, `src/shared/avatar-material-realism.js`, `src/render/webgpu-material-compat.js`, `src/viewer/cinematic.js`, `src/viewer/cinematic-tsl.js`, `src/element.js`, `data/changelog.json`, `data/pages.json`, `STRUCTURE.md`, `package.json`, `workers/avatar-reconstruction/recon_templates.py`, `workers/avatar-reconstruction/main.py`. Put the logic in a new module that the order owns, and touch a hot file only to call it.
- **Commit your own work promptly with explicit paths.** Other agents run `git add -A` sweeps. See CLAUDE.md "Concurrent agents share this worktree". The private-index commit recipe in memory (`GIT_INDEX_FILE` + `commit-tree` + `update-ref`) is the safe way to do this when the shared index already holds other agents' staged files.

## The shared realism option (so the render orders converge)

Orders 888 to 892 each add one feature behind the same switch. The first order to land creates the plumbing. Later orders reuse it and never create a second one.

- **Module directory:** `src/shared/realism/`. One file per feature: `skin-mask.js` (classifies skin, eye and hair meshes and is shared by 888, 889 and 890), `skin-sss.js` (WebGL2), `skin-sss-tsl.js` (WebGPU), `skin-detail.js`, `eye-shading.js`, `hair-shading.js`, and `options.js`.
- **`src/shared/realism/options.js`** exports `resolveRealismOptions(input)`. The input is `options.realism` from the Viewer constructor, or the `realism` attribute of `<agent-3d>`. It returns `{ sss, skinDetail, eyes, hair }` as booleans. Each key is on unless it is explicitly `false`. The string `realism="off"` turns everything off, and a comma list such as `realism="sss,eyes"` turns on only the features it names. `viewerLooksLowPower()` turns off the expensive features (`sss`, and `hair` when it needs extra passes) unless the caller set them explicitly.
- **Classification:** reuse the regexes in `src/shared/avatar-material-realism.js` (`SKIN_NAME_RE`, `WOLF3D_SKIN_RE`, `EYE_NAME_RE`, `HAIR_NAME_RE`, `TEETH_NAME_RE`) through `skin-mask.js`. Never fork them. New avatar sources (MHR, splat) name their materials to match these regexes.
- **Fallback:** when a feature is off or unsupported, the current material pass (sheen as an SSS stand-in, clearcoat eyes, sheen hair with alpha test) stays exactly as it is today. `tests/avatar-material-realism.test.js` must keep passing unchanged.
- **Performance budget:** at most a 15% frame-time rise for the whole realism stack on the default WebGL2 path, measured with `scripts/viewer-renderer-bench.mjs` (`?bench`) on the default avatar. Each order records its own share in its doc.

## Licences (verified 2026-11-21; nothing outside this table ships)

| Project | Licence | Use |
|---|---|---|
| MHR, Momentum Human Rig (`facebookresearch/MHR`, pip `mhr==1.0.1`) | Apache-2.0, including the weights in the release zip (`LICENSE.txt` inside it) | 893, 894, 896. Ship a NOTICE with the template. |
| SAM 3D Body (`facebookresearch/sam-3d-body`, HF `facebook/sam-3d-body-dinov3` 840M, `facebook/sam-3d-body-vith` 631M) | SAM License: commercial use allowed worldwide, attribution required, gated on Hugging Face | 895, 896 |
| Anny (`naver/anny`) | Apache-2.0 | already the v3 `parametric` template |
| ICT-FaceKit | MIT | already in `workers/rig/build_arkit_template.py` and the `parametric` template |
| gaussian-vrm (`naruya/gaussian-vrm`) | MIT for the code and the Google Drive sample avatars. **Its `assets/` directory (including `sotai.vrm`) is NOT MIT and never ships.** | 897, 898: port the binding logic, never copy the assets |
| Spark (`@sparkjsdev/spark`, already ^2.3.1) | MIT | the only splat renderer we use |
| MediaPipe Tasks Vision (`@mediapipe/tasks-vision`, already ^1.2.3) | Apache-2.0 | 898 pose landmarks |

**Banned (non-commercial or registration-gated):** FLAME, BFM, SMPL, SMPL-X, SMPL-H, MANO, STAR, and any model whose weights carry those licences, which covers many face and body papers that build on them. If an upstream repo pulls one of these in, find the MHR path or the ICT-FaceKit path instead. Never vendor it. The MHR to SMPL converter in pip `mhr` must never be called, because its output is SMPL topology.

**The October note is wrong.** `docs/research/oss-landscape-2026-10-notes/3d-generation.md` says SAM 3D Body emits MHR "which Meta distributes under the SAM License". MHR is Apache-2.0. Order 887 corrects it.

## The one owner action (batched to 899)

The SAM 3D Body checkpoints are gated on Hugging Face. On 2026-11-21, both tokens in GCP Secret Manager (`hf-token` and `hf-token-2`, project `aerial-vehicle-466722-p5`) returned 403 on `facebook/sam-3d-body-dinov3` and `facebook/sam-3d-body-vith`. The owner has to sign in to huggingface.co as the account behind `hf-token`, open each model page, and accept Meta's licence. No agent can do that click. Everything else, including the worker, its tests, its staging script and the reconstruction phase that calls it, is built and verified without the weights. The only remaining step is `npm run stage:sam3d-body -- --accept-sam-license` followed by one worker build. Check for access at the start of 895, 896 and 899, because the owner may already have clicked:

```bash
HF_TOKEN=$(gcloud secrets versions access latest --secret=hf-token --project aerial-vehicle-466722-p5) \
  curl -s -o /dev/null -w '%{http_code}\n' -H "Authorization: Bearer $HF_TOKEN" \
  https://huggingface.co/api/models/facebook/sam-3d-body-dinov3/tree/main
```

A 200 means access is granted, so finish the live proof.

## Deploy policy for this campaign

- **Pre-approved:** deploying a new, unwired worker service (nothing in production calls it yet) and a staging revision for verification. This includes `avatar-reconstruction-dense-staging` through `workers/avatar-reconstruction/cloudbuild.staging.yaml`, and Cloud Build verify-only runs. Config-only `gcloud run services update <side service> --update-env-vars` is also pre-approved. Never use `--set-env-vars`.
- **Owner-gated (batched to 899):** `git push threews main`, `npm run deploy:gcp:full`, pointing a production env var at a new worker (`three-ws-api`), flipping `RECON_TEMPLATE=mhr` on the production reconstruction service, and making realism features default-on in production if an order shipped them default-off.
- **GPU region:** us-central1 L4 quota is starved (model-trellis min 2 plus model-rig hold all 3). Put new GPU lanes in another region that has L4 or RTX quota. Check with `gcloud compute regions describe <region> --project aerial-vehicle-466722-p5 --format='value(quotas)'` and the Cloud Run GPU quota page. Run long GPU jobs through Cloud Build, never as local docker runs (those die when the session ends). Set `TMPDIR=/home/user/.cache/gcloud-tmp` for `gcloud builds submit`, because the root disk is full.
- **Vertex AI** returned billing 403s in November 2026. No order in this campaign depends on Vertex.

## Measurement (the numbers 899 reports)

- **Render cost:** `node scripts/viewer-renderer-bench.mjs` (read its header for flags) on the default avatar, with realism on and off, on WebGL2 and on `?renderer=webgpu`.
- **Likeness:** `node --env-file=.env scripts/likeness-eval.mjs --live=10 --out=reports/likeness-<template>.json` with the QA account and synthesised subjects. The gate is 4.0. Run it with `RECON_TEMPLATE` pointed at a staging revision for each template being compared.
- **Visual evidence:** before and after screenshots of the same avatar, camera and lighting, saved in the order's doc folder under `docs/realism/`. Never commit screenshots to the repo root.

## Explicitly out of scope (one line each in 899's report)

- Strand hair generation: no commercially clean open model exists as of 2026-11-21. 892 improves card-hair shading only.
- MHR body-shape sliders in Avatar Studio: a product decision for later. 893 exposes the shape parameters in the template metadata so a later order can build on them.

## Progress log

`prompts/finish/_context/realism-PROGRESS.md`. Each order appends one dated line on close-out.
