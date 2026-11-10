# Dense per-subject face geometry by differentiable fit on the RTX PRO 6000

**How to run:** paste this entire file into a fresh Claude Code chat opened in the three.ws repository (`/home/user/three.ws`) and send it. Nothing else is needed: everything this order depends on is in this file, including a verbatim copy of the planning docs it came from. It is safe to run on its own, in any order, and at the same time as any other work order. Its path in the repo is `prompts/finish/730-plan-avatar-dense-identity-fit-rtx.md`.

**Priority:** P2, new capability with clear value (score 52 of 100 inside the tier). **Area:** avatar. **Written:** 2026-11-03, from a review of the planning corpus that read the source docs listed at the bottom and checked them against the code. Status claims rot, which is why Step 0 re-measures before you build anything.

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

The shipped morph (`workers/avatar-reconstruction/face_geometry.py`) is driven by 468 sparse MediaPipe landmarks diffused over 2162 head vertices. It closes about 60 percent of the template-to-person identity gap (mean ISE 0.1591 versus a template floor near 0.40) but cannot capture fine structure. The program's stated goal is to beat the commercial selfie-avatar benchmark on identity fidelity with infrastructure we own. The unencumbered route is analysis-by-synthesis: render the head, compare with the photo, back-propagate to vertex positions. Synthesised multi-view was measured and rejected for geometry (a synthesised 3/4 view reads as a different person, divergence 0.0396 versus 0.0358 for a stranger), so the fit must use the user's real photo(s) only.

## Current state (measured by the reviewer on 2026-11-03; re-verify)

- Shipped: Track 0 metric (ISE) and 40-face reference set, adversarial set, yaw gate (`MAX_MORPH_YAW_DEG` 35), clamp 0.55 sweep, projective texturing (`face_projection.py`, 10.5 to 41.1 percent photographic coverage), weak-perspective Umeyama camera shared with this track.
- Not present: no PyTorch3D, torch or any differentiable renderer in `workers/avatar-reconstruction/requirements.txt`. The worker is CPU-only on Cloud Run (`--gpu=0 --cpu=8`, moved 2026-07-25 to free an L4).
- `register_head_to_target` is model-agnostic and validated, so a dense target drops straight in. `glb_ops.set_head_geometry` writes new positions without touching skinning or morph targets (pinned by `test_face_geometry.py`).
- Capacity: L4 quota is 3 in us-central1 and fully used by six warm GPU services. An RTX PRO 6000 (Blackwell, 96 GB) is granted and validated at 1 instance but needs a CUDA 12.8 / torch cu128 image. `workers/model-hunyuan3d/Dockerfile.hunyuan21rtx` and `cloudbuild.hunyuan21rtx.yaml` are the working precedent. See `docs/ops/gcp-credits-plan.md`.
- Hard constraint: Apache/MIT/BSD/CC0 only. PyTorch3D (BSD-3) yes; nvdiffrast no (non-commercial); FLAME/MICA/BFM/SMPL no without an owner-approved commercial licence.

## Step 0: re-derive the current state

Run these first. Skip any task whose outcome already exists, and say so in the report.

```bash
cd /home/user/three.ws
grep -niE "torch|pytorch3d|nvdiffrast" workers/avatar-reconstruction/requirements.txt workers/avatar-reconstruction/Dockerfile
ls workers/avatar-reconstruction/eval/reports 2>/dev/null
sed -n 1,60p workers/avatar-reconstruction/face_geometry.py
gcloud run services list --project aerial-vehicle-466722-p5 --region us-central1 --format='table(metadata.name,spec.template.spec.containers[0].resources.limits)' | head -20
gcloud compute project-info describe --project aerial-vehicle-466722-p5 --format=json | grep -i -A3 'NVIDIA_RTX_PRO_6000\|NVIDIA_L4' | head -30
sed -n 1,40p workers/model-hunyuan3d/Dockerfile.hunyuan21rtx
```

Before changing anything, also record the baseline so you can prove you broke nothing:

    git status --short | head -20
    git log --oneline -5
    npx vitest run 2>&1 | tail -8    # note the failing-file count; it is your baseline, not your job unless this order says so

## Tasks

1. Add `workers/avatar-reconstruction/dense_fit.py`: PyTorch3D-based analysis-by-synthesis. Inputs: the morphed head (positions, faces, UVs, vertex normals), the photo, the weak-perspective camera already solved in `face_projection.py`, the face-oval and skin masks. Render a soft silhouette plus shaded/textured image, optimise per-vertex displacements with: photometric loss inside the face oval, MediaPipe landmark reprojection loss, Laplacian smoothness, a hard displacement bound, and a symmetric prior. Vertex count and order must never change.
2. Gate it. The dense step runs only when the yaw gate passes and the landmark fit succeeded, never for unusable inputs, and falls back to the current morph output on any failure or timeout (log the reason, never fail the job). Budget by wall-clock (env `DENSE_FIT_MAX_SECONDS`).
3. Write the result back with `glb_ops.set_head_geometry` and recompute normals. Add tests in `workers/avatar-reconstruction/test_dense_fit.py`: topology preserved, all ARKit-52 morph targets still present and unchanged, displacement bound respected, deterministic given a seed, and a regression that the fit lowers its own photometric loss on a synthetic head.
4. Acceptance by metric, not by eye: run `python -m eval.run_eval` on the 40 references with the dense step on and off, and `--compare` the reports. The step ships enabled only if mean ISE improves materially and `eval/robustness.py` instability does not worsen past the clamp-0.55 knee; otherwise ship disabled behind `DENSE_FIT=1` with the report in the doc. Also run `eval/detection_guard.py` on the adversarial set: no ungated adversarial input may distort more than a real face.
5. Port the worker image for the RTX PRO 6000: a new `Dockerfile.rtx` (CUDA 12.8, torch cu128, PyTorch3D built for sm_120) and `cloudbuild.rtx.yaml` modelled on `workers/model-hunyuan3d/cloudbuild.hunyuan21rtx.yaml`. Keep the CPU image as the default path; route only jobs that opt in to the GPU service so the current 10k avatars/day CPU capacity plan (`docs/ops/avatar-reconstruction-capacity.md`) is untouched. Run research sweeps as Vertex AI custom jobs so they do not compete with the serving fleet.
6. Wire routing: `api/_providers/gcp.js` (or the existing reconstruct submit path) sends dense-fit-eligible jobs to the RTX service when `RECONSTRUCT_DENSE_URL` is set, otherwise to the CPU service unchanged. Add a test in `tests/avatars-reconstruct.test.js` for both routes.
7. Docs and changelog: update `workers/avatar-reconstruction/README.md`, `docs/avatar-reconstruction.md`, Track 3 and Track 4 status and measured numbers in `docs/avatar-fidelity-program.md`, `docs/ops/gcp-credits-plan.md` (RTX service line), and add a `data/changelog.json` entry.

## Definition of done

Every line must be verified with the actual command output or browser observation in front of you. Never claim a line you did not verify.

- [ ] `cd workers/avatar-reconstruction && python -m pytest -q` passes including `test_dense_fit.py`.
- [ ] Two `eval/reports/*.json` exist (dense off and on) and the `--compare` output is recorded in `docs/avatar-fidelity-program.md` with the reference set named.
- [ ] `eval/detection_guard.py` rerun shows zero ungated adversarial inputs distort more than a real face.
- [ ] The RTX image builds via Cloud Build to a staging tag and `/healthz` answers from a deployed staging revision (config-only and GPU worker deploys are pre-approved).
- [ ] With dense routing off, `node --test` or vitest for `tests/avatars-reconstruct.test.js` shows unchanged behaviour.
- [ ] Every test you wrote or touched passes (`npx vitest run <those files>`; Playwright specs with `npx playwright test <spec>`). Bug fixes landed test-first: the new test failed before the fix for the reason the bug describes, and passes after.
- [ ] `npx vitest run` shows no new failing files compared with the Step 0 baseline.
- [ ] Any UI you changed was exercised in a real browser on a dev server (`npx vite --port <free port> --strictPort`): no console errors or warnings from your code, real network calls returning real data, and hover, focus, active, empty, error and loading (skeleton) states all designed and observed.
- [ ] `npm run check:rules -- --paths <every file you touched>` exits 0.
- [ ] Documentation is true: the feature doc or README describes what now exists, `STRUCTURE.md` has a row for any new surface or directory, a new page is in `data/pages.json`, and any user-visible change has a `data/changelog.json` entry followed by `npm run build:pages`. `npm run audit:docs` reports nothing new.
- [ ] You reviewed `git diff --staged` line by line before committing, and every changed line is justified.

## Never blocked

| Blocker | Resolution (act, do not ask) |
|---|---|
| L4 quota is full | Use the granted RTX PRO 6000 (96 GB) and Vertex AI custom jobs for experiments; commands in docs/ops/gcp-credits-plan.md. |
| PyTorch3D wheel missing for CUDA 12.8 / sm_120 | Build from source in the Dockerfile (precedent: the hunyuan RTX Dockerfile compiles custom kernels); pin the commit. |
| Tempted to use nvdiffrast or FLAME/MICA | Do not. Licence is non-commercial or needs paid MPI terms. Stay on PyTorch3D and the user's own photo. |
| Dense fit does not beat the morph | Report the negative result with the ISE reports, ship disabled behind the flag, do not claim fidelity. |
| Missing credential or env var | Read it from the live Cloud Run service: `node scripts/read-service-env.mjs` (or `gcloud run services describe three-ws-api --region us-central1`). Never trust `vercel env pull`; it returns empty secrets. To set one key, use `gcloud run services update --update-env-vars`, never `--set-env-vars` (that replaces the whole set). Load `.claude/skills/self-unblock-playbook/SKILL.md` for the full table. |
| Database schema needed | Write the migration beside the existing ones, read `npm run db:status` first, and remember `npm run db:migrate` applies immediately with no dry run. |
| GCP resource, GPU, or quota | GCP spend for quality and reliability is pre-approved (project `aerial-vehicle-466722-p5`). Create what you need; never downgrade quality to save credits. Do not onboard a new paid third-party API without the owner. |
| Tests failing that you did not touch | Compare with your Step 0 baseline. Pre-existing failures are not yours to fix unless this order says so; report them in one line. Never delete or skip a test to get green. |
| A file changed under you | Another session edited it. Re-read it, keep their change, and apply yours on top. Never `git stash`, `git reset`, `git checkout -- <path>`, or revert work you did not write. |
| Upstream API down or rate-limited | Find the root cause, add a real fallback or retry with backoff, and keep going. Never ship fake data in its place. |

## Close out (required)

1. Verify every Definition of done line with real output in front of you.
2. Commit with explicit paths and a message that describes the diff: `type(scope): what changed and why a reader would care`. Split unrelated changes into separate commits. If the diff references a crypto project other than $THREE, stop and ask the owner before that commit (CLAUDE.md commit gate).
3. If every Definition of done line passes, delete this work order in your final commit (`git rm prompts/finish/730-plan-avatar-dense-identity-fit-rtx.md`) and append one dated line to `prompts/finish/_context/plan-PROGRESS.md` (create it if missing): the date, `730-plan-avatar-dense-identity-fit-rtx.md`, the commit SHAs, and one sentence on what shipped.
4. If the last step belongs to the owner or an outside party, finish everything else, keep this file, add a dated "Status" paragraph directly under its title saying exactly what remains and who owns it, and append the same to `prompts/finish/_context/plan-PROGRESS.md`.
5. Never push or deploy unless the owner's message that started this session explicitly told you to. Leave the ship as one command (`git push threews main`, then `npm run deploy:gcp:full` per `.claude/skills/deploy-runbook/SKILL.md`) and name it in the report.

## Final report

Reply with, in this order and nothing else: what Step 0 measured; what you changed (files and commit SHAs); evidence for each Definition of done line; the one batched owner message, if any gate was hit; one line per judgment call. No trailing questions.

## Source material

The planning docs this order was derived from. They are referenced rather than inlined so this order stays under the 50,000-character paste limit: read each one before Step 0. Where a source still exists, the live file may be newer than this order: re-read it, and trust the code over both.

- `docs/avatar-fidelity-program.md`
- `docs/avatar-reconstruction.md`

## Status 2026-11-04

Built and committed, shipped disabled: `dense_fit.py` plus `test_dense_fit.py` (10 tests pass on CPU), pipeline integration behind `DENSE_FIT=1`, `Dockerfile.rtx` (CUDA 12.8, cu128, PyTorch3D for sm_120), `cloudbuild.rtx.yaml` (build and push only), routing via `RECONSTRUCT_DENSE_URL` with tests in `tests/avatars-reconstruct.test.js`, README, fidelity-program status, `.env.example`, changelog.

Remaining owner steps (need Cloud Build, GPU and the 40-face set): build the RTX image to a staging tag, deploy a staging revision and confirm `/healthz`, run `python -m eval.run_eval` with the step off and on and `--compare`, record the numbers in `docs/avatar-fidelity-program.md`, rerun `eval/detection_guard.py`. Enable only if mean ISE improves materially.
