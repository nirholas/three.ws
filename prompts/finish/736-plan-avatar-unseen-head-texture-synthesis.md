# Texture the unseen 60 percent of the head from identity-gated synthesised views

**How to run:** paste this entire file into a fresh Claude Code chat opened in the three.ws repository (`/home/user/three.ws`) and send it. Nothing else is needed: everything this order depends on is in this file, including a verbatim copy of the planning docs it came from. It is safe to run on its own, in any order, and at the same time as any other work order. Its path in the repo is `prompts/finish/736-plan-avatar-unseen-head-texture-synthesis.md`.

**Priority:** P2, new capability with clear value (score 50 of 100 inside the tier). **Area:** avatar. **Written:** 2026-11-03, from a review of the planning corpus that read the source docs listed at the bottom and checked them against the code. Status claims rot, which is why Step 0 re-measures before you build anything.

## Operating clause (binding)

- Read `CLAUDE.md` at the repo root before anything else. It overrides this file wherever they disagree.
- Finish 100% in this session. Do not end the turn with a question, an option list, a plan, or "let me know". Make reasonable judgment calls, act on them, and note each in one line in the final report.
- The only permitted stops are the CLAUDE.md stop-and-ask gates: signing or sending a transaction, spending or moving funds, paying an x402 endpoint, minting or launching a coin; `git push`, production deploys, publishing or posting externally; committing content that references a crypto project other than $THREE; destroying data that cannot be regenerated. Do every other part of the work around a gate, and batch every such ask into one message at the end.
- Enterprise grade, no shortcuts. No mocks, no fake data, no placeholders, no sample arrays, no fake loading or progress, no unfinished-work markers, no stub functions, no commented-out code. Real APIs, real endpoints, real data. Errors are handled at the boundaries (network, user input) with a real recovery path.
- Bug fixes are test-first: write the test that reproduces the bug, watch it fail for the reported reason, fix the code, watch it pass, and commit the test with the fix.
- UI work meets the bar a senior design review would pass: hover, focus and active states on every interactive element, designed empty, error and loading (skeleton) states, keyboard accessible, works at phone width, and verified in a real browser.
- Solana is the home chain and leads every design. Robinhood means Robinhood Crypto only. $THREE (`FeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump`) is the only promoted coin; tests and fixtures use it or a clearly synthetic placeholder, never a real third-party mint.
- Never write the em-dash or en-dash characters anywhere (code, docs, UI copy, commit messages). Use a period, comma, colon, parentheses, or a plain hyphen.
- Before writing any non-trivial feature or UI, load `.claude/skills/engineering-standards/SKILL.md`. Before claiming done, load `.claude/skills/changelog-and-docs/SKILL.md`.

## Running alongside other sessions

Many sessions may be working in this same worktree at once. Stage explicit paths only (never `git add -A` or `git add .`), re-check `git status` and `git diff --staged` immediately before each commit, re-read a file right before editing it, and commit your own finished work promptly. Never stash, reset, revert or reformat files you did not change. Start dev servers on a free port (`npx vite --port <free port> --strictPort`), not the default 3000, so you do not collide with another session.

## Why this matters

A selfie covers one side of a face under one lighting condition. Projective texturing (shipped) lifted photographic coverage of the head from 10.5 to 41.1 percent, but about 59 percent of head texels (scalp, back of the ears, under the jaw, far cheek, neck) are still the tinted template texture, which is what reads as "avatar" instead of "person" the moment the head turns. The program's measured conclusions constrain the design: do not inpaint the UV atlas directly (UV-incoherent seams), and synthesised views are unusable for geometry but fine for texture (same-pose control divergence 0.0069; complexion, beard, hairline and ear survive a 30 degree turn). So the correct route is to synthesise extra camera views, gate them on identity, and project them through the existing camera-and-mesh projection path.

## Current state (measured by the reviewer on 2026-11-03; re-verify)

- `workers/avatar-reconstruction/face_projection.py` projects one photo through a weak-perspective Umeyama camera with four gates (inside photo, facing camera, depth-buffer occlusion, foreground pixel) and cos^1.5 facing falloff (floor 0.06), blending under the face-oval composite capped at `MAX_BLEND`.
- No synthesised-view code exists in the worker (`grep -rniE "imagen|gemini|vertex" workers/avatar-reconstruction/*.py` only finds eval helpers `eval/make_refs.py`, `eval/make_adversarial.py`). The worker is CPU-only Cloud Run with `google-cloud-storage` and `google-cloud-firestore` but no Vertex client.
- Reusable Vertex image calls exist elsewhere: `api/_mcp3d/vertex-imagen.js`, `api/_lib/ai-image-lanes.js`, `api/_lib/forge-reference-image.js`, `workers/garment-forge/pipeline.py`. `gemini-2.5-flash-image` was the model used for the identity-divergence measurement.
- `eval/measure_projection_coverage.py` reports oval versus projected coverage per face; `eval/identity_eval.py` (ISE) is texture-blind by design, so this track needs its own metrics.
- GCP spend on Vertex AI is pre-approved (CLAUDE.md standing approvals); no new paid third-party API may be introduced.

## Step 0: re-derive the current state

Run these first. Skip any task whose outcome already exists, and say so in the report.

```bash
cd /home/user/three.ws
grep -niE "imagen|gemini|vertex|synthes" workers/avatar-reconstruction/*.py workers/avatar-reconstruction/requirements.txt
python -m eval.measure_projection_coverage --help 2>&1 | head   # run from workers/avatar-reconstruction
sed -n 1,60p api/_mcp3d/vertex-imagen.js
sed -n 150,230p docs/avatar-reconstruction.md
```

Before changing anything, also record the baseline so you can prove you broke nothing:

    git status --short | head -20
    git log --oneline -5
    npx vitest run 2>&1 | tail -8    # note the failing-file count; it is your baseline, not your job unless this order says so

## Tasks

1. Add `workers/avatar-reconstruction/view_synthesis.py`: given the selfie, request N extra views from Vertex AI (gemini-2.5-flash-image or Imagen, whichever the measurement favours) at known yaw/pitch targets (for example +/-35, +/-65 degrees yaw and a high pitch for the scalp). Use Application Default Credentials via the worker's service account, region us-central1, with the worker's existing SSRF-safe fetch conventions (`worker_security.py`) and bounded timeouts.
2. Identity gate before compositing: reject any synthesised view whose same-pose appearance divergence or detected-landmark ratios fall outside a threshold calibrated on the 40-face reference set (control divergence 0.0069 is the same-pose floor). A rejected view is dropped silently; the job still succeeds with whatever views passed, down to zero (the shipped single-photo behaviour).
3. Solve each accepted view's camera with the same weak-perspective Umeyama fit and feed it through `face_projection` (add a multi-photo entry point that keeps the original photo authoritative where it already applies, lower `MAX_BLEND` for synthesised views, and uses the existing four gates). Never run a view through the landmark TPS warp for the scalp: there are no scalp landmarks.
4. Seam and colour coherence: match each synthesised view's skin statistics to the original photo in the overlap before blending, and add a seam-continuity check across UV island boundaries. A view that breaks continuity beyond threshold is dropped.
5. Metrics (ISE cannot move): extend `eval/` with `eval/texture_eval.py` computing masked SSIM and LPIPS against held-out views (render the 40 synthetic reference faces at the held-out yaws, since references are synthesised and rebuildable by any agent) plus the seam-continuity score, and extend `measure_projection_coverage.py` to report photographic-plus-synthesised coverage. LPIPS must use a commercially clean weight set; if none is acceptable, use masked SSIM plus a colour-histogram distance and say so.
6. Tests: `test_view_synthesis.py` with the Vertex call injected at the HTTP boundary using recorded real response bytes (no fabricated images; capture one real response during development and store it under the test fixtures), covering gate accept/reject, zero-views fallback, timeout fallback, and that identity geometry output is byte-identical with the feature on or off (texture only). Extend `test_face_projection.py` for the multi-camera path.
7. Operational: feature flag `RECON_VIEW_SYNTHESIS` (default off until the report passes), per-job cost and latency logged, a hard wall-clock cap, and quota/429 backoff that degrades to the shipped path. Add the Vertex user role to the worker's runtime service account (`three-ws@`) with a config-only change documented in the README.
8. Docs and changelog: update Track 2 status and measured before/after numbers in `docs/avatar-fidelity-program.md`, the Phase 3 section and roadmap row in `docs/avatar-reconstruction.md`, the worker README, and add a `data/changelog.json` entry. Enable by default only if the held-out SSIM/LPIPS improve and seams pass on all 40 references.

## Definition of done

Every line must be verified with the actual command output or browser observation in front of you. Never claim a line you did not verify.

- [ ] `cd workers/avatar-reconstruction && python -m pytest -q` passes including the new tests.
- [ ] `python -m eval.texture_eval` report exists for flag off and flag on; the held-out masked SSIM/LPIPS and seam scores are recorded in `docs/avatar-fidelity-program.md` with the reference set named.
- [ ] `python -m eval.measure_projection_coverage` shows coverage above the shipped 41.1 percent on the 40 references with the flag on.
- [ ] `python -m eval.run_eval --compare <off.json> <on.json>` shows mean ISE unchanged (geometry untouched).
- [ ] A reconstruction of one reference face rendered at 0, 45 and 90 degrees yaw is viewed in `/viewer` and the scalp, ear and under-jaw are visibly personalised, with no console errors.
- [ ] Every test you wrote or touched passes (`npx vitest run <those files>`; Playwright specs with `npx playwright test <spec>`). Bug fixes landed test-first: the new test failed before the fix for the reason the bug describes, and passes after.
- [ ] `npx vitest run` shows no new failing files compared with the Step 0 baseline.
- [ ] Any UI you changed was exercised in a real browser on a dev server (`npx vite --port <free port> --strictPort`): no console errors or warnings from your code, real network calls returning real data, and hover, focus, active, empty, error and loading (skeleton) states all designed and observed.
- [ ] `npm run check:rules -- --paths <every file you touched>` exits 0.
- [ ] Documentation is true: the feature doc or README describes what now exists, `STRUCTURE.md` has a row for any new surface or directory, a new page is in `data/pages.json`, and any user-visible change has a `data/changelog.json` entry followed by `npm run build:pages`. `npm run audit:docs` reports nothing new.
- [ ] You reviewed `git diff --staged` line by line before committing, and every changed line is justified.

## Never blocked

| Blocker | Resolution (act, do not ask) |
|---|---|
| Vertex model quota or 429 | Back off, fall back to the shipped single-photo path, and run measurement sweeps as Vertex AI custom jobs per docs/ops/gcp-credits-plan.md. |
| Model refuses or distorts identity | That is what the identity gate is for: drop the view; if every view fails across the reference set, ship the flag off and record the negative result. |
| No real held-out photographs | The reference set is synthesised on purpose (no real biometrics). Render held-out views from it; do not collect real people's photos. |
| Missing credential or env var | Read it from the live Cloud Run service: `node scripts/read-service-env.mjs` (or `gcloud run services describe three-ws-api --region us-central1`). Never trust `vercel env pull`; it returns empty secrets. To set one key, use `gcloud run services update --update-env-vars`, never `--set-env-vars` (that replaces the whole set). Load `.claude/skills/self-unblock-playbook/SKILL.md` for the full table. |
| Database schema needed | Write the migration beside the existing ones, read `npm run db:status` first, and remember `npm run db:migrate` applies immediately with no dry run. |
| GCP resource, GPU, or quota | GCP spend for quality and reliability is pre-approved (project `aerial-vehicle-466722-p5`). Create what you need; never downgrade quality to save credits. Do not onboard a new paid third-party API without the owner. |
| Tests failing that you did not touch | Compare with your Step 0 baseline. Pre-existing failures are not yours to fix unless this order says so; report them in one line. Never delete or skip a test to get green. |
| A file changed under you | Another session edited it. Re-read it, keep their change, and apply yours on top. Never `git stash`, `git reset`, `git checkout -- <path>`, or revert work you did not write. |
| Upstream API down or rate-limited | Find the root cause, add a real fallback or retry with backoff, and keep going. Never ship fake data in its place. |

## Close out (required)

1. Verify every Definition of done line with real output in front of you.
2. Commit with explicit paths and a message that describes the diff: `type(scope): what changed and why a reader would care`. Split unrelated changes into separate commits. If the diff references a crypto project other than $THREE, stop and ask the owner before that commit (CLAUDE.md commit gate).
3. If every Definition of done line passes, delete this work order in your final commit (`git rm prompts/finish/736-plan-avatar-unseen-head-texture-synthesis.md`) and append one dated line to `prompts/finish/_context/plan-PROGRESS.md` (create it if missing): the date, `736-plan-avatar-unseen-head-texture-synthesis.md`, the commit SHAs, and one sentence on what shipped.
4. If the last step belongs to the owner or an outside party, finish everything else, keep this file, add a dated "Status" paragraph directly under its title saying exactly what remains and who owns it, and append the same to `prompts/finish/_context/plan-PROGRESS.md`.
5. Never push or deploy unless the owner's message that started this session explicitly told you to. Leave the ship as one command (`git push threews main`, then `npm run deploy:gcp:full` per `.claude/skills/deploy-runbook/SKILL.md`) and name it in the report.

## Final report

Reply with, in this order and nothing else: what Step 0 measured; what you changed (files and commit SHAs); evidence for each Definition of done line; the one batched owner message, if any gate was hit; one line per judgment call. No trailing questions.

## Source material (verbatim)

The planning docs this order was derived from, copied on 2026-11-03 so this order stands alone even if they move or are deleted. Typography was normalized to the house style (dashes become hyphens, uppercase unfinished-work markers are lowercased, and a code comment that reads like a statement gets a trailing period so the repo lint does not mistake it for commented-out code); nothing else was changed. Where a source still exists, the live file may be newer: re-read it, and trust the code over both.

### `docs/avatar-fidelity-program.md` (whole file)

~~~~markdown
# Avatar fidelity program - owning selfie → avatar end to end

**Goal:** a selfie-to-avatar engine that beats the leading commercial
selfie-avatar products on identity fidelity, runs entirely on infrastructure we
own, and costs nothing per avatar. Not "good enough to avoid a bill" - better
than the thing we would have paid for.

This is the program plan. The subsystem it improves is documented in
[avatar-reconstruction.md](avatar-reconstruction.md); the worker lives in
[`workers/avatar-reconstruction/`](../workers/avatar-reconstruction).

## Why we are not buying this

Commercial vendors sell exactly this capability, metered per avatar. Two
reasons we build instead:

1. **It is the product.** three.ws is an avatar platform. Renting the step that
   turns a person into an avatar means the core of the product is someone
   else's, priced by them, rate-limited by them, and deprecable by them.
2. **The architecture is already ours.** The worker fits a person onto a
   pre-rigged fixed-topology template - the same approach the major commercial
   avatar platforms use. The output is born rigged with 52 ARKit blendshapes
   and 15 visemes. What is missing is fidelity, and fidelity is a compute-and-research
   problem, which is precisely what ~$100k of Google Cloud credits buys.

Every stage is commercial-clean (Apache-2.0 / MIT / BSD / CC0). Holding that
line is a hard constraint, not a preference: the highest-quality published face
models are almost all built on a non-commercial 3DMM (FLAME, BFM, SMPL) or
carry non-commercial weights. See the licence section in
[avatar-reconstruction.md](avatar-reconstruction.md#licensing--why-this-stack)
for the verdicts, including why FaceLift was evaluated and rejected.

## The spine: measure before optimising

Every track below is judged by one number, **Identity Shape Error (ISE)** - texture-blind, pose- and scale-invariant, dimensionless. Full definition and
usage: [`workers/avatar-reconstruction/eval/README.md`](../workers/avatar-reconstruction/eval/README.md).

Without it, "better than the commercial benchmark" is an opinion and a research
track can burn GPU-months moving a number nobody measured. With it, every
change is a diff:

```bash
python -m eval.run_eval --compare eval/reports/v1.json eval/reports/v2.json
```

Rule for this program: **no fidelity claim without a report, and no report
without naming the reference set it scored.**

## What actually binds

Not money. Two things:

- **L4 GPU quota = 3 for us-central1**, shared by six warm GPU services. The
  fleet is permanently at its ceiling. See
  [ops/gcp-credits-plan.md](ops/gcp-credits-plan.md). An RTX PRO 6000 (Blackwell,
  96 GB) is already granted and validated live at 1 instance, but needs a CUDA
  12.8 / torch cu128 rebuild - L4 images do not run on it.
- **Training-data licensing.** The reason to prefer per-subject optimisation
  over training an identity regressor: a regressor needs a face dataset, and the
  commercially-usable ones are thin. Optimisation needs only the user's own
  photo. This is the central design decision of the program.

## Tracks

Tracks 1-3 are independent and can run in parallel. Track 0 gates the claims of
all of them.

### Track 0 - Measurement `[done]`

The ISE metric, batch runner, revision comparator, parameter tuner and property
tests, plus a 40-face reference set generated by
[`eval/make_refs.py`](../workers/avatar-reconstruction/eval/make_refs.py) over a
deterministic grid of the platform's diversity matrix and mirrored to
`gs://three-ws-avatar-reconstructions/eval-refs/`.

Faces are synthesised rather than collected: no real person's biometrics in a
benchmark that gets copied between machines, no licensing terms, and any agent
can rebuild the identical set.

Because every reference face is a clean frontal portrait, ISE alone cannot see
what the outlier machinery is for, so the set is paired with
[`eval/robustness.py`](../workers/avatar-reconstruction/eval/robustness.py):
each face is degraded on the fly (blur, 12° turn, occlusion, dim, 1/6 resolution)
and scored on whether the same person still yields the same head. Fidelity and
stability pull opposite ways, and shipped parameters sit at the knee (Track 1).

The confidently-wrong detection is covered too, by a 16-sample adversarial set
([`eval/make_adversarial.py`](../workers/avatar-reconstruction/eval/make_adversarial.py))
spanning non-faces (pet, statue, doll, mask, mannequin), depicted faces (poster,
phone screen, painting, magazine), crowds, and out-of-envelope shots
(near-profile, hard backlight, motion blur, macro), audited by
[`eval/detection_guard.py`](../workers/avatar-reconstruction/eval/detection_guard.py).
That audit produced three findings, one of which killed the guard I was about to
build:

**A face-plausibility gate cannot work - do not rebuild one.** The natural design
is to align landmarks to the canonical face and reject a large residual. MediaPipe
FaceMesh is a *fitted model*: it does not decide whether something is a face, it
reports where a face would be. A golden retriever scored 0.4758, a *better*
canonical fit than all 40 real humans (0.5035-0.5238). Any threshold separating
them rejects real people first.

**The catastrophic failure mode does not exist in this architecture.** Head
displacement from the template: real faces 0.2713-0.2839, every detected
adversarial input 0.2586-0.2929, and **zero** ungated adversarial inputs distort
more than a real face. A dog photo yields a slightly unusual *human* head, not a
monstrous one. Four mechanisms compose to guarantee it: canonical alignment
removes pose and scale, `strength` damps the residual, the per-point clamp bounds
outliers, and the TPS off-face mask confines deformation to the face. Guarding the
mesh against wrong detections is therefore unnecessary - which is worth knowing
before someone spends a sprint on it.

**Yaw was the one thing worth gating.** Real frontals peak at 2.7°; the
near-profile shot reads 58.6° and was the sole input pushing the head outside the
real-face band. Past roughly a third of a turn the far side of the face is
self-occluded, so its depth is extrapolation and the morph fits guesswork as bone
structure. `face_pipeline.MAX_MORPH_YAW_DEG` (35°) now skips the morph and keeps
texture transfer above that, clearing every genuine frontal by ~13x. Photos of
photos sit at 9-18°, already produce in-band heads, and are deliberately not
blocked.

### Track 1 - Ship the morph that is already written `[done]`

`face_geometry.py` (Phase 2 head-shape morph) had been written, tested and never
deployed: production `/health` reported `face_texture_transfer_v1` and omitted
`geometry_morph` entirely, so the running image predated the work. Production was
texture-only - a person's face painted on a generic skull. It now reports
`face_texture_transfer_v2` with `geometry_morph: true`.

Deploying it surfaced two things worth more than the deploy:

**A latent correctness bug.** `landmarks_to_array` passed MediaPipe's raw
normalised landmarks straight into the morph. MediaPipe divides x by image width
and y by image *height*, so on any non-square photo the point cloud is
anisotropically stretched; Umeyama fits one uniform scale and cannot undo that,
so the stretch survived alignment and was consumed as facial identity. The
camera's aspect ratio was being baked into the avatar's skull - the same person
at 3:4 and 1:1 got head shapes differing by 3.07% of head size, and 3:4 is
exactly what the selfie page recommends. Fixed by scaling to an isotropic pixel
frame; drift is now 0. Pinned by a test that fails on the old path.

**Defaults that had never been measured.** A sweep over the 40-face set
([`eval/tune_morph.py`](../workers/avatar-reconstruction/eval/tune_morph.py))
moved `strength` / `max_displacement_frac` off 0.75 / 0.18, whose clamp permitted
only ~1.9 cm of travel per control point and was throttling genuine facial
variation rather than rejecting outliers. Every setting in the usable range beat
it, and **no face was made worse** by the change.

Setting the clamp on fidelity alone is not possible: a benchmark of clean
portraits contains nothing for a clamp to reject, so it will always recommend no
clamping at all. That produced the program's second measurement tool,
[`eval/robustness.py`](../workers/avatar-reconstruction/eval/robustness.py),
which asks the complementary question - **does a degraded photo of the same
person still give the same head?** Each face is blurred, turned 12°, occluded,
dimmed and downsampled to 1/6 resolution, and the score is the divergence from
the clean-photo head. The person did not change, so all of it is the pipeline
reacting to photo quality rather than identity.

| clamp | ISE | vs floor | instability |
|---|---|---|---|
| 0.18 (was shipped) | 0.2932 | 26.5% | 0.0027 |
| 0.45 | 0.1684 | 57.8% | 0.0053 |
| **0.55 (shipped)** | **0.1591** | **60.1%** | **0.0057** |
| 0.65 (sweep optimum) | 0.1587 | 60.2% | 0.0060 |
| 1.00 | 0.1587 | 60.2% | 0.0060 |

Fidelity flatlines past 0.65 while instability keeps climbing, so anything looser
is pure downside; across the usable range each step buys ~40-50x more fidelity
than it costs in stability. 0.55 is the knee. A first pass shipped 0.45 on
physical reasoning before the robustness data existed, which turned out to be
2.3 points of fidelity too conservative - a fair illustration of why the second
metric was worth building.

**Still unmeasured:** all 75 degraded images yielded a face detection, so the
catastrophic regime the clamp ultimately guards is untested. A detection
*failure* is safe (the job degrades to texture-only); a confident *wrong*
detection is not, and nothing bounds that yet. That is the remaining Track 0
work.

Cost: negligible. As predicted, the largest fidelity gain per unit of effort in
the program, because the work was already paid for.

### Track 2 - Full-head photoreal texture (Vertex AI Imagen)

A selfie shows one side of a face under one lighting condition. Cheeks in
shadow, ears, the scalp, under the jaw - none of it is in the photo, and today
those regions fall back to a tinted template texture. That mismatch is what
reads as "avatar" rather than "person" the moment the head turns.

**Measure the opportunity first, it is bigger than it looks.** Of the head
mesh's texels, only **10.4% is the face oval** the selfie actually covers (9.4%
of its actual surface area). The other **~90%**, ears, scalp, neck, under-jaw,
is template texture the camera never saw, personalised solely by a global
skin-tone tint. That is the real prize here, and it also bounds what the
mechanisms below can achieve.

> An earlier revision of this doc quoted 19.2% / 80.8%. That was measured
> against the wrong denominator (it counted atlas texels the head mesh does not
> use). Re-measured against head-only texels on the shipped template it is
> 10.4%, so the gap was *larger* than first reported, not smaller. The number is
> now produced by `eval/measure_projection_coverage.py` rather than by hand.

**A landmark-driven warp cannot reach most of it.** MediaPipe's 468 landmarks are
face-only: there are no ear, scalp or neck points, and `_warp_face_to_uv` masks
to the face-oval polygon accordingly. So warping extra synthesised views through
the existing path improves *lateral cheek and jaw* fidelity (where a frontal is
foreshortened) but cannot texture the other ~90%, because no correspondence
exists there. Anyone picking this up should not expect the view-warp route to
fill the scalp.

**The mechanism that does reach it is projective texturing off the mesh we
already have. SHIPPED.** [`face_projection.py`](../workers/avatar-reconstruction/face_projection.py)
solves the camera by PnP against the head's landmark vertices, rasterises the
head in UV space so every texel knows its 3D position and normal, then projects
each texel into the photo and samples it. No landmarks are needed for the
surface itself, so ears, jawline and neck fall out naturally.

Four gates keep it honest, because projection will otherwise paint the back of a
head with whatever pixel lies behind it: the texel must land inside the photo,
face the camera, survive a depth-buffer occlusion test, and sample a foreground
pixel. Anything failing a gate keeps its existing colour. The result blends
*under* the face-oval composite, which stays authoritative where the landmark
warp already applies, and is capped at `MAX_BLEND` so a slightly-wrong pose
degrades to a tint rather than to a visibly wrong image.

**Measured on the shipped Wolf3D head with real faces**
(`eval/measure_projection_coverage.py`), across all 40 reference faces
photographic coverage of the head goes from **10.5% to 41.1%, a 3.9x increase**,
and every one of the 40 fits a camera:

| | Share of the head's texels |
|---|---|
| Face-oval warp (what existed before) | 10.5% |
| New surface from projection | 30.6% (range 23.3-31.6%) |
| **Total photographic** | **41.1%** (range 33.9-42.1%) |

The harness reports the oval and the projection separately on purpose, and that
is what caught the sign bug below: while the signs were inverted, "new" came out
exactly equal to "projected", meaning the projected region and the face oval did
not overlap at all. That is impossible for a real camera, since the face is the
most camera-facing surface on the head. A single headline coverage number would
have looked healthy (it read 47%, higher than the correct 41%) and hidden it.

Two decisions are worth recording because both nearly went the wrong way.

**The signs.** Depth and view direction were both inverted, so the pipeline
believed the front of the head pointed away from the lens. Every gate then
rejected the face and painted the back of the head instead. All ten unit tests
passed throughout, because each one *selects its test region by facing* and so
adapts to whichever sign is in force. Only an absolute claim catches this, and
there is now a test asserting that the surface the landmarks sit on faces the
camera (it fails at -0.89 with the old signs). Umeyama's reflection guard forces
a proper rotation and can absorb a sign flip in the correspondence, so the fitted
frame's handedness cannot be reasoned about from MediaPipe's documented z
convention; it has to be measured.

**The camera model.** The obvious approach, `cv2.solvePnP` against the head's
landmark vertices, does not work here and the synthetic tests did not catch it:
they generated 2D points by projecting the same 3D points, so the
correspondences were perfect by construction. On real photos they are not.
`landmark_vtx` is many-to-one, collapsing 468 landmarks onto 262 head vertices,
so hundreds of landmarks share a 3D point while sitting at different 2D
positions. RANSAC found 25-35% inliers and put the head *behind the camera* on
half the reference faces. The replacement fits a weak-perspective camera by
closed-form Umeyama against MediaPipe's 3D landmarks, after averaging duplicate
correspondences: 10 of 10 reference faces now fit, mean coverage 36.9% with a
range of only 36.2-37.5%. The lesson is that a synthetic test built from the
same generative model it validates proves the arithmetic and nothing about the
data.

**The facing falloff.** cos^3 with a 0.15 floor stops painting at 58 degrees from
the camera, which **rejects the ears outright**. Ears sit at 70-90 degrees from a
frontal camera and are a large share of the surface this exists to reach, so
that setting would have left the headline gap unclosed while appearing to
address it. The shipped curve is cos^1.5 with a 0.06 floor, which admits them as
a light wash. Coverage of no-landmark surface measured 0% before the change and
91% after.

The camera-pose machinery is shared with Track 3.

Already fixed on the way in: the skin tint was being applied to the *whole*
texture, including the face oval that had just been composited from the user's
photograph - shifting the only region with true photographic colour toward an
average of itself by ~1.4% of range. It is now masked to the regions the photo
could not cover, which is what its own comment always said it was for
(`test_face_pipeline.py` pins the mask behaviour, including that the tint still
reaches every unprotected pixel - a mask that over-protected would leave a
template-coloured neck against a photographic face, a worse artefact than the
one being fixed).

Two candidate mechanisms for the remainder, and the measurement in Track 3
decides between them.

**Do not inpaint the UV atlas directly.** A UV layout is not a photograph; a
generative image model conditioned on one will produce photographically plausible
but UV-incoherent content, and the seams land exactly where the head turns.

**Do synthesise additional camera views and warp them through the existing path.**
Each view goes through the same landmark-driven TPS warp as the frontal
(`_warp_face_to_uv`), so coverage of cheeks, ears and jawline is UV-coherent by
construction rather than by hoping the model understood the atlas.

Crucially, the finding that kills multi-view for *geometry* (Track 3) does not
kill it for *texture*. Rotated synthesised views measure as a different person
geometrically, but the same-pose control shows appearance is reproduced faithfully
(0.0069 divergence), and texture needs plausible skin, not millimetre-accurate
landmarks. A 3/4 view that is 0.03 off in face shape still carries the correct
complexion, beard, hairline and ear into the regions a frontal cannot see. The
severity of the error differs by an order of magnitude between the two uses.

ISE will not move - it is a geometry metric, texture-blind by design. This track
must bring its own: masked SSIM / LPIPS against held-out views, plus a
seam-continuity check across the UV boundary. Gate the synthesised view on the
same-pose identity check before compositing, so a bad generation is rejected
rather than painted on.

### Track 3 - Dense identity geometry by per-subject optimisation

The Phase-2 morph is driven by 468 sparse landmarks diffused across 2162 head
vertices. It captures gross proportion - face width, jaw, nose projection, brow - and cannot capture fine structure, because the signal is not there.

The unencumbered path to dense identity is **analysis-by-synthesis**: render the
current head, compare to the photo, backpropagate to vertex positions, repeat.

- **Differentiable rasteriser: PyTorch3D (BSD-3-Clause).** Commercially clean.
  Deliberately *not* nvdiffrast, whose NVIDIA Source Code License is
  non-commercial.
- **Regularisation** with a Laplacian smoothness term and a displacement bound,
  so the head stays on a plausible face manifold and every ARKit blendshape
  survives. Vertex count and order never change, so `glb_ops.set_head_geometry`
  writes the result back without touching skinning or morph targets - the
  property `test_face_geometry.py` already pins.
- **Multi-view from one photo - MEASURED AND REJECTED for geometry.** The plan
  was to synthesise 3/4 and profile views with a Vertex image model and fit
  against all of them at once. It does not survive contact with the identity
  metric. Asking `gemini-2.5-flash-image` for the same person turned 30°:

  | comparison | identity-shape divergence |
  |---|---|
  | same-pose regeneration (control) | **0.0069** |
  | synthesised 3/4 view (19.7° yaw) | 0.0396 |
  | a *different real person* | 0.0358 (range 0.0268-0.0489) |

  The control matters: at unchanged pose the model reproduces the person ~5x more
  faithfully than a stranger, so identity preservation is genuinely good. But once
  the head is rotated, the recoverable face geometry is **statistically
  indistinguishable from a different person**. Whether the cause is the model
  drifting under pose change or MediaPipe's depth being pose-dependent (likely
  both), the signal is too degraded to fit a skull to. Feeding it to a
  differentiable fit would optimise confidently toward someone who does not exist.

  Do not revive this leg on synthesised views. It needs genuine multi-pose capture
  - several real frames of the actual user, which the `/scan` flow already
  collects - and the metric above is the acceptance test any such source must pass
  before it drives geometry.

No third-party weights, no face dataset, no licence question: it optimises
against the user's own photo. It is GPU-hungry per avatar, which is exactly the
resource we have.

Alternative shortcut, **requires owner approval because it is external spend**:
a commercial FLAME licence from MPI unlocks MICA for dense identity in one
forward pass. Cheaper in engineering time, adds a licensing dependency, and
`register_head_to_target` is already model-agnostic so it drops straight in if
the owner wants it. Recommendation: build the optimisation path first, since it
is unencumbered and permanent.

### Track 4 - Capacity

Fidelity work is throughput-bound before it is idea-bound: Track 3 is minutes of
GPU per avatar against a fleet already at its ceiling.

- Chase the L4 quota preference (`l4-no-zonal-us-central1-8`, preferred 16). On
  a grant ≥ 8, the fleet-wide scale-up commands are pre-approved and listed in
  [ops/gcp-credits-plan.md](ops/gcp-credits-plan.md).
- Port the reconstruction worker to the granted RTX PRO 6000 (CUDA 12.8 / torch
  cu128; platform minimum 20 CPU / 80 Gi). `workers/model-hunyuan3d/Dockerfile.hunyuan21rtx`
  is the first mover to copy. 96 GB of VRAM makes the Track 3 optimisation loop
  practical at interactive latency.
- Vertex AI custom jobs for any batch experiment, so research load never competes
  with the serving fleet for the same three L4s.

### Track 5 - Fully-owned body (v3)

The reconstruction template is a third-party Wolf3D base - the last such asset in
the pipeline. **The replacement already exists in this repo** and the roadmap
entry above is out of date: [`public/avatars/parametric-base.glb`](../public/avatars)
is a CC0 MakeHuman/MPFB2 body (vendored via [naver/anny](https://github.com/naver/anny)
in [`avatar-sources/anny/`](../avatar-sources/anny)) carrying **122 baked morph
sliders** - nose, ears, mouth, eyes, jaw, cheeks, head shape, neck, plus gender,
muscle, weight, age, height, torso, hips, limbs - on a 52-bone `mixamorig:*`
skeleton, built by [`scripts/build-parametric-base.mjs`](../scripts/build-parametric-base.mjs)
and already live in Avatar Studio's base switcher.

That turns this track from "build a body" into "retarget reconstruction onto the
body we ship", and it changes the shape of the whole program: the 122 sliders are
a **parametric identity basis**. Fitting a person becomes solving for slider
values, which is a far better-conditioned problem than free-form vertex
optimisation - bounded, always on the face manifold, and interpretable. Track 3's
differentiable fit should target this basis first and fall back to free-form
vertex displacement only for residual detail.

Work: rebuild `face_uv_map.json` against the parametric base (`precompute_uv.py`
is already parameterised by template), transfer the ARKit-52 expression set with
ICT-FaceKit (MIT) since the Anny base does not ship visemes, and re-baseline
every ISE report - scores are only comparable within one template.

**This track also owns the `body_type` dead path.** `POST /reconstruct` accepts
`male | female | neutral` and the selfie page offers the choice, but
[`face_pipeline._load_template`](../workers/avatar-reconstruction/face_pipeline.py)
looks for `templates/male.glb` and `female.glb`, neither of which exists, so every
request silently falls back to `default.glb`. The parameter has never done
anything.

Staging the existing stock bases as those two files is the obvious patch and is the
wrong move. `public/avatars/realistic-male.glb` is topology-compatible (same 2162-
vertex `Wolf3D_Head`) but carries only 60 morph targets against `default.glb`'s
67, so it would silently drop seven expressions. `realistic-female.glb` is a
different head entirely (1531 vertices, mesh names stripped), so it needs its own
precomputed map and a `_find_head_prim` that does not key on a mesh name - and it
would still leave two more templates to maintain in lockstep.

The parametric base dissolves the problem: body type stops being a discrete
template swap and becomes slider values (gender, muscle, weight, height, hips) on
one mesh with one skeleton, one UV map and one blendshape set. Fix it here, not
by adding template files.

## Where the credits go

| Line | Rough monthly | Notes |
|---|---|---|
| Warm GPU serving (current 6-service fleet) | $4-6k | Already running |
| RTX PRO 6000 warm instance | ~$2-3k | Track 3 serving + Track 4 headroom |
| Vertex AI custom training/experiment jobs | $2-5k while active | Track 3 sweeps, Track 2 evaluation |
| Vertex Imagen inference | usage-based, small | Track 2 |

Steady state stays in the range [ops/gcp-credits-plan.md](ops/gcp-credits-plan.md)
already sets out: comfortably over a year of runway on the grant. The standing
directive is to spend on quality and never downgrade to conserve credits.

## Owner decisions

Everything above proceeds without asking, per the standing GCP approvals. Two
items do not:

1. **Commercial FLAME/MICA licence from MPI** - external paid dependency
   (Track 3 alternative). Not needed if the optimisation path lands.
2. **Production deploys of the main API/frontend.** GPU worker deploys and
   config-only `gcloud run services update` changes are pre-approved.
~~~~

### `docs/avatar-reconstruction.md` (whole file)

~~~~markdown
# Selfie → Avatar Reconstruction

This is the subsystem that turns a **user's photo** into a rigged,
animation-ready 3D avatar. A **text prompt** sent to the same endpoint does NOT
use this pipeline: fitting a face onto a template body ignores everything a
prompt says about outfit, build, and style, so prompts run the full-body lane
instead (a full-body reference image, reconstructed on the self-hosted Hunyuan3D
worker, then auto-rigged). The lane plan lives in
[`api/_lib/prompt-avatar.js`](../api/_lib/prompt-avatar.js); both inputs share
the job contract, the status poll, and the finalize tail described below. It is distinct from the Forge
generation lane in the [Avatar Pipeline](avatar-pipeline.md): the Forge generates
an *arbitrary* mesh from a prompt, whereas reconstruction fits a *specific
person* onto a fixed, pre-rigged template - the same architecture Avaturn and
Ready Player Me use, and the reason the output is born-rigged with facial
blendshapes instead of a bare mesh that still needs auto-rigging.

- **Worker:** [`workers/avatar-reconstruction/`](../workers/avatar-reconstruction): FastAPI on a CPU-only Cloud Run service (8 vCPU). It ran on an L4 until background removal was measured to gain nothing from CUDA; see the comment in its `cloudbuild.yaml`.
- **Backend provider:** [`api/_providers/gcp.js`](../api/_providers/gcp.js), selected by `AVATAR_REGEN_PROVIDER=gcp` (see [`api/_lib/regen-provider.js`](../api/_lib/regen-provider.js)).
- **User entry points:** the selfie/upload flow (and, via the full-body lane, the text→avatar prompt flow) in [`api/avatars/_actions.js`](../api/avatars/_actions.js) (`POST /api/avatars/reconstruct`).
- **Completion:** normally driven by the browser polling `/api/avatars/regenerate-status`, which runs the finalize stages inline. [`api/cron/reconstruct-sweep.js`](../api/cron/reconstruct-sweep.js) is the server-side backstop for when it isn't - see below.

## Who finishes the job

A reconstruct job is advanced by whoever polls it. The `/create/selfie` page
polls every few seconds, and each poll pulls provider status and runs the shared
finalize stages in [`reconstruct-finalize.js`](../api/_lib/reconstruct-finalize.js).

That made the browser tab load-bearing. Close it mid-build and the worker still
finished the GLB and stored it durably in GCS, but nothing ever collected it: the
job row stayed `queued`/`running` forever and the avatar never reached the user's
library. Production had 26 jobs stranded that way, the oldest from 2026-05-31,
invisible to `db-retention` (which only prunes terminal rows).

`reconstruct-sweep` closes that hole. Every 5 minutes it picks up reconstruct
jobs quiet for over 3 minutes and runs **the same finalize stages** the browser
poll would have, so an abandoned job still lands in the library. Design notes:

- **30-day rescue window**, far longer than the auto-rig sweep's 6 hours. The
  worker's GLBs (GCS) and job state (Firestore) are both durable, so a weeks-old
  abandoned job is still genuinely deliverable to a real user.
- Past that window, and for jobs whose provider is no longer pollable with
  platform credentials, rows are failed out with an honest reason - the open set
  must not grow without bound.
- **BYOK jobs (meshy/tripo) stay browser-driven.** They authenticate with the
  user's own key, which the status poll resolves from request context; a cron has
  no user context to decrypt it. They age out via the same window.
- **A full avatar library closes the job instead of retrying it.** Materialization
  refused by the plan quota is the owner's to fix, so the sweep fails the job with
  the same `PLAN_LIMIT_JOB_ERROR` copy (`error_kind = 'input'`) the status poll
  relays, rather than re-running the refused step every tick.
- A provider 404 (`gcp_task_missing`) is terminal here, so a job whose worker
  record is genuinely gone resolves instead of being retried forever.

## Object storage cannot take the avatar away

The last step of finalize copies the finished GLB from the worker's bucket into
ours. That single `putObject` used to sit between the user and the avatar they
had already waited ninety seconds for: when the R2 credential stopped verifying
at 03:15 UTC on 2026-09-11, materialize aborted, no avatar row was written, and
the page could only say "Avatar finished but could not be saved. Try again."
Retrying never worked, because the photo was never the problem.

The mesh was never lost. The reconstruction worker parks it in
`gs://three-ws-avatar-reconstructions`, which is public and lifecycle-free, and
that URL is already in the job row. So `storeGlbOrKeepProviderUrl` in
[`reconstruct-finalize.js`](../api/_lib/reconstruct-finalize.js) now lets a
*named* storage-infrastructure fault (`isStorageInfrastructureError`: credential
rejected or revoked, bucket missing, endpoint unreachable) cost the durable copy
in our bucket rather than the user's avatar. The provider's absolute https URL
becomes the storage key: `publicUrl()` passes an absolute key straight through,
`copyObject()` declines to copy one, `defaultStorageMode()` records
`r2.present = false` instead of claiming bytes that are not there, and
`source_meta` carries `servedFrom` plus the `pendingBucketKey` a later re-copy
needs. Any other error still throws, so only a fault we can name is allowed to
degrade.

## Plan quotas are checked twice, on purpose

A reconstruction only meets the caller's plan quota at the very end, inside
`createAvatar` → `enforceQuotas`. That is roughly ninety seconds of GPU time
after the button was pressed (plus a Flux reference image on the text→avatar
lane), and a refusal there used to leave the job at `done` with no
`resultAvatarId`: a state no recovery cron looks at (they filter on
`queued`/`running`), which re-ran the same doomed materialization on every poll
and reported the generic engine-fault copy to the browser. The user was told the
engine had a problem, and every retry burned the same spend to land in the same
place.

Two checks now bracket the job:

1. **Pre-flight, at submit.** `POST /api/avatars/reconstruct` calls
   `assertAvatarSlotAvailable(userId)` ([`api/_lib/avatars.js`](../api/_lib/avatars.js))
   before it resolves a provider or generates a reference image. A full library
   is refused in milliseconds with `402 plan_limit` and an actionable
   `error_description`. This is the check that fires in practice.
2. **At materialization, for the race.** If another avatar lands while the mesh
   is generating, the finalize stage still throws. `failJobOnPlanLimit` then
   ends the job as `failed` with `error_kind = 'input'`, so
   `/api/avatars/regenerate-status` relays the plan copy verbatim (see
   [REGENERATE.md](../api/avatars/REGENERATE.md)) instead of masking it as an
   engine fault.

Only the per-plan avatar count and the total-bytes ceiling can be pre-flighted:
per-file size is unknowable until the mesh exists, so `plan_limit_size` remains a
materialization-time refusal.

## How it works

The avatar is a fixed-topology Wolf3D/RPM template that ships **pre-rigged** with
a humanoid skeleton and **52 ARKit blendshapes + 15 visemes**. Reconstruction
never generates a new mesh; it fits the person onto that template in two phases.

### Phase 1 - Face texture transfer

`face_pipeline.py`: MediaPipe FaceLandmarker finds 468 landmarks on the best
frontal photo, a thin-plate-spline warp maps the face into the template's skin-UV
space, it is composited over the face-oval region, and skin / hair / eye colours
are sampled and tinted for consistency. Output: the template body wearing the
person's face *texture*.

### Phase 2 - Face geometry morph

Texture alone leaves the *shape* generic - same jaw, nose, brow and face width as
the template, so the avatar looks like a sticker on a mannequin. `face_geometry.py`
closes that gap:

1. Umeyama similarity-aligns the 468 detected landmarks onto MediaPipe's neutral
   **canonical face model**, so the person's face and the reference share a frame.
2. The residual `(person − canonical)` on a **stable identity subset** (face
   oval, nose, cheeks, brow, jaw - expression-prone eye/lip points excluded) is
   the person's shape deviation from neutral.
3. That displacement is carried onto the head's corresponding vertices (a
   nearest-vertex map precomputed by `precompute_uv.py`), scaled into head units,
   and clamped to reject landmark/pose outliers.
4. A **thin-plate spline** interpolates the sparse displacements across all 2162
   head vertices. TPS passes exactly through its control points, so localised
   identity (a wider jaw, a longer nose) survives instead of being averaged away
   - the failure mode of normalised-Gaussian/Shepard weighting. TPS extrapolates
   freely, so a Gaussian locality mask fades the field to zero off the face and
   the scalp, ears and neck stay put.

`strength` and `max_displacement_frac` default to **0.6 / 0.55**, chosen by two
sweeps over the 40-face reference set, not by eye: `python -m eval.tune_morph`
(mean ISE, is the shape right?) and `python -m eval.robustness` (does a degraded
photo of the same person still give the same head?). 0.55 sits at the knee of
that fidelity-vs-robustness curve, cutting mean ISE 46% against the original
0.75 / 0.18, whose ~1.9 cm displacement ceiling was throttling genuine facial
variation rather than rejecting outliers; past 0.65 fidelity flatlines while
instability keeps rising. See [avatar-fidelity-program.md](avatar-fidelity-program.md)
for why the sweep's own looser optimum was deliberately not shipped.

Because vertex count and order never change, `glb_ops.set_head_geometry` writes
the morphed positions (and recomputed normals) back **without disturbing the
skinning weights or any of the 67 blendshape morph targets** - the rig and every
ARKit expression survive intact. This is verified end-to-end in
[`test_face_geometry.py`](../workers/avatar-reconstruction/test_face_geometry.py).

Toggle Phase 2 with the `GEOMETRY_MORPH` env var (default `1`). It degrades
cleanly to texture-only if anything fails; the shape refinement never fails a job.

### Phase 3: projective texturing (the rest of the head)

Phases 1 and 2 both stop at the face. The face-oval polygon Phase 1 composites
into is only **10.4% of the head's texels** (9.4% of its surface area), because
MediaPipe's 468 landmarks are face-only: there are no ear, scalp or neck points,
so outside the oval there is no correspondence to warp with. Everything else was
template texture personalised by a single global skin tint.

[`face_projection.py`](../workers/avatar-reconstruction/face_projection.py) takes
the other route. Phase 2 leaves us the head's real 3D shape, which turns the
problem from *find matching points* into *find where each surface point lands in
the photo*:

1. **Fit the camera** with a closed-form Umeyama similarity between the head's
   landmark vertices and MediaPipe's *3D* landmarks. This is the only use of
   landmarks, and they locate the camera rather than establishing surface
   correspondence.

   This started as `cv2.solvePnP` and had to be replaced, which is worth
   recording. `landmark_vtx` is nearest-vertex and **many-to-one**: on the
   shipped template, 468 landmarks collapse onto just **262 distinct head
   vertices**, so hundreds of landmarks share one 3D point while sitting at
   different 2D positions. That is a contradiction no camera can satisfy.
   Measured on the reference faces, RANSAC found 25-35% inliers and returned a
   solution *behind the camera* on half of them, with the depth sign flipping
   between runs and coordinate conventions.

   Because MediaPipe reports 3D landmarks, the alignment is 3D-to-3D rather than
   2D-to-3D, and Umeyama solves it in closed form with a reflection guard: no
   RANSAC, no depth-sign ambiguity, nothing that can diverge. Duplicate
   correspondences are averaged first so a vertex is not weighted by how many
   landmarks happened to land on it. The result is a weak-perspective (scaled
   orthographic) camera, which is the right model for a selfie anyway: head
   depth is centimetres against a camera distance of tens, so foreshortening
   across the head is small. **10 of 10 reference faces now fit**, against 50%
   failure with PnP.
2. **Rasterize the head in UV space** so every texel carries its 3D position and
   normal.
3. **Project and sample.** Each texel's 3D position goes through the camera into
   the photo. Ears, jawline and neck fall out for free.

Four gates decide whether a texel may be painted at all, because projection will
otherwise paint the back of a head with whatever pixel lies behind it. The texel
must land inside the photo, face the camera (confidence falls off as
cos^1.5 of the view angle), survive a depth-buffer occlusion test that catches
the nose shadowing the cheek, and sample a foreground pixel per the rembg alpha.
A texel failing any gate keeps its existing colour rather than inventing one. The
result blends *under* the Phase 1 composite, which stays authoritative where the
landmark warp applies, and is capped at `MAX_BLEND = 0.85` so a slightly-wrong
pose degrades to a tint rather than a visibly wrong image.

Measured on the shipped template by
[`eval/measure_projection_coverage.py`](../workers/avatar-reconstruction/eval/measure_projection_coverage.py),
photographic coverage of the head rises from **10.5% to 41.1%, a 3.9x increase**
across the 40-face reference set: the face oval keeps its 10.5% and projection
adds 30.6% of ears, jawline, neck and forehead that no landmark describes. All
40 faces fit a camera; per-face coverage ranges 33.9% to 42.1%.

Toggle with `PROJECTIVE_TEXTURE` (default `1`). Like the morph, it degrades
cleanly: a pose that will not solve logs and leaves the warp-only skin in place.
It runs *after* the geometry morph, since projecting onto the template and then
morphing would slide the texture off the features it was sampled from.

> **Every buffer read is stride-aware.** The head's vertex attributes share one
> interleaved bufferView, so `precompute_uv.py` and `glb_ops` honour
> `bufferView.byteStride` on every accessor read and write. A stride-unaware read
> silently interleaves POSITION with NORMAL, which builds `face_uv_map.json` on
> corrupted vertex data and breaks the Phase-1 texture correspondence too.

## Licensing - why this stack

Every stage is commercial-clean (Apache-2.0 / MIT / CC0). The dominant constraint
in single-image avatar reconstruction is that the best-known 3D face and body
models are **non-commercial**: FLAME and the Basel Face Model (BFM) are academic
licences, and the whole SMPL/SMPL-X family is Max-Planck non-commercial. Anything
built on them (DECA, EMOCA, MICA, ICON, ECON, PIFuHD, …) inherits that restriction.
The Phase-2 morph uses only **MediaPipe Face Mesh** (Apache-2.0) - no 3DMM - so it
is unencumbered.

## Roadmap - beating Avaturn on fidelity

> The active plan built on this roadmap - tracks, owners, capacity and credit
> allocation - is [avatar-fidelity-program.md](avatar-fidelity-program.md).
> Fidelity claims are scored with the ISE metric in
> [`workers/avatar-reconstruction/eval/`](../workers/avatar-reconstruction/eval/README.md).

Phase 2 captures gross face identity (proportions, projection) but not fine
geometry. The path to and past Avaturn quality, with the verified licence for
each link:

| Version | Upgrade | Model | Licence verdict |
|---|---|---|---|
| **v1 (shipped)** | Real face-shape morph (sparse) | MediaPipe Face Mesh | Apache-2.0 - clean |
| **v2 (recommended)** | Dense identity geometry, fused via `register_head_to_target` | **MICA + FLAME**, commercial licence from MPI | Paid MPI commercial licence - clean once signed. FLAME's fixed topology + expression basis map straight to ARKit |
| **v2 (fallback)** | Dense identity, no licence fee | HRN re-based on **FLAME-2023-Open** (CC-BY-4.0) | Clean, but weeks of GPU R&D to retrain the identity regressor |
| **v2 (texture)** SHIPPED | Projective texturing off the morphed mesh: fills ears, jawline and neck from the *same* photo (10.5% to 41.1% of the head) | none, geometry we already have | Clean; no new model or licence |
| **v3 (texture)** | Inpaint what no camera saw (scalp, far cheek) | **Imagen** inpaint on Vertex AI | GCP, pre-approved |
| **v3** | Drop the RPM-template dependency for a fully-owned body | **Anny** (parametric body) + **ICT-FaceKit** (ARKit-52) + deformation transfer | Anny Apache-2.0 + CC0; ICT-FaceKit + DT MIT - clean |

**Rejected: FaceLift (ICCV'25)** - initially floated as the clean v2 model, but
verification killed it: its weights are licensed from Adobe under the
**non-commercial Adobe Research License** (Apache code does not extend to the
weights), and it outputs **3D Gaussian Splats, not a mesh**, so it cannot feed a
rigged-GLB pipeline. This is the recurring trap here: the high-quality
single-image face models are almost all encumbered by a non-commercial 3DMM/
dataset (FLAME, BFM, SMPL) or a non-commercial weight licence. The dense
registration itself (`register_head_to_target`) is model-agnostic and already
validated, so whichever licensed model is chosen drops straight in.

Auto-rigging for the reconstruct-the-whole-body variant would use
**Make-It-Animatable** (Apache) or **UniRig** (MIT) → a Mixamo-standard skeleton
that drives the existing pre-baked clip library. The whole recommended chain runs
on one L4 (24 GB); an A100 is only needed for throughput, not any single stage.

## Deploy

The worker is already provisioned on Cloud Run (CPU-only, 8 vCPU / 16 GiB, `DEVICE=cpu`). From a clean tree:

```bash
gcloud builds submit \
  --config workers/avatar-reconstruction/cloudbuild.yaml \
  --substitutions _GCS_BUCKET=three-ws-avatar-reconstructions,SHORT_SHA=manual$(date +%s)
```

The backend needs no change - Phase 2 ships inside the same image and the
`POST /reconstruct` → `GET /jobs/:id` contract is unchanged. Verify with
`GET /health` (`"pipeline": "face_texture_transfer_v2"`, `"geometry_morph": true`).
Full runbook: [`docs/ops/gcp-production.md`](ops/gcp-production.md).
~~~~

