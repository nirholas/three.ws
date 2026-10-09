# Image-to-3D and selfie-to-avatar: review and plan (2026-10-09)

Users keep complaining about two features: photo to 3D model (`/image-to-3d`, Forge's `image` path) and selfie to rigged avatar (`POST /api/avatars/reconstruct`). This review measures both against production data, finds the causes, lists what has already been fixed, and orders the remaining work by impact. It names the decisions only the owner can make and what each one costs.

Every number below comes from the production database (`forge_creations`, `avatar_regen_jobs`, `avatar_likeness_scores`, `feedback_reports`) or Cloud Run logs, read on 2026-10-09. Rows with `internal = true` are excluded.

## Summary

1. **Photo to 3D fails on roughly one job in five, and volume has fallen by 85%.**
   - The worst week was the worker outage of Sep 21, at a 91% failure rate.
   - The current week runs at 10%.
   - Users noticed: weekly photo jobs fell from 5,769 (week of Aug 31) to 850 (week of Oct 5).
2. **The engine configured as the default never runs.**
   - TRELLIS.2 is the free default at every tier (`FREE_DEFAULT_FOR_TIERS`).
   - `MODEL_TRELLIS2_URL` is not set in production, and the `model-trellis2` image has never been built. Every job silently falls through to TRELLIS v1.
3. **Selfie avatars do not look like the person, and that is a limit of the architecture, not a bug.**
   - The reconstruction worker fits one template body and pastes a warped face texture onto it.
   - Across the 29 avatars scored by the likeness harness, the mean face similarity is 0.218 (SFace cosine). The same-person threshold is 0.363.
   - No scored avatar reaches the 4/5 likeness gate. Only 3 of 29 count as the same person even once.
4. **Vertex AI is denied for the whole GCP project by a billing hold.**
   - Every Gemini call returns `403 Lightning dunning decision is deny for project: projects/93741856042`, including text models.
   - Documented since 2026-08-27 in [llm-lanes.md](llm-lanes.md). Re-measured today: still denied.
   - Production logs it more than 100 times an hour.
   - It disables the Gemini reference image step, the forge quality gate, and the vision checks. It also blocks every selfie improvement that needs an identity-preserving image edit.
   - Only the owner can clear it.

## 1. Photo to 3D: what fails

### Weekly outcome, uploaded-photo jobs

| Week of | Jobs | Failed | Rate |
|---|---|---|---|
| Sep 14 | 4,065 | 649 | 16% |
| Sep 21 | 2,137 | 1,943 | 91% (Hunyuan3D and TRELLIS self-host down together) |
| Sep 28 | 1,576 | 345 | 22% |
| Oct 5 | 850 | 87 | 10% |

Over 30 days there were 10,085 jobs from 6,098 clients, and 3,075 failed (30%).

### Failure causes, last 8 days

| Cause | Jobs | Recovered by failover | Status |
|---|---|---|---|
| Hunyuan3D "internal error" | 80 | 56 | About 12 are dropped image fetches (fixed below). The rest are inference errors in `model-hunyuan3d-21-rtx`. |
| NVIDIA key rejected | 62 | 0 | Stopped on Oct 6. The key verifies today and the lane completes jobs again. |
| TripoSG "internal error" | 55 | 5 | **Fixed in code** (see below). Every TripoSG photo job was failing. |
| TRELLIS self-host orphaned task | 50 | 49 | Failover recovers almost all of them. Root cause: instances reclaimed mid-job. |
| TRELLIS v1 "internal error" | 39 | not recorded | Malformed worker responses and `zero-size array` errors in `model-trellis`. |
| NVIDIA NVCF request expired | 25 | not recorded | Vendor-side queue timeout. |
| Image host unreachable or 403 | about 20 | not recorded | Partly fixed (retry). See "Reference images" below. |

Latency is a second complaint. TRELLIS self-host takes 180 to 260 s at the median and 300 to 620 s at p90. Hunyuan3D takes about 90 s at the median.

### Fixed today (committed, ships with the next worker deploys)

- **Dropped image fetches are retried.**
  - Forge reference images are served from the public R2 dev endpoint (`pub-…r2.dev`). Cloudflare rate-limits that endpoint and it drops connections under load.
  - Each drop failed the job as an opaque internal error on TripoSG (18 log hits in 7 days) and Hunyuan3D (24).
  - `worker_security.fetch_remote_bytes`, which every worker vendors, now retries dropped connections, timeouts and 429/5xx answers twice, with backoff. Refusals and other 4xx answers stay final.
  - Covered by `workers/model-triposg/test_fetch_retry.py` and mirrored to all 20 workers.
- **TripoSG no longer crashes on a blank input.**
  - Upstream `load_image` returns an error *string* for a black or fully transparent image, and `prepare_image` then calls `.permute` on it.
  - That was 11 of the TripoSG failures in three days.
  - The worker now reports `input image unusable: …`, so bad inputs are distinguishable from faults.
- **Lane-order and worker docs corrected:** [image-to-3d.md](../image-to-3d.md), [avatar-reconstruction.md](../avatar-reconstruction.md) and [gcp-model-workers.md](gcp-model-workers.md).

### Reference images: the structural fix

The R2 dev endpoint is not meant for production traffic, and the retry only papers over that.
- `three.ws` DNS is hosted at the registrar, not on Cloudflare, so an R2 custom domain is not a one-click change.
- The better fix is to write forge reference images to the GCS bucket the workers already use: same project, same region, no rate limit, and no extra egress hop.
- Until then the retry absorbs the drops.

## 2. Photo to 3D: the engine

### The TRELLIS.2 gap

`api/_lib/forge-tiers.js` routes every tier to `trellis2` first and skips it when `MODEL_TRELLIS2_URL` is unset, which is the case in production.
- The worker code, `cloudbuild.yaml` and staged weights (`gs://three-ws-model-weights/trellis2-4b/`) all exist. Only the build and deploy never happened.
- L4 capacity is not the blocker. `npm run gpu` shows:
  - us-central1: 2 of 3 used.
  - us-east4: 1 of 3 used, by a `model-trellis` instance pinned warm that serves no production traffic.
  - europe-west4: 0 of 8 used.
  - asia-southeast1: 0 of 8 used.

  The capacity script had hidden those grants. That is fixed in `a13dd7f1a`.

### Which open models lead

Two public arenas were checked on 2026-10-09: the HF 3D Arena and the Crafiq arena.

| Model | Licence | Notes |
|---|---|---|
| Pixal3D (TencentARC) | MIT | Best open model on Crafiq (1529). Built on TRELLIS.2. Its HF gate disallows the EU, so check the gate terms before serving there. |
| TRELLIS.2 | MIT | Crafiq 1489. Already built for, never deployed. |
| Hunyuan3D 2.1 | Tencent territory licence | Crafiq 1488. Excludes the EU, UK and KR, and §5(b) bars using its outputs to improve other models. |
| SAM 3D Objects | SAM License (commercial use allowed) | 32 GB. A second open failover candidate. |
| TripoSG | MIT code | Geometry only, no texture. Its background-removal model, BRIA RMBG-1.4, is **non-commercial**. Swap it for BiRefNet (MIT) or remove the photo rung. |

Paid models lead both arenas: Tripo H3.1 (Crafiq 1792), Hunyuan 3.1 (1773) and Rodin 2.5 (1635). Hunyuan 2.5 and 3.x are API-only.

### Recommended engine chain

1. **Self-hosted primary:** deploy TRELLIS.2 now. Then run Pixal3D against it on about 50 real inputs and promote whichever wins.
2. **Self-hosted failover:** TRELLIS v1 (already live), then SAM 3D Objects.
3. **Hunyuan3D 2.1:** keep it only where its licence covers the request (already territory-gated), and stop treating it as the people specialist.
4. **Paid quality tier (needs owner approval):** Tripo H3.1 direct, at roughly $0.30 to $0.40 per model with 3 concurrent jobs on the base plan. Only for the High tier, which is already $THREE-gated.

## 3. Selfie to avatar

### What runs today

`workers/avatar-reconstruction` runs on CPU only:
1. MediaPipe FaceMesh finds 468 face landmarks.
2. A thin-plate-spline warp maps those landmarks onto the UV map of the stock template body (`default.glb`).
3. rembg removes the background. A sparse morph and a projective texture follow.

Every body type maps to the same template, and the side photos are decoded but never used. The result is rigged and has blendshapes, but the head shape is the template's and only the texture comes from the photo. That explains the likeness score.

| Measure (last 60 days) | Value |
|---|---|
| Reconstruct jobs | 337 (209 done, 128 failed, 38%) |
| Failure causes | 78 internal errors, 27 orphaned, 23 pipeline unavailable. Spiked on Sep 30 (13 of 16 failed); clean since Oct 2. |
| Likeness, scored avatars | 29 ok, 10 render unusable, 5 with no capture |
| Mean SFace cosine | 0.218 (same-person threshold 0.363) |
| Mean worst-view cosine | 0.169 |
| Score 4/5 or better | 0 |

### Options

| Option | Commercial | Rigged | Cost per avatar | Time to ship |
|---|---|---|---|---|
| **A. Hybrid on GCP:** Gemini edits the selfie into a full-body A-pose reference (identity-gated by our scorer), TRELLIS.2 builds the body, and a FLAME 2023 Open head (CC-BY-4.0) fitted to the *original* selfie, with the selfie projected onto its UV, replaces the generated head. Rig with our canonicalizer. | Yes | Yes | About $0.30 to $0.60 in GCP credits | Weeks. Blocked on the Vertex billing hold. |
| **B. Buy: Avatar SDK MetaPerson.** One selfie in, a Humanoid-rigged GLB out, Mixamo compatible. $800 a month for 6,000 avatars, $0.03 per extra. 7-day API trial. The REST API is Enterprise, priced by quote. | Yes (paid) | Yes | $0.13 at full quota | Days |
| **C. Buy: Avaturn.** $800 a month for 1,000 avatars, $0.15 per extra, API included. We already have an unused client (`src/avaturn-client.js`). | Yes (paid) | Yes, ARKit blendshapes | $0.80 at full quota | Days |
| **D. Research bench: PSHuman** (MIT, needs more than 40 GB of VRAM, cross-scale diffusion built to keep faces), rigged afterwards. | Yes in SMPL-free mode | After rigging | GPU minutes | Weeks, plus evaluation |

Models ruled out for licence reasons:
- LAM and LHM++ weights are CC-BY-NC.
- Sapiens is CC-BY-NC.
- InstantID checkpoints and PuLID-FLUX are effectively non-commercial.
- The InsightFace `buffalo_l` and `antelopev2` weights are research-only.
- SMPL-X needs a paid licence.

Ready Player Me's public API shut down on 2026-01-31.

No vendor publishes face-identity numbers, so every option must be measured with our own harness before money is committed (`scripts/likeness-eval.mjs`, synthetic subjects only, see [likeness-eval.md](../likeness-eval.md)). SFace is a sound gate: Apache-2.0 and on a par with ArcFace on LFW. AdaFace IR101 is the best second opinion for rendered faces once its weights licence is confirmed. Targets: 0.363 or above is the same person and the floor for a 4/5; 0.5 or above is good.

### Recommendation

Use the MetaPerson trial (B) and the existing Avaturn client (C) as a measured baseline this week, since both cost nothing to test. Build the hybrid (A) as the long-term, self-owned path once Vertex is back. Buy B or C only if it clears 0.363 on our harness and A cannot match it within a few weeks.

## 4. Owner decisions

| # | Decision | Cost | Why it matters |
|---|---|---|---|
| 1 | **Clear the GCP billing hold** on billing account `01B467-A61905-9A97D2` (project number 93741856042). The account is open and billing is enabled, but Vertex reports dunning, which usually means an unpaid balance or a lapsed payment method behind the credits. | None beyond settling the balance | Restores Gemini text, the reference images, the quality gate and the vision checks, and unblocks selfie option A. |
| 2 | **Approve the TRELLIS.2 worker deploy** to us-east4 or europe-west4. Commands: `workers/model-trellis2/README.md` steps 2 and 3, with `_REGION` set to the chosen region. | GCP credits, scale-to-zero (min 0, max 2 L4) | Turns on the default engine that has been configured but absent. |
| 3 | **Approve the worker redeploys** that carry today's fetch-retry and TripoSG fixes: `model-triposg` and `model-hunyuan3d-21-rtx` first. | GCP credits (build time only) | Removes the dropped-fetch and blank-image failures. |
| 4 | **Selfie path:** start the MetaPerson trial, and approve a paid plan only if it passes the likeness gate. | $0 trial, then $800 a month | The only option that improves likeness within days. |
| 5 | **Paid quality tier for photo to 3D:** Tripo H3.1 for the High tier. | About $0.30 to $0.40 per model | Top of both arenas, and the High tier is already $THREE-gated. |

## 5. Engineering follow-ups that need no owner decision

- Write forge reference images to GCS instead of the R2 dev endpoint.
- Swap TripoSG's RMBG-1.4 for BiRefNet (MIT), or remove TripoSG's photo rung.
- Unpin the warm `model-trellis` instance in us-east4. Nothing routes to it, so it is idle capacity. This is a config-only change.
- Root-cause the `zero-size array` and malformed-response errors in `model-trellis`, and the inference errors in `model-hunyuan3d-21-rtx`.
- Fix `/features/scan`, which says the first scan needs no account when sign-in is required.
- Wire `api/input-photo.js` and `api/input-multiview.js` to a caller, or delete them.
- `gemini-2.5-flash-image` is marked deprecated on the Gemini API (shutdown 2026-10-02). Vertex's own retirement date could not be checked while Vertex is denied. Move the image lanes to `gemini-3.1-flash-image` when access returns.
